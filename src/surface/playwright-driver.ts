import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Locator } from "playwright";
import { randomUUID } from "node:crypto";
import type {
  DriverLocator,
  HumanSessionHandle,
  ObserveSnapshot,
  SurfaceDriver,
} from "./types.js";
import {
  type AllowlistConfig,
  assertUrlAllowed,
  assertSchemeAllowed,
  freezeAllowlist,
  isNavigationSchemeAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";
import { redactObserveSnapshot } from "../guardrails/redaction.js";

async function resolveFrameByTitle(page: Page, frameTitle?: string): Promise<Page | Frame> {
  if (!frameTitle) return page;
  const byName = page.frame({ name: frameTitle });
  if (byName) return byName;

  // No CSS string interpolation of untrusted titles — iterate attributes safely
  const iframes = page.locator("iframe");
  const n = await iframes.count();
  const want = frameTitle.toLowerCase();
  for (let i = 0; i < n; i++) {
    const title = (await iframes.nth(i).getAttribute("title")) ?? "";
    const name = (await iframes.nth(i).getAttribute("name")) ?? "";
    if (title === frameTitle || name === frameTitle || title.toLowerCase().includes(want)) {
      const handle = await iframes.nth(i).elementHandle();
      const content = handle ? await handle.contentFrame() : null;
      if (content) return content;
    }
  }
  for (const f of page.frames()) {
    if (f.url().includes(frameTitle)) return f;
  }
  return page;
}

function buildLocator(root: Page | Frame, loc: DriverLocator): Locator {
  const strategy = loc.strategy === "frame_role_name" ? "role_name" : loc.strategy;
  switch (strategy) {
    case "role_name": {
      const role = (loc.role ?? "button") as Parameters<Page["getByRole"]>[0];
      return root.getByRole(role, { name: loc.value, exact: false });
    }
    case "label":
      return root.getByLabel(loc.value, { exact: false });
    case "placeholder":
      return root.getByPlaceholder(loc.value, { exact: false });
    case "text":
      return root.getByText(loc.value, { exact: false });
    case "css":
      return root.locator(loc.value);
    default:
      return root.getByText(loc.value, { exact: false });
  }
}

/** Chromium error / interstitial pages after aborted or failed navigations. */
function isChromeErrorUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.startsWith("chrome-error:") ||
    lower.includes("chromewebdata") ||
    lower.startsWith("chrome://error")
  );
}

export type PlaywrightDriverOptions = {
  headless?: boolean;
  slowMo?: number;
  allowlist?: AllowlistConfig;
};

export class PlaywrightSurfaceDriver implements SurfaceDriver {
  readonly kind = "web" as const;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly opts: PlaywrightDriverOptions;
  private allowlist: AllowlistConfig;
  /** Sticky fail-hard flag set by route/framenavigated policy violations (TOCTOU). */
  private navPolicyError: string | null = null;

  constructor(opts: PlaywrightDriverOptions = {}) {
    this.opts = { headless: true, ...opts };
    this.allowlist = freezeAllowlist(opts.allowlist ?? loadAllowlistFromEnv()) as AllowlistConfig;
  }

  private getPage(): Page {
    if (!this.page) throw new Error("Driver not open — call open() first");
    return this.page;
  }

  private failNav(msg: string): void {
    if (!this.navPolicyError) this.navPolicyError = msg;
    const page = this.page;
    if (!page) return;
    // Defer goto so we never deadlock inside a Playwright route handler
    setTimeout(() => {
      void page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => undefined);
    }, 0);
  }

  private assertNavClear(): void {
    if (this.navPolicyError) {
      throw new PolicyViolation(this.navPolicyError);
    }
  }

  /** Public alias for tests / callers — fail-closed sticky nav check. */
  assertNoNavViolation(): void {
    this.assertNavClear();
  }

  /** Test helper: simulate a framenavigated allowlist violation. */
  simulateNavViolation(message: string): void {
    this.navPolicyError = message;
  }

  /** Package-visible test helper: return and clear sticky nav policy error. */
  drainNavPolicyErrorForTests(): string | null {
    const err = this.navPolicyError;
    this.navPolicyError = null;
    return err;
  }

  private async installNavigationGuard(page: Page): Promise<void> {
    // Snapshot frozen at install time — avoids TOCTOU if caller mutates config object
    const cfg = freezeAllowlist(this.allowlist) as AllowlistConfig;
    await page.route("**/*", async (route) => {
      const req = route.request();
      const url = req.url();
      try {
        // Never continue() unreviewed schemes — only about:blank(+hash) or http(s)
        if (!isNavigationSchemeAllowed(url)) {
          await route.abort("blockedbyclient").catch(() => undefined);
          const navLike =
            req.isNavigationRequest() || req.resourceType() === "document";
          if (navLike) {
            this.failNav("Blocked navigation scheme: " + url);
          } else {
            console.error("[allowlist] subresource blocked scheme:", url);
          }
          return;
        }
        if (url === "about:blank" || /^about:blank#/i.test(url)) {
          await route.continue();
          return;
        }
        assertSchemeAllowed(url);
        assertUrlAllowed(url, cfg);
        await route.continue();
      } catch (e) {
        await route.abort("blockedbyclient").catch(() => undefined);
        const msg = e instanceof Error ? e.message : String(e);
        // Fail-closed sticky only for document/navigation requests.
        // Subresources (favicon, etc.) are aborted without nuking the page session.
        const navLike =
          req.isNavigationRequest() || req.resourceType() === "document";
        if (navLike) {
          this.failNav(
            "Navigation blocked by allowlist interceptor: " + msg + " (" + url + ")",
          );
        } else {
          console.error("[allowlist] subresource blocked:", msg, url);
        }
      }
    });
    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (!url || url === "about:blank" || /^about:blank#/i.test(url)) return;
      // Blocked/error navigations — do not run allowlist URL asserts on chrome-error schemes
      if (isChromeErrorUrl(url)) {
        this.failNav("Blocked/error navigation (chrome-error): " + url);
        return;
      }
      try {
        if (!isNavigationSchemeAllowed(url)) {
          throw new PolicyViolation("Blocked navigation scheme on framenavigated: " + url);
        }
        assertSchemeAllowed(url);
        assertUrlAllowed(url, cfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.failNav("framenavigated allowlist violation: " + msg + " (" + url + ")");
      }
    });
  }

  async open(entryUrl: string): Promise<void> {
    assertSchemeAllowed(entryUrl);
    assertUrlAllowed(entryUrl, this.allowlist);
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo,
    });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    this.page = await this.context.newPage();
    await this.installNavigationGuard(this.page);
    this.navPolicyError = null;
    try {
      await this.page.goto(entryUrl, { waitUntil: "domcontentloaded" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isConn =
        /ERR_CONNECTION|ECONNREFUSED|NS_ERROR_CONNECTION|net::ERR_|Timeout|interrupted/i.test(msg);
      this.failNav(
        isConn
          ? "Navigation connection failure: " + msg
          : "Navigation failed: " + msg,
      );
      throw new PolicyViolation(this.navPolicyError ?? msg);
    }
    const landed = this.page.url();
    if (isChromeErrorUrl(landed)) {
      this.failNav("open() landed on chrome-error page: " + landed);
    }
    this.assertNavClear();
    if (landed && landed !== "about:blank") {
      assertUrlAllowed(landed, this.allowlist);
    }
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
    this.navPolicyError = null;
  }

  private async locate(loc: DriverLocator): Promise<Locator> {
    const root = await resolveFrameByTitle(this.getPage(), loc.frame);
    return buildLocator(root, loc).first();
  }

  async observe(): Promise<ObserveSnapshot> {
    this.assertNavClear();
    const page = this.getPage();
    const title = await page.title();
    const url = page.url();
    if (isChromeErrorUrl(url)) {
      this.failNav("observe saw chrome-error URL: " + url);
      this.assertNavClear();
    }
    if (url && url !== "about:blank") {
      assertSchemeAllowed(url);
      assertUrlAllowed(url, this.allowlist);
    }

    let accessibilityTree = "";
    try {
      accessibilityTree = (await page.locator("body").ariaSnapshot({ timeout: 5000 })).slice(0, 8000);
    } catch {
      accessibilityTree = "(aria snapshot unavailable)";
    }
    let visibleText = "";
    try {
      visibleText = (await page.locator("body").innerText({ timeout: 5000 })).slice(0, 4000);
    } catch {
      visibleText = "";
    }
    const frames: string[] = [];
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const name = f.name() || f.url();
      frames.push(name);
      try {
        const fu = f.url();
        if (isChromeErrorUrl(fu)) {
          frames.push(name + " [BLOCKED]");
          continue;
        }
        if (fu && fu !== "about:blank") {
          assertSchemeAllowed(fu);
          assertUrlAllowed(fu, this.allowlist);
        }
      } catch {
        frames.push(name + " [BLOCKED]");
        continue;
      }
      try {
        const t = await f.locator("body").innerText({ timeout: 2000 });
        visibleText += "\n--- frame:" + name + " ---\n" + t.slice(0, 2000);
        try {
          const aria = await f.locator("body").ariaSnapshot({ timeout: 2000 });
          accessibilityTree += "\n--- frame:" + name + " ---\n" + aria.slice(0, 3000);
        } catch { /* ignore */ }
      } catch { /* ignore */ }
    }
    const iframeTitles = await page.locator("iframe").evaluateAll((els) =>
      els.map((e) => (e as HTMLIFrameElement).title || (e as HTMLIFrameElement).name || ""),
    );
    for (const t of iframeTitles) if (t && !frames.includes(t)) frames.push(t);
    return redactObserveSnapshot({ url, title, accessibilityTree, visibleText, frames });
  }

  async click(locator: DriverLocator, options?: { timeoutMs?: number }): Promise<void> {
    this.assertNavClear();
    await (await this.locate(locator)).click({ timeout: options?.timeoutMs ?? 10_000 });
    const page = this.getPage();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    this.assertNavClear();
    const url = page.url();
    if (isChromeErrorUrl(url)) {
      this.failNav("click landed on chrome-error: " + url);
      this.assertNavClear();
    }
    if (url && url !== "about:blank") {
      assertSchemeAllowed(url);
      assertUrlAllowed(url, this.allowlist);
    }
  }

  async fill(locator: DriverLocator, value: string, options?: { timeoutMs?: number }): Promise<void> {
    this.assertNavClear();
    await (await this.locate(locator)).fill(value, { timeout: options?.timeoutMs ?? 10_000 });
  }

  async select(locator: DriverLocator, value: string): Promise<void> {
    this.assertNavClear();
    const loc = await this.locate(locator);
    await loc.selectOption({ label: value }).catch(async () => {
      await loc.selectOption({ value });
    });
  }

  async press(key: string): Promise<void> {
    this.assertNavClear();
    await this.getPage().keyboard.press(key);
  }

  async navigate(url: string): Promise<void> {
    this.assertNavClear();
    assertSchemeAllowed(url);
    assertUrlAllowed(url, this.allowlist);
    try {
      await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.failNav("navigate() failed: " + msg);
      throw new PolicyViolation(this.navPolicyError ?? msg);
    }
    this.assertNavClear();
    const landed = this.getPage().url();
    if (isChromeErrorUrl(landed)) {
      this.failNav("navigate() landed on chrome-error: " + landed);
      this.assertNavClear();
    }
    assertUrlAllowed(landed, this.allowlist);
  }

  async waitFor(locator: DriverLocator, timeoutMs = 10_000): Promise<void> {
    this.assertNavClear();
    await (await this.locate(locator)).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async readText(locator: DriverLocator): Promise<string> {
    this.assertNavClear();
    return (await (await this.locate(locator)).innerText({ timeout: 10_000 })).trim();
  }

  async isVisible(locator: DriverLocator, timeoutMs = 1500): Promise<boolean> {
    this.assertNavClear();
    try {
      await (await this.locate(locator)).waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async screenshot(path: string): Promise<void> {
    this.assertNavClear();
    await this.getPage().screenshot({ path, fullPage: true });
  }

  async pauseForHuman(): Promise<HumanSessionHandle> {
    const sessionId = randomUUID();
    const page = this.getPage();
    const attachInstructions =
      "HITL session " + sessionId + ": live Playwright page at " + page.url() +
      ". Attach to THIS session; signal resume when done.";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    return {
      attachInstructions,
      sessionId,
      resume: async () => { release(); await gate; },
    };
  }

  rawPage(): Page {
    return this.getPage();
  }
}
