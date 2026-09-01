import { describe, it, expect } from "vitest";
import { artifactJsonFileName, safeArtifactBaseName } from "../../src/guardrails/safe-path.js";
import { PolicyViolation } from "../../src/guardrails/allowlist.js";

describe("safe artifact path (H1)", () => {
  it("allows simple names", () => {
    expect(artifactJsonFileName("lookup_member_savings_balance")).toBe(
      "lookup_member_savings_balance.json",
    );
  });

  it("rejects path traversal and separators", () => {
    expect(() => safeArtifactBaseName("../etc/passwd")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("foo/bar")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("..")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("")).toThrow(PolicyViolation);
  });
});
