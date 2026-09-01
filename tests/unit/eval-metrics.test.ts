import { describe, it, expect } from "vitest";
import {
  aggregateEvidence,
  assertOutcomeLabeling,
  isCapabilitySuccess,
  isSystemFailure,
  stabilityScore,
  summarizeReplayResult,
} from "../../src/observability/eval-metrics.js";
import type { ReplayResult } from "../../src/artifact/schema.js";

describe("business_outcome vs failure labeling", () => {
  it("treats success and business_outcome as capability success, not system failure", () => {
    expect(isCapabilitySuccess("success")).toBe(true);
    expect(isCapabilitySuccess("business_outcome")).toBe(true);
    expect(isSystemFailure("business_outcome")).toBe(false);
    expect(isSystemFailure("hard_failure")).toBe(true);
    expect(isCapabilitySuccess("hard_failure")).toBe(false);
  });

  it("rejects mislabel: hard_failure carrying a businessOutcome code", () => {
    expect(() =>
      assertOutcomeLabeling({
        status: "hard_failure",
        businessOutcome: { code: "MEM_NOT_FOUND", message: "x" },
      }),
    ).toThrow(/Mislabel/);
  });

  it("requires code on business_outcome", () => {
    expect(() => assertOutcomeLabeling({ status: "business_outcome" })).toThrow(/requires/);
  });
});

describe("discovery vs replay evidence metrics", () => {
  it("aggregates success / BO / hard_failure packs into rates", () => {
    const agg = aggregateEvidence([
      { status: "success", durationMs: 1100, hasLog: true, hasScreenshot: false },
      {
        status: "business_outcome",
        durationMs: 800,
        businessOutcomeCode: "MEM_NOT_FOUND",
        hasLog: true,
        hasScreenshot: false,
      },
      {
        status: "hard_failure",
        durationMs: 500,
        errorTaxonomy: "policy_violation",
        hasLog: true,
        hasScreenshot: true,
      },
    ]);
    expect(agg.n).toBe(3);
    expect(agg.capabilitySuccessRate).toBeCloseTo(2 / 3);
    expect(agg.trueFailureRate).toBeCloseTo(1 / 3);
    expect(agg.businessOutcomeRate).toBeCloseTo(1 / 3);
    expect(agg.policyBlockRate).toBeCloseTo(1 / 3);
    expect(agg.medianDurationMs).toBe(800);
    expect(agg.evidenceCompletenessRate).toBe(1);
  });

  it("scores stability across identical replay classifications", () => {
    const stable = stabilityScore([
      { status: "business_outcome", businessOutcomeCode: "MEM_NOT_FOUND" },
      { status: "business_outcome", businessOutcomeCode: "MEM_NOT_FOUND" },
      { status: "business_outcome", businessOutcomeCode: "MEM_NOT_FOUND" },
    ]);
    expect(stable.stable).toBe(true);
    expect(stable.statusAgreement).toBe(1);

    const unstable = stabilityScore([
      { status: "success", outputsKey: "a" },
      { status: "hard_failure" },
    ]);
    expect(unstable.stable).toBe(false);
  });

  it("summarizes canonical evidence shapes", () => {
    const success: ReplayResult = {
      status: "success",
      outputs: { savingsBalance: "$4,250.33" },
      evidence: { logPath: "/tmp/run.jsonl" },
      durationMs: 1101,
    };
    const bo: ReplayResult = {
      status: "business_outcome",
      businessOutcome: {
        code: "MEM_NOT_FOUND",
        message: "No member exists for the given Member ID",
      },
      evidence: { logPath: "/tmp/bo.jsonl" },
      durationMs: 827,
    };
    expect(summarizeReplayResult(success).status).toBe("success");
    expect(summarizeReplayResult(bo).businessOutcomeCode).toBe("MEM_NOT_FOUND");
  });
});
