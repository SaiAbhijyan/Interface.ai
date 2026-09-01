import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlaywrightSurfaceDriver } from "../../src/surface/playwright-driver.js";
import { buildLookupSavingsArtifact } from "../../src/artifact/fixtures.js";
import { replayCapability } from "../../src/replay/executor.js";
import { CapabilityArtifactSchema } from "../../src/artifact/schema.js";
import { PolicyViolation } from "../../src/guardrails/allowlist.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.BANK_MOCK_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Server not ready at " + url);
}

beforeAll(async () => {
  // Reuse an already-running mock (avoids port fights with replay.test.ts)
  try {
    if ((await fetch(BASE + "/")).ok) return;
  } catch { /* start */ }
  server = spawn("bun", ["tsx", "apps/legacy-bank-mock/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, BANK_MOCK_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(BASE + "/");
});

afterAll(() => {
  // Do not kill :4173 here — replay.test.ts shares this mock. Process exit reaps the child.
});

describe("E2E allowlist nav escape", () => {
  it("driver.open rejects other localhost ports", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await expect(driver.open("http://127.0.0.1:6379/")).rejects.toThrow(PolicyViolation);
  });

  it("driver.open rejects data: URLs", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await expect(
      driver.open("data:text/html,<script>document.title='pwn'</script>"),
    ).rejects.toThrow(PolicyViolation);
  });

  it("driver.open rejects disallowed path", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await expect(driver.open(BASE + "/secret-admin.html")).rejects.toThrow(PolicyViolation);
  });

  it("driver.navigate rejects external origin after open", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await driver.open(BASE + "/");
    await expect(driver.navigate("https://example.com/")).rejects.toThrow(PolicyViolation);
    await driver.close();
  });

  it("replay hard_fails when artifact step navigates off-origin", async () => {
    const base = buildLookupSavingsArtifact(BASE);
    const evil = CapabilityArtifactSchema.parse({
      ...base,
      steps: [
        {
          id: "s1",
          action: "navigate",
          description: "Escape attempt",
          url: "http://127.0.0.1:3000/admin",
          irreversible: false,
          recoverableHints: [],
        },
      ],
    });
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact: evil,
      params: { memberId: "10001" },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
    });
    expect(result.status).toBe("hard_failure");
    expect(result.error?.taxonomy).toMatch(/policy_violation|unknown/);
  });

  it("replay hard_fails when entryUrl uses disallowed path", async () => {
    const base = buildLookupSavingsArtifact(BASE);
    const evil = CapabilityArtifactSchema.parse({
      ...base,
      target: { ...base.target, entryUrl: BASE + "/not-allowed.html" },
    });
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact: evil,
      params: { memberId: "10001" },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
    });
    expect(result.status).toBe("hard_failure");
  });

  /**
   * Click-nav escape PoC:
   * Insert an off-allowlist link via rawPage(), click it outside the gated click() API,
   * then assert the sticky navPolicyError fail-hard path: subsequent observe()/click()
   * must throw PolicyViolation (page typically blanked to about:blank).
   */
  it("click-nav escape via rawPage link is fail-hard on next observe", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    await driver.open(BASE + "/");
    const page = driver.rawPage();
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.id = "escape-link";
      a.href = "https://example.com/";
      a.textContent = "Escape";
      document.body.appendChild(a);
    });
    await page.click("#escape-link");
    // Allow route/framenavigated guards to run
    await page.waitForTimeout(500).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 300));

    // Assertion: sticky nav policy error — next observe must throw PolicyViolation
    // (either interceptor aborted + failNav, or page blanked after chrome-error).
    await expect(driver.observe()).rejects.toThrow(PolicyViolation);

    // Optional: drain confirms an error was recorded (may already be consumed by throw path;
    // assertNavClear throws without clearing — error remains sticky).
    const drained = driver.drainNavPolicyErrorForTests();
    expect(drained).toBeTruthy();

    await driver.close();
  });
});
