import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlaywrightSurfaceDriver } from "../../src/surface/playwright-driver.js";
import { PolicyViolation } from "../../src/guardrails/allowlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = 4173;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;
let startedByUs = false;

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server not ready at " + url);
}

beforeAll(async () => {
  try {
    if ((await fetch(BASE + "/")).ok) return;
  } catch {
    /* start */
  }
  server = spawn("bun", ["tsx", "apps/legacy-bank-mock/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, BANK_MOCK_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  startedByUs = true;
  await waitForServer(BASE + "/");
});

afterAll(() => {
  if (startedByUs && server && !server.killed) server.kill("SIGTERM");
});

describe("allowlist E2E PoCs", () => {
  it("driver.open rejects bad entryUrl path secret-admin.html", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await expect(driver.open(BASE + "/secret-admin.html")).rejects.toThrow(PolicyViolation);
  });

  it("driver.open rejects off-origin port 3000", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await expect(driver.open("http://127.0.0.1:3000/")).rejects.toThrow(PolicyViolation);
  });

  it("nav interceptor blocks rawPage.goto to disallowed path (abort / no land)", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await driver.open(BASE + "/");
    const page = driver.rawPage();
    const before = page.url();

    let gotoErrored = false;
    try {
      await page.goto(BASE + "/secret-admin.html", {
        waitUntil: "domcontentloaded",
        timeout: 4000,
      });
    } catch {
      gotoErrored = true;
    }

    const after = page.url();
    expect(after.includes("secret-admin")).toBe(false);
    expect(
      gotoErrored || after === before || after.startsWith("about:blank") || after.startsWith(BASE),
    ).toBe(true);

    try {
      driver.assertNoNavViolation();
      const snap = await driver.observe();
      expect(snap.url.includes("secret-admin")).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyViolation);
      await expect(driver.observe()).rejects.toThrow(PolicyViolation);
    }

    await driver.close();
  });

  it("injected link click to off-allowlist does not land on secret-admin", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await driver.open(BASE + "/");
    const page = driver.rawPage();

    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "/secret-admin.html";
      a.id = "escape-link";
      a.textContent = "Escape";
      document.body.appendChild(a);
    });

    await page.click("#escape-link").catch(() => undefined);
    await page.waitForTimeout(500);

    const url = page.url();
    expect(url.includes("secret-admin")).toBe(false);

    try {
      driver.assertNoNavViolation();
      const snap = await driver.observe();
      expect(snap.url.includes("secret-admin")).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyViolation);
    }

    await driver.close();
  });
});
