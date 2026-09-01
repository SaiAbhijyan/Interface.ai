import { describe, it, expect } from "vitest";
import {
  assertSchemeAllowed,
  assertOriginAllowed,
  isNavigationSchemeAllowed,
  DEFAULT_ALLOWLIST,
  PolicyViolation,
} from "../../src/guardrails/allowlist.js";
import { gateAction, resolveIrreversible, normalizeControlName } from "../../src/guardrails/action-gate.js";
import { prepareFillGate } from "../../src/agent/discover.js";
import { PlaywrightSurfaceDriver } from "../../src/surface/playwright-driver.js";

describe("scheme / data: residuals", () => {
  it("isNavigationSchemeAllowed allows only about:blank(+hash) and http(s)", () => {
    expect(isNavigationSchemeAllowed("about:blank")).toBe(true);
    expect(isNavigationSchemeAllowed("about:blank#frag")).toBe(true);
    expect(isNavigationSchemeAllowed("http://127.0.0.1:4173/")).toBe(true);
    expect(isNavigationSchemeAllowed("https://example.com/")).toBe(true);
    expect(isNavigationSchemeAllowed("data:text/html,hi")).toBe(false);
    expect(isNavigationSchemeAllowed("blob:http://127.0.0.1:4173/x")).toBe(false);
    expect(isNavigationSchemeAllowed("javascript:alert(1)")).toBe(false);
    expect(isNavigationSchemeAllowed("about:srcdoc")).toBe(false);
    expect(isNavigationSchemeAllowed("file:///etc/passwd")).toBe(false);
  });

  it("blocks data: blob: javascript:", () => {
    expect(() => assertSchemeAllowed("data:text/html,hi")).toThrow(PolicyViolation);
    expect(() => assertSchemeAllowed("blob:http://127.0.0.1:4173/x")).toThrow(PolicyViolation);
    expect(() => assertSchemeAllowed("javascript:alert(1)")).toThrow(PolicyViolation);
  });

  it("allows only about:blank among about: URLs", () => {
    expect(() => assertSchemeAllowed("about:blank")).not.toThrow();
    expect(() => assertSchemeAllowed("about:blank#x")).not.toThrow();
    expect(() => assertSchemeAllowed("about:srcdoc")).toThrow(PolicyViolation);
  });

  it("origin check also rejects data:", () => {
    expect(() => assertOriginAllowed("data:text/html,x", DEFAULT_ALLOWLIST)).toThrow(
      PolicyViolation,
    );
  });
});

describe("fill/select gate completeness", () => {
  it("requires locator for fill and select", () => {
    expect(() =>
      gateAction({ action: "fill", value: "x" }, DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
    expect(() =>
      gateAction({ action: "select", value: "Savings" }, DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
  });

  it("allows fill with locator", () => {
    expect(() =>
      gateAction(
        {
          action: "fill",
          locator: { strategy: "label", value: "Member ID", alternatives: [] },
          value: "10001",
        },
        DEFAULT_ALLOWLIST,
      ),
    ).not.toThrow();
  });

  it("dangerous CSS locator on fill throws via gateAction", () => {
    expect(() =>
      gateAction(
        {
          action: "fill",
          locator: {
            strategy: "css",
            value: "input[onclick=javascript:alert(1)]",
            alternatives: [],
          },
          value: "x",
        },
        DEFAULT_ALLOWLIST,
      ),
    ).toThrow(/dangerous CSS/i);
  });

  it("prepareFillGate then gateAction blocks dangerous CSS (discover path)", () => {
    const { locator, text } = prepareFillGate(
      {
        strategy: "css",
        locatorValue: "div[style*=data:text/html]",
        value: "typed",
      },
      {},
    );
    expect(() =>
      gateAction({ action: "fill", locator, value: text }, DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
  });

  it("prepareFillGate fails closed without locatorValue", () => {
    expect(() =>
      prepareFillGate({ strategy: "label", value: "10001" }, {}),
    ).toThrow(PolicyViolation);
  });

  it("press requires key and gates allowlist", () => {
    expect(() => gateAction({ action: "press" }, DEFAULT_ALLOWLIST)).toThrow(PolicyViolation);
    expect(() =>
      gateAction({ action: "press", key: "Enter" }, DEFAULT_ALLOWLIST),
    ).not.toThrow();
    expect(() =>
      gateAction({ action: "press", key: "Meta+a" }, DEFAULT_ALLOWLIST),
    ).toThrow(PolicyViolation);
  });
});

describe("irreversible role-name normalize + fail-closed submit/confirm", () => {
  it("normalizeControlName trims and collapses whitespace", () => {
    expect(normalizeControlName("  Confirm   &  Submit ")).toBe("confirm & submit");
  });

  it("matches Confirm & Submit spacing/case variants via normalize", () => {
    for (const name of ["Confirm & Submit", "confirm & submit", "  Confirm   &  Submit  ", "CONFIRM & SUBMIT"]) {
      expect(
        resolveIrreversible({
          action: "click",
          locator: { strategy: "role_name", role: "button", value: name, alternatives: [] },
        }),
      ).toBe(true);
    }
  });

  it("Confirm Me is irreversible (fail-closed confirm word)", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: { strategy: "role_name", role: "button", value: "Confirm Me", alternatives: [] },
      }),
    ).toBe(true);
  });

  it("unknown Confirm Payment gates as irreversible (fail-closed)", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Confirm Payment",
          alternatives: [],
        },
      }),
    ).toBe(true);
    expect(() =>
      gateAction(
        {
          action: "click",
          locator: {
            strategy: "role_name",
            role: "button",
            value: "Confirm Payment",
            alternatives: [],
          },
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: false },
      ),
    ).toThrow(PolicyViolation);
  });

  it("ordinary Search still false", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Search",
          alternatives: [],
        },
      }),
    ).toBe(false);
  });

  it("Resubmit Form is not whole-word submit — stays false", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Resubmit Form",
          alternatives: [],
        },
      }),
    ).toBe(false);
  });
});

describe("framenavigated TOCTOU fail-closed", () => {
  it("assertNoNavViolation throws PolicyViolation after simulateNavViolation", () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    expect(() => driver.assertNoNavViolation()).not.toThrow();
    driver.simulateNavViolation("test framenavigated escape");
    expect(() => driver.assertNoNavViolation()).toThrow(PolicyViolation);
    expect(() => driver.assertNoNavViolation()).toThrow(/framenavigated|test framenavigated/i);
  });

  it("subsequent observe throws after simulated violation once opened is N/A — flag alone fails closed", async () => {
    const driver = new PlaywrightSurfaceDriver({ headless: true });
    driver.simulateNavViolation("blocked off-allowlist nav");
    // open itself clears the flag at start — prove assertNoNavViolation is what ops call
    expect(() => driver.assertNoNavViolation()).toThrow(PolicyViolation);
  });
});

describe("css #id irreversible fail-closed", () => {
  it("gates policy cssIds (explicit still wins)", () => {
    expect(
      resolveIrreversible({
        action: "click",
        locator: { strategy: "css", value: "#oaSubmit", alternatives: [] },
      }),
    ).toBe(true);
    expect(
      resolveIrreversible({
        action: "click",
        locator: { strategy: "css", value: "#oaConfirm", alternatives: [] },
      }),
    ).toBe(true);
  });

  it("gates #confirmPayment / #submitNow and similar id tokens", () => {
    for (const id of ["#confirmPayment", "#submitNow", "#btn-submit"]) {
      expect(
        resolveIrreversible({
          action: "click",
          locator: { strategy: "css", value: id, alternatives: [] },
        }),
      ).toBe(true);
    }
  });

  it("keeps #oaSearch / #resubmitBtn false (no whole-word submit/confirm)", () => {
    for (const id of ["#oaSearch", "#resubmitBtn", "#searchBtn"]) {
      expect(
        resolveIrreversible({
          action: "click",
          locator: { strategy: "css", value: id, alternatives: [] },
        }),
      ).toBe(false);
    }
  });
});
