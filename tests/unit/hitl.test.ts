import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  escalateToHuman,
  HitlBlockedError,
  type InterventionRequest,
} from "../../src/hitl/handoff.js";
import type { SurfaceDriver, HumanSessionHandle } from "../../src/surface/types.js";
import { RunLogger } from "../../src/observability/logger.js";

function stubDriver(): SurfaceDriver {
  return {
    kind: "web",
    open: async () => undefined,
    close: async () => undefined,
    observe: async () => ({
      url: "http://127.0.0.1:4173/",
      title: "t",
      accessibilityTree: "",
      visibleText: "",
      frames: [],
    }),
    click: async () => undefined,
    fill: async () => undefined,
    select: async () => undefined,
    press: async () => undefined,
    navigate: async () => undefined,
    waitFor: async () => undefined,
    readText: async () => "",
    isVisible: async () => false,
    screenshot: async () => undefined,
    pauseForHuman: async (): Promise<HumanSessionHandle> => ({
      attachInstructions: "test attach",
      sessionId: "sess-test",
      resume: async () => undefined,
    }),
  };
}

const request: InterventionRequest = {
  reason: "stuck",
  observedSummary: "no matching control",
  createdAt: new Date().toISOString(),
};

describe("HITL fail-closed", () => {
  let prev: string | undefined;
  let dir: string;
  let logger: RunLogger;

  beforeEach(() => {
    prev = process.env.HITL_MODE;
    dir = mkdtempSync(join(tmpdir(), "hitl-"));
    logger = new RunLogger({ runId: "hitl-test", dir });
  });

  afterEach(async () => {
    await logger.close();
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.HITL_MODE;
    else process.env.HITL_MODE = prev;
  });

  it("manual mode without waitForOperator throws (no auto-resume)", async () => {
    process.env.HITL_MODE = "manual";
    await expect(
      escalateToHuman({
        driver: stubDriver(),
        logger,
        request,
      }),
    ).rejects.toBeInstanceOf(HitlBlockedError);
  });

  it("manual mode resumes only after waitForOperator", async () => {
    process.env.HITL_MODE = "manual";
    const result = await escalateToHuman({
      driver: stubDriver(),
      logger,
      request,
      waitForOperator: async () => "operator cleared gate",
    });
    expect(result.mode).toBe("manual");
    expect(result.operatorNotes).toBe("operator cleared gate");
    expect(result.sessionId).toBe("sess-test");
  });

  it("mock mode auto-resolves without waitForOperator", async () => {
    process.env.HITL_MODE = "mock";
    const result = await escalateToHuman({
      driver: stubDriver(),
      logger,
      request,
      mockDelayMs: 1,
    });
    expect(result.mode).toBe("mock");
    expect(result.operatorNotes).toContain("[mock operator]");
  });

  it("defaults to manual fail-closed when HITL_MODE unset", async () => {
    delete process.env.HITL_MODE;
    await expect(
      escalateToHuman({
        driver: stubDriver(),
        logger,
        request,
      }),
    ).rejects.toBeInstanceOf(HitlBlockedError);
  });
});
