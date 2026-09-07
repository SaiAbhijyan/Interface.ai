import { describe, it, expect } from "vitest";
import { artifactJsonFileName, safeArtifactBaseName, safeFileToken, safeEvidenceFileToken } from "../../src/guardrails/safe-path.js";
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

describe("failure PNG stepId via safeArtifactBaseName (Security acceptance)", () => {
  it("refuses ../ and separators", () => {
    expect(() => safeArtifactBaseName("../x")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("a/b")).toThrow(PolicyViolation);
  });
  it("safeFileToken soft-sanitizes as fallback helper", () => {
    expect(safeFileToken("../../x")).not.toMatch(/\//);
    expect(safeFileToken("a/b/c")).toBe("a_b_c");
    expect(safeFileToken("ok-step_1")).toBe("ok-step_1");
  });
});

describe("safeEvidenceFileToken (alias)", () => {
  it("matches safeFileToken and blocks traversal", () => {
    expect(safeEvidenceFileToken("../../etc/passwd")).toBe(safeFileToken("../../etc/passwd"));
    // Soft-sanitize: "../x" → "_x" (no / or .. left); still path-safe under evidenceDir
    expect(safeEvidenceFileToken("../x")).toBe("_x");
    expect(safeEvidenceFileToken("../x")).not.toMatch(/\/|\\|\.\./);
    expect(safeEvidenceFileToken("ok_step-1")).toBe("ok_step-1");
  });
});
