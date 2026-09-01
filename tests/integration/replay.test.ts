import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { PlaywrightSurfaceDriver } from "../../src/surface/playwright-driver.js";
import {
  buildLookupSavingsArtifact,
  buildOpenSubAccountArtifact,
} from "../../src/artifact/fixtures.js";
import { replayCapability } from "../../src/replay/executor.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.BANK_MOCK_PORT ?? 4173);
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server not ready at ${url}`);
}

beforeAll(async () => {
  // Reuse existing mock if already listening (shared with allowlist-escape.test.ts)
  try {
    if ((await fetch(BASE + "/")).ok) return;
  } catch {
    /* start below */
  }
  server = spawn("bun", ["tsx", "apps/legacy-bank-mock/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, BANK_MOCK_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(BASE + "/");
});

afterAll(async () => {
  if (server && !server.killed) {
    server.kill("SIGTERM");
  }
});

describe("integration replay (no LLM)", () => {
  it("replays lookup_member_savings_balance successfully", async () => {
    const artifact = buildLookupSavingsArtifact(BASE);
    const artPath = path.join(ROOT, "artifacts", "lookup_member_savings_balance.json");
    fs.mkdirSync(path.dirname(artPath), { recursive: true });
    fs.writeFileSync(artPath, JSON.stringify(artifact, null, 2));

    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact,
      params: { memberId: "10001" },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
    });

    expect(result.status).toBe("success");
    expect(result.outputs?.savingsBalance).toMatch(/\$/);
    fs.writeFileSync(
      path.join(ROOT, "evidence", "replay-success.json"),
      JSON.stringify(result, null, 2),
    );
  });

  it("returns business_outcome MEM_NOT_FOUND for unknown member", async () => {
    const artifact = buildLookupSavingsArtifact(BASE);
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact,
      params: { memberId: "99999" },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
    });

    expect(result.status).toBe("business_outcome");
    expect(result.businessOutcome?.code).toBe("MEM_NOT_FOUND");
    fs.writeFileSync(
      path.join(ROOT, "evidence", "replay-business-outcome.json"),
      JSON.stringify(result, null, 2),
    );
  });

  it("blocks irreversible open-account without confirmation flag", async () => {
    const artifact = buildOpenSubAccountArtifact(BASE);
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact,
      params: {
        memberId: "10001",
        accountType: "Savings",
        productCode: "SAV-01",
      },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
      confirmIrreversible: false,
    });

    expect(result.status).toBe("hard_failure");
    expect(result.error?.taxonomy).toBe("irreversible_blocked");
  });

  it("opens sub-account when confirmIrreversible is set", async () => {
    const artifact = buildOpenSubAccountArtifact(BASE);
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    const result = await replayCapability({
      artifact,
      params: {
        memberId: "10001",
        accountType: "Savings",
        productCode: "SAV-01",
      },
      driver,
      evidenceDir: path.join(ROOT, "evidence"),
      confirmIrreversible: true,
    });

    expect(result.status).toBe("success");
    expect(result.outputs?.confirmationCode).toMatch(/CNF-/);
    expect(result.outputs?.newAccountNumber).toBeTruthy();
  });
});
