import { describe, it, expect } from "vitest";
import {
  CapabilityArtifactSchema,
  ReplayResultSchema,
} from "../../src/artifact/schema.js";
import {
  buildLookupSavingsArtifact,
  buildOpenSubAccountArtifact,
} from "../../src/artifact/fixtures.js";

describe("CapabilityArtifact schema", () => {
  it("parses lookup fixture", () => {
    const a = buildLookupSavingsArtifact("http://127.0.0.1:4173");
    expect(a.version).toBe("1.0.0");
    expect(a.parameters[0]?.name).toBe("memberId");
    expect(a.steps.length).toBeGreaterThan(2);
    expect(a.successCheckpoint.id).toBe("success");
    expect(() => CapabilityArtifactSchema.parse(a)).not.toThrow();
  });

  it("parses open sub-account fixture with irreversible step", () => {
    const a = buildOpenSubAccountArtifact("http://127.0.0.1:4173");
    expect(a.steps.some((s) => s.irreversible)).toBe(true);
    expect(a.safety.requiresConfirmationForIrreversible).toBe(true);
  });

  it("rejects missing version", () => {
    expect(() =>
      CapabilityArtifactSchema.parse({
        name: "x",
        description: "y",
      }),
    ).toThrow();
  });
});

describe("ReplayResult schema", () => {
  it("accepts success", () => {
    const r = ReplayResultSchema.parse({
      status: "success",
      outputs: { savingsBalance: "$4,250.33" },
      evidence: { logPath: "/tmp/x.jsonl" },
      durationMs: 12,
    });
    expect(r.status).toBe("success");
  });

  it("accepts business_outcome and hard_failure", () => {
    ReplayResultSchema.parse({
      status: "business_outcome",
      businessOutcome: { code: "MEM_NOT_FOUND", message: "gone" },
      evidence: { logPath: "/tmp/x.jsonl" },
      durationMs: 1,
    });
    ReplayResultSchema.parse({
      status: "hard_failure",
      error: {
        stepId: "s1",
        expected: "click",
        observed: "missing",
        taxonomy: "element_not_found",
      },
      evidence: { logPath: "/tmp/x.jsonl", screenshotPath: "/tmp/f.png" },
      durationMs: 1,
    });
  });
});
