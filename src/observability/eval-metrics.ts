import type { ReplayResult, ReplayStatus } from "../artifact/schema.js";

/** Product-correct terminal statuses (not system failures). */
export const CAPABILITY_SUCCESS_STATUSES: readonly ReplayStatus[] = [
  "success",
  "business_outcome",
  "recoverable",
] as const;

export function isCapabilitySuccess(status: ReplayStatus): boolean {
  return (CAPABILITY_SUCCESS_STATUSES as readonly string[]).includes(status);
}

export function isSystemFailure(status: ReplayStatus): boolean {
  return status === "hard_failure";
}

/**
 * Labeling contract: domain outcomes must never be treated as hard_failure.
 * Callers use this when aggregating evidence packs.
 */
export function assertOutcomeLabeling(result: Pick<ReplayResult, "status" | "businessOutcome">): void {
  if (result.status === "business_outcome" && !result.businessOutcome?.code) {
    throw new Error("business_outcome requires businessOutcome.code");
  }
  if (result.status === "hard_failure" && result.businessOutcome?.code) {
    throw new Error(
      `Mislabel: hard_failure must not carry businessOutcome (${result.businessOutcome.code}); use business_outcome`,
    );
  }
  if (result.status === "success" && result.businessOutcome) {
    throw new Error("success must not carry businessOutcome; use business_outcome status");
  }
}

export type EvidenceRunSummary = {
  status: ReplayStatus;
  durationMs: number;
  businessOutcomeCode?: string;
  errorTaxonomy?: string;
  hasLog: boolean;
  hasScreenshot: boolean;
};

export type EvalAggregate = {
  n: number;
  capabilitySuccessRate: number;
  trueFailureRate: number;
  businessOutcomeRate: number;
  policyBlockRate: number;
  medianDurationMs: number;
  evidenceCompletenessRate: number;
};

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

/** Aggregate discovery/replay evidence packs into reportable rates. */
export function aggregateEvidence(runs: EvidenceRunSummary[]): EvalAggregate {
  const n = runs.length;
  if (n === 0) {
    return {
      n: 0,
      capabilitySuccessRate: 0,
      trueFailureRate: 0,
      businessOutcomeRate: 0,
      policyBlockRate: 0,
      medianDurationMs: 0,
      evidenceCompletenessRate: 0,
    };
  }
  const capOk = runs.filter((r) => isCapabilitySuccess(r.status)).length;
  const hard = runs.filter((r) => r.status === "hard_failure").length;
  const bo = runs.filter((r) => r.status === "business_outcome").length;
  const policy = runs.filter(
    (r) =>
      r.status === "hard_failure" &&
      (r.errorTaxonomy === "policy_violation" || r.errorTaxonomy === "irreversible_blocked"),
  ).length;
  const complete = runs.filter((r) => {
    if (!r.hasLog) return false;
    if (r.status === "hard_failure") return r.hasScreenshot;
    return true;
  }).length;

  return {
    n,
    capabilitySuccessRate: capOk / n,
    trueFailureRate: hard / n,
    businessOutcomeRate: bo / n,
    policyBlockRate: policy / n,
    medianDurationMs: median(runs.map((r) => r.durationMs)),
    evidenceCompletenessRate: complete / n,
  };
}

/** Same artifact+params: statuses (and BO codes) must match across runs. */
export function stabilityScore(
  runs: Array<{ status: ReplayStatus; businessOutcomeCode?: string; outputsKey?: string }>,
): { stable: boolean; statusAgreement: number } {
  if (runs.length === 0) return { stable: true, statusAgreement: 1 };
  const first = runs[0]!;
  const agree = runs.filter((r) => {
    if (r.status !== first.status) return false;
    if (r.status === "business_outcome" && r.businessOutcomeCode !== first.businessOutcomeCode) {
      return false;
    }
    if (r.status === "success" && first.outputsKey !== undefined && r.outputsKey !== first.outputsKey) {
      return false;
    }
    return true;
  }).length;
  const statusAgreement = agree / runs.length;
  return { stable: statusAgreement === 1, statusAgreement };
}

export function summarizeReplayResult(result: ReplayResult): EvidenceRunSummary {
  assertOutcomeLabeling(result);
  return {
    status: result.status,
    durationMs: result.durationMs,
    businessOutcomeCode: result.businessOutcome?.code,
    errorTaxonomy: result.error?.taxonomy,
    hasLog: Boolean(result.evidence?.logPath),
    hasScreenshot: Boolean(result.evidence?.screenshotPath),
  };
}
