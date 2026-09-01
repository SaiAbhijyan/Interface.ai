import { writeFileSync, readFileSync } from "fs";
const part2 = `
  async open(entryUrl: string): Promise<void> {
    assertUrlAllowed(entryUrl, this.allowlist);
    this.browser = await chromium.launch({
      headless: this.opts.headless,
      slowMo: this.opts.slowMo,
    });
    this.context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    this.page = await this.context.newPage();
    await this.installNavigationGuard(this.page);
    await this.page.goto(entryUrl, { waitUntil: "domcontentloaded" });
    assertUrlAllowed(this.page.url(), this.allowlist);
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.context = null;
    this.page = null;
  }

  private async locate(loc: DriverLocator): Promise<Locator> {
    const root = await resolveFrameByTitle(this.getPage(), loc.frame);
    return buildLocator(root, loc).first();
  }

  async observe(): Promise<ObserveSnapshot> {
    const page = this.getPage();
    const title = await page.title();
    const url = page.url();
    if (!url.startsWith("about:")) assertUrlAllowed(url, this.allowlist);

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
        if (f.url() && !f.url().startsWith("about:")) assertUrlAllowed(f.url(), this.allowlist);
      } catch {
        frames.push(name + " [BLOCKED]");
        continue;
      }
      try {
        const t = await f.locator("body").innerText({ timeout: 2000 });
        visibleText += "\\n--- frame:" + name + " ---\\n" + t.slice(0, 2000);
        try {
          const aria = await f.locator("body").ariaSnapshot({ timeout: 2000 });
          accessibilityTree += "\\n--- frame:" + name + " ---\\n" + aria.slice(0, 3000);
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
    await (await this.locate(locator)).click({ timeout: options?.timeoutMs ?? 10_000 });
    const page = this.getPage();
    await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    const url = page.url();
    if (url && !url.startsWith("about:")) assertUrlAllowed(url, this.allowlist);
  }

  async fill(locator: DriverLocator, value: string, options?: { timeoutMs?: number }): Promise<void> {
    await (await this.locate(locator)).fill(value, { timeout: options?.timeoutMs ?? 10_000 });
  }

  async select(locator: DriverLocator, value: string): Promise<void> {
    const loc = await this.locate(locator);
    await loc.selectOption({ label: value }).catch(async () => {
      await loc.selectOption({ value });
    });
  }

  async press(key: string): Promise<void> {
    await this.getPage().keyboard.press(key);
  }

  async navigate(url: string): Promise<void> {
    assertUrlAllowed(url, this.allowlist);
    await this.getPage().goto(url, { waitUntil: "domcontentloaded" });
    assertUrlAllowed(this.getPage().url(), this.allowlist);
  }

  async waitFor(locator: DriverLocator, timeoutMs = 10_000): Promise<void> {
    await (await this.locate(locator)).waitFor({ state: "visible", timeout: timeoutMs });
  }

  async readText(locator: DriverLocator): Promise<string> {
    return (await (await this.locate(locator)).innerText({ timeout: 10_000 })).trim();
  }

  async isVisible(locator: DriverLocator, timeoutMs = 1500): Promise<boolean> {
    try {
      await (await this.locate(locator)).waitFor({ state: "visible", timeout: timeoutMs });
      return true;
    } catch {
      return false;
    }
  }

  async screenshot(path: string): Promise<void> {
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
`;
const full = readFileSync("/tmp/driver-part1.ts", "utf8") + part2;
writeFileSync("src/surface/playwright-driver.ts", full);
console.log("driver written", full.length);
