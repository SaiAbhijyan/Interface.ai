import { writeFileSync } from "fs";
writeFileSync("src/hitl/handoff.ts", `/**
 * HITL on the SAME live SurfaceDriver session.
 * HITL_MODE=mock auto-resolves; HITL_MODE=manual FAIL-CLOSED until waitForOperator signals.
 */

import type { SurfaceDriver, HumanSessionHandle } from "../surface/types.js";
import type { RunLogger } from "../observability/logger.js";

export type InterventionRequest = {
  reason: string;
  goal?: string;
  capabilityName?: string;
  stepId?: string;
  observedSummary: string;
  screenshotPath?: string;
  createdAt: string;
};

export type InterventionResult = {
  sessionId: string;
  operatorNotes: string;
  resumedAt: string;
  mode: "mock" | "manual";
};

export type HitlMode = "mock" | "manual";

export function getHitlMode(): HitlMode {
  const m = (process.env.HITL_MODE ?? "mock").toLowerCase();
  return m === "manual" ? "manual" : "mock";
}

export class HitlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HitlBlockedError";
  }
}

export async function escalateToHuman(opts: {
  driver: SurfaceDriver;
  logger: RunLogger;
  request: InterventionRequest;
  mockDelayMs?: number;
  waitForOperator?: (handle: HumanSessionHandle, req: InterventionRequest) => Promise<string>;
}): Promise<InterventionResult> {
  const mode = getHitlMode();
  const handle = await opts.driver.pauseForHuman();

  opts.logger.warn("hitl", "Intervention requested — pausing automation on live session", {
    sessionId: handle.sessionId,
    reason: opts.request.reason,
    stepId: opts.request.stepId,
    attach: handle.attachInstructions,
  });

  const notesDefault =
    "Operator resolved: " + opts.request.reason + ". Session " + handle.sessionId + " retained.";

  let operatorNotes: string;

  if (mode === "mock") {
    const delay = opts.mockDelayMs ?? 50;
    opts.logger.info("hitl", "HITL_MODE=mock — auto-resolving after " + delay + "ms", {
      sessionId: handle.sessionId,
    });
    await new Promise((r) => setTimeout(r, delay));
    operatorNotes = notesDefault + " [mock operator]";
    await handle.resume();
  } else {
    // FAIL-CLOSED: manual mode requires an operator signal — never auto-resume
    if (!opts.waitForOperator) {
      opts.logger.error(
        "hitl",
        "HITL_MODE=manual requires waitForOperator — refusing to auto-resume",
      );
      throw new HitlBlockedError(
        "HITL_MODE=manual requires waitForOperator callback; refusing fail-open auto-resume",
      );
    }
    operatorNotes = await opts.waitForOperator(handle, opts.request);
    await handle.resume();
  }

  const result: InterventionResult = {
    sessionId: handle.sessionId,
    operatorNotes,
    resumedAt: new Date().toISOString(),
    mode,
  };
  opts.logger.info("hitl", "Control returned to automation", {
    sessionId: result.sessionId,
    operatorNotes: result.operatorNotes,
  });
  return result;
}
`);
console.log("hitl fail-closed ok");
