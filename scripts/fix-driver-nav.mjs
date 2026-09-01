import { readFileSync, writeFileSync } from "fs";
let s = readFileSync("src/surface/playwright-driver.ts", "utf8");

s = s.replace(
  `import {
  type AllowlistConfig,
  assertUrlAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";`,
  `import {
  type AllowlistConfig,
  assertUrlAllowed,
  assertSchemeAllowed,
  freezeAllowlist,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";`,
);

s = s.replace(
  `this.allowlist = opts.allowlist ?? loadAllowlistFromEnv();`,
  `this.allowlist = freezeAllowlist(opts.allowlist ?? loadAllowlistFromEnv()) as AllowlistConfig;`,
);

// Replace installNavigationGuard body to block data: and re-validate (anti-TOCTOU)
const oldGuard = `  private async installNavigationGuard(page: Page): Promise<void> {
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
  }`;

const newGuard = `  private async installNavigationGuard(page: Page): Promise<void> {
    // Snapshot frozen at install time — avoids TOCTOU if caller mutates config object
    const cfg = freezeAllowlist(this.allowlist) as AllowlistConfig;
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      try {
        if (url === "about:blank") {
          await route.continue();
          return;
        }
        // Block data:/blob:/javascript: and non-allowlisted origins/paths
        assertSchemeAllowed(url);
        assertUrlAllowed(url, cfg);
        await route.continue();
        // Post-continue re-check (redirect TOCTOU)
        const finalUrl = route.request().url();
        if (finalUrl && finalUrl !== "about:blank") {
          assertSchemeAllowed(finalUrl);
          assertUrlAllowed(finalUrl, cfg);
        }
      } catch (e) {
        await route.abort("blockedbyclient").catch(() => undefined);
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[allowlist] route blocked:", msg, url);
      }
    });
    page.on("framenavigated", (frame) => {
      const url = frame.url();
      if (!url || url === "about:blank") return;
      try {
        assertSchemeAllowed(url);
        assertUrlAllowed(url, cfg);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[allowlist] framenavigated violation:", msg, url);
        void page.goto("about:blank").catch(() => undefined);
      }
    });
  }`;

if (!s.includes(oldGuard.slice(0, 80))) {
  console.log("WARN: guard pattern not found exactly — trying looser replace");
}
s = s.replace(oldGuard, newGuard);

// observe: block data: frames
s = s.replace(
  `if (!url.startsWith("about:")) assertUrlAllowed(url, this.allowlist);`,
  `if (url && url !== "about:blank") { assertSchemeAllowed(url); assertUrlAllowed(url, this.allowlist); }`,
);
s = s.replace(
  `if (f.url() && !f.url().startsWith("about:")) assertUrlAllowed(f.url(), this.allowlist);`,
  `if (f.url() && f.url() !== "about:blank") { assertSchemeAllowed(f.url()); assertUrlAllowed(f.url(), this.allowlist); }`,
);
s = s.replace(
  `if (url && !url.startsWith("about:")) assertUrlAllowed(url, this.allowlist);`,
  `if (url && url !== "about:blank") { assertSchemeAllowed(url); assertUrlAllowed(url, this.allowlist); }`,
);

writeFileSync("src/surface/playwright-driver.ts", s);
console.log("driver nav fixed", s.includes("assertSchemeAllowed"), s.includes("data:"));
