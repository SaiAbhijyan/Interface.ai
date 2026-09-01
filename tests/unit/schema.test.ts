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


  it("ParamDef.sensitive defaults to true when omitted", () => {
    const base = buildLookupSavingsArtifact("http://127.0.0.1:4173");
    const { sensitive: _drop, ...paramNoSensitive } = base.parameters[0]!;
    const a = CapabilityArtifactSchema.parse({
      ...base,
      parameters: [{ ...paramNoSensitive }],
    });
    expect(a.parameters[0]?.sensitive).toBe(true);
  });

  it("marks memberId sensitive in fixtures", () => {
    const lookup = buildLookupSavingsArtifact("http://127.0.0.1:4173");
    expect(lookup.parameters.find((p) => p.name === "memberId")?.sensitive).toBe(true);
    const open = buildOpenSubAccountArtifact("http://127.0.0.1:4173");
    expect(open.parameters.find((p) => p.name === "memberId")?.sensitive).toBe(true);
    expect(open.parameters.find((p) => p.name === "productCode")?.sensitive).toBe(true);
    // accountType is a non-PII product label — may be non-sensitive
    expect(open.parameters.find((p) => p.name === "accountType")?.sensitive).toBe(false);
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
