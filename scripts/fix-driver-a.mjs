import { writeFileSync } from "fs";
const part1 = `import { chromium, type Browser, type BrowserContext, type Page, type Frame, type Locator } from "playwright";
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

  constructor(opts: PlaywrightDriverOptions = {}) {
    this.opts = { headless: true, ...opts };
    this.allowlist = opts.allowlist ?? loadAllowlistFromEnv();
  }

  private getPage(): Page {
    if (!this.page) throw new Error("Driver not open — call open() first");
    return this.page;
  }

  private async installNavigationGuard(page: Page): Promise<void> {
    const cfg = this.allowlist;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("about:") || url.startsWith("data:")) {
        await route.continue();
        return;
      }
      try {
        assertUrlAllowed(url, cfg);
        await route.continue();
      } catch (e) {
        await route.abort("blockedbyclient");
        const msg = e instanceof Error ? e.message : String(e);
        throw new PolicyViolation("Navigation blocked by allowlist interceptor: " + msg);
      }
    });
    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (!url || url.startsWith("about:") || url.startsWith("data:")) return;
      try {
        assertUrlAllowed(url, cfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[allowlist] framenavigated violation:", msg, url);
        void page.goto("about:blank").catch(() => undefined);
      }
    });
  }
`;
writeFileSync("/tmp/driver-part1.ts", part1);
console.log("part1", part1.length);
