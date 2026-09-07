import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  escalateToHuman,
  HitlBlockedError,
  type InterventionRequest,
} from "../../src/hitl/handoff.js";
import {
  createFileWaitForOperator,
  writeResumeSignal,
} from "../../src/hitl/wait-for-operator.js";
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
    delete process.env.HITL_AUTO_NOTES;
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

describe("file waitForOperator helper", () => {
  let prev: string | undefined;
  let prevAuto: string | undefined;
  let dir: string;
  let proofDir: string;
  let logger: RunLogger;

  beforeEach(() => {
    prev = process.env.HITL_MODE;
    prevAuto = process.env.HITL_AUTO_NOTES;
    delete process.env.HITL_AUTO_NOTES;
    dir = mkdtempSync(join(tmpdir(), "hitl-"));
    proofDir = join(dir, "hitl-proof");
    mkdirSync(proofDir, { recursive: true });
    logger = new RunLogger({ runId: "hitl-file", dir });
  });

  afterEach(async () => {
    await logger.close();
    rmSync(dir, { recursive: true, force: true });
    if (prev === undefined) delete process.env.HITL_MODE;
    else process.env.HITL_MODE = prev;
    if (prevAuto === undefined) delete process.env.HITL_AUTO_NOTES;
    else process.env.HITL_AUTO_NOTES = prevAuto;
  });

  it("writes evidence and resumes when resume file appears", async () => {
    process.env.HITL_MODE = "manual";
    const resumeFile = join(proofDir, "hitl-resume.json");
    const waiter = createFileWaitForOperator({
      proofDir,
      resumeFile,
      pollMs: 30,
      timeoutMs: 5_000,
      log: () => undefined,
    });

    const escalatePromise = escalateToHuman({
      driver: stubDriver(),
      logger,
      request,
      waitForOperator: waiter,
    });

    const reqPath = join(proofDir, "intervention-request.json");
    const deadline = Date.now() + 3_000;
    while (!existsSync(reqPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(existsSync(reqPath)).toBe(true);
    expect(existsSync(join(proofDir, "attach-instructions.txt"))).toBe(true);

    writeResumeSignal(resumeFile, "file handshake notes", { sessionId: "sess-test" });

    const result = await escalatePromise;
    expect(result.mode).toBe("manual");
    expect(result.operatorNotes).toBe("file handshake notes");
    expect(readFileSync(join(proofDir, "operator-notes.txt"), "utf8")).toContain(
      "file handshake notes",
    );
    expect(readFileSync(join(proofDir, "pause-log.txt"), "utf8")).toMatch(/HITL pause/);
  });

  it("HITL_AUTO_NOTES only works with explicit resume/operator file path", async () => {
    process.env.HITL_MODE = "manual";
    process.env.HITL_AUTO_NOTES = "auto notes from env";
    const resumeFile = join(proofDir, "operator-resume.json");

    // Without explicit path: must NOT use HITL_AUTO_NOTES (would hang / timeout).
    // With explicit path: auto-writes resume and returns.
    const waiter = createFileWaitForOperator({
      proofDir,
      resumeFile,
      pollMs: 20,
      timeoutMs: 2_000,
      log: () => undefined,
    });

    const result = await escalateToHuman({
      driver: stubDriver(),
      logger,
      request,
      waitForOperator: waiter,
    });
    expect(result.operatorNotes).toBe("auto notes from env");
    expect(existsSync(resumeFile)).toBe(true);
    const body = JSON.parse(readFileSync(resumeFile, "utf8"));
    expect(body.operatorNotes).toBe("auto notes from env");
  });

  it("does not honor HITL_AUTO_NOTES when resume path is only default", async () => {
    process.env.HITL_MODE = "manual";
    process.env.HITL_AUTO_NOTES = "should-not-apply";
    const waiter = createFileWaitForOperator({
      proofDir,
      // no resumeFile / operatorFile → resumeExplicit false
      pollMs: 20,
      timeoutMs: 200,
      log: () => undefined,
    });

    await expect(
      escalateToHuman({
        driver: stubDriver(),
        logger,
        request,
        waitForOperator: waiter,
      }),
    ).rejects.toThrow(/timed out/);
  });
});
