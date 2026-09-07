import { describe, it, expect } from "vitest";
import { gateAction, resolveIrreversible } from "../../src/guardrails/action-gate.js";
import { DEFAULT_ALLOWLIST, PolicyViolation } from "../../src/guardrails/allowlist.js";
import { safeArtifactBaseName } from "../../src/guardrails/safe-path.js";

describe("HIGH acceptance: alternatives irreversible (1)", () => {
  it("resolveIrreversible true if ANY alternative is irreversible (#oaSubmit)", () => {
    expect(
      resolveIrreversible({
        action: "click",
        irreversible: false,
        locator: {
          strategy: "text",
          value: "Benign Missing",
          alternatives: [{ strategy: "css", value: "#oaSubmit" }],
        },
      }),
    ).toBe(true);
  });

  it("resolveIrreversible true if alt Confirm Payment", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "css",
          value: "#benign",
          alternatives: [{ strategy: "placeholder", value: "Confirm Payment" }],
        },
      }),
    ).toBe(true);
  });

  it("Benign primary + #oaSubmit alt blocked without confirmIrreversible (2)", () => {
    const gated = {
      action: "click" as const,
      irreversible: false,
      locator: {
        strategy: "text" as const,
        value: "Benign Missing",
        alternatives: [{ strategy: "css" as const, value: "#oaSubmit" }],
      },
    };
    expect(() =>
      gateAction(gated, DEFAULT_ALLOWLIST, { confirmIrreversible: false }),
    ).toThrow(PolicyViolation);
    // Winning-alt shape: gate primary-only would miss; gate on won #oaSubmit must block
    expect(() =>
      gateAction(
        {
          action: "click",
          locator: { strategy: "css", value: "#oaSubmit", alternatives: [] },
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: false },
      ),
    ).toThrow(PolicyViolation);
    expect(() =>
      gateAction(
        {
          action: "extract",
          locator: { strategy: "css", value: "#oaSubmit", alternatives: [] },
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: false },
      ),
    ).toThrow(PolicyViolation);
  });

  it("allows when confirmIrreversible:true", () => {
    expect(() =>
      gateAction(
        {
          action: "click",
          locator: {
            strategy: "text",
            value: "Benign Missing",
            alternatives: [{ strategy: "css", value: "#oaSubmit" }],
          },
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: true },
      ),
    ).not.toThrow();
  });

  it("ordinary Search alt stays false", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "text",
          value: "Go",
          alternatives: [{ strategy: "text", value: "Search" }],
        },
      }),
    ).toBe(false);
  });
});

describe("HIGH acceptance: failure PNG stepId via safeArtifactBaseName (3)", () => {
  it("refuses ../ and separators", () => {
    expect(() => safeArtifactBaseName("../etc/passwd")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("foo/bar")).toThrow(PolicyViolation);
    expect(() => safeArtifactBaseName("..")).toThrow(PolicyViolation);
  });

  it("allows simple step ids for failure-${safeStepId}.png", () => {
    expect(safeArtifactBaseName("s7")).toBe("s7");
    expect(safeArtifactBaseName("step_1")).toBe("step_1");
  });
});
