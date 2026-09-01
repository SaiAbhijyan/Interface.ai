import { describe, it, expect } from "vitest";
import {
  assertOriginAllowed,
  assertUrlAllowed,
  assertActionAllowed,
  assertIrreversibleAllowed,
  assertPathAllowed,
  DEFAULT_ALLOWLIST,
  PolicyViolation,
} from "../../src/guardrails/allowlist.js";
import { gateAction, resolveIrreversible } from "../../src/guardrails/action-gate.js";

describe("origin allowlist (port-bound)", () => {
  it("allows default mock origin", () => {
    expect(() =>
      assertOriginAllowed("http://127.0.0.1:4173/lookup.html", DEFAULT_ALLOWLIST),
    ).not.toThrow();
  });

  it("rejects other localhost ports (SSRF)", () => {
    for (const port of [6379, 9200, 8500, 3000, 8080]) {
      expect(() =>
        assertOriginAllowed(`http://127.0.0.1:${port}/`, DEFAULT_ALLOWLIST),
      ).toThrow(PolicyViolation);
    }
  });

  it("rejects external hosts", () => {
    expect(() =>
      assertOriginAllowed("https://evil.example/login", DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
  });

  it("assertUrlAllowed checks origin AND path", () => {
    expect(() =>
      assertUrlAllowed("http://127.0.0.1:4173/lookup.html", DEFAULT_ALLOWLIST),
    ).not.toThrow();
    expect(() =>
      assertUrlAllowed("http://127.0.0.1:4173/secret-admin.html", DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
  });

  it("does not allow arbitrary .js on host (no asset-suffix bypass)", () => {
    expect(() =>
      assertPathAllowed("http://127.0.0.1:4173/evil.js", DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
    expect(() =>
      assertPathAllowed("http://127.0.0.1:4173/bank-logic.js", DEFAULT_ALLOWLIST),
    ).not.toThrow();
  });

  it("blocks disallowed actions", () => {
    const cfg = { ...DEFAULT_ALLOWLIST, allowedActions: ["click" as const] };
    expect(() => assertActionAllowed("click", cfg)).not.toThrow();
    expect(() => assertActionAllowed("fill", cfg)).toThrow(PolicyViolation);
  });

  it("blocks irreversible without confirmation", () => {
    expect(() => assertIrreversibleAllowed(true, false)).toThrow(PolicyViolation);
    expect(() => assertIrreversibleAllowed(true, true)).not.toThrow();
  });
});

describe("irreversible policy (no name heuristics)", () => {
  it("gates #oaSubmit even when irreversible:false and no confirm substring", () => {
    expect(
      resolveIrreversible({
        action: "click",
        irreversible: false,
        locator: { strategy: "css", value: "#oaSubmit", alternatives: [] },
      }),
    ).toBe(true);

    expect(() =>
      gateAction(
        {
          action: "click",
          irreversible: false,
          locator: { strategy: "css", value: "#oaSubmit", alternatives: [] },
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: false },
      ),
    ).toThrow(PolicyViolation);
  });

  it("gates role/name Submit without confirm substring", () => {
    expect(
      resolveIrreversible({
        action: "click",
        irreversible: false,
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Submit",
          alternatives: [],
        },
      }),
    ).toBe(true);
  });

  it("respects explicit irreversible:true on unknown locators", () => {
    expect(
      resolveIrreversible({
        action: "click",
        irreversible: true,
        locator: { strategy: "css", value: "#somethingElse", alternatives: [] },
      }),
    ).toBe(true);
  });

  it("does not flag ordinary Search button", () => {
    expect(
      resolveIrreversible({
        action: "click",
        irreversible: false,
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Search",
          alternatives: [],
        },
      }),
    ).toBe(false);
  });
});


describe("irreversible name normalize (allowlist suite)", () => {
  it("gates Confirm & Submit case/spacing variants", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "  confirm  &  submit ",
          alternatives: [],
        },
      }),
    ).toBe(true);
  });
});
