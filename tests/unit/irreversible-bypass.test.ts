import { describe, it, expect } from "vitest";
import {
  resolveIrreversible,
  gateAction,
  decodeCssIdent,
  extractCssIds,
  extractCssNameSignals,
} from "../../src/guardrails/action-gate.js";
import { DEFAULT_ALLOWLIST, PolicyViolation } from "../../src/guardrails/allowlist.js";

function mustBlock(gated: Parameters<typeof resolveIrreversible>[0], label: string) {
  expect(resolveIrreversible(gated), label).toBe(true);
  expect(
    () => gateAction(gated, DEFAULT_ALLOWLIST, { confirmIrreversible: false }),
    label,
  ).toThrow(PolicyViolation);
}

describe("irreversible HIGH bypasses (Security NO-GO)", () => {
  it("decodes CSS hex escapes (#\\6f aSubmit → oaSubmit)", () => {
    expect(decodeCssIdent("#\\6f aSubmit")).toBe("#oaSubmit");
    expect(extractCssIds("#\\6f aSubmit")).toContain("oaSubmit");
  });

  it("gates placeholder Confirm Payment", () => {
    mustBlock(
      {
        action: "click",
        locator: {
          strategy: "placeholder",
          value: "Confirm Payment",
          alternatives: [],
        },
      },
      "placeholder Confirm Payment",
    );
  });

  it("gates CSS hex-escaped #\\6f aSubmit", () => {
    mustBlock(
      {
        action: "click",
        locator: {
          strategy: "css",
          value: "#\\6f aSubmit",
          alternatives: [],
        },
      },
      "hex-escaped css id",
    );
  });

  it("gates [id*=Confirm] / [id*=\"Confirm\"] substring selectors", () => {
    for (const value of ["[id*=Confirm]", '[id*="Confirm"]', "[id*=Submit]", "[id^=oaConfirm]"]) {
      mustBlock(
        {
          action: "click",
          locator: { strategy: "css", value, alternatives: [] },
        },
        value,
      );
    }
  });

  it("gates CSS name / aria-label / title / placeholder attribute signals", () => {
    for (const value of [
      '[aria-label="Confirm Payment"]',
      "[name=confirm]",
      '[title="Confirm Payment"]',
      '[placeholder="Confirm Payment"]',
      '[aria-label*="Submit"]',
    ]) {
      expect(extractCssNameSignals(value).length, value).toBeGreaterThan(0);
      mustBlock(
        {
          action: "click",
          locator: { strategy: "css", value, alternatives: [] },
        },
        value,
      );
    }
  });

  it("gates press text / hint Confirm Payment", () => {
    mustBlock({ action: "press", key: "Tab", value: "Confirm Payment" }, "press value");
    mustBlock(
      {
        action: "click",
        locator: { strategy: "css", value: "#oaSearch", alternatives: [] },
        hint: "Confirm Payment",
      },
      "hint",
    );
  });

  it("gates placeholder Submit Order", () => {
    mustBlock(
      {
        action: "click",
        locator: {
          strategy: "placeholder",
          value: "Submit Order",
          alternatives: [],
        },
      },
      "placeholder Submit Order",
    );
  });

  it("gates CSS hex-escaped #\\6f aConfirm", () => {
    expect(decodeCssIdent("#\\6f aConfirm")).toBe("#oaConfirm");
    expect(extractCssIds("#\\6f aConfirm")).toContain("oaConfirm");
    mustBlock(
      {
        action: "click",
        locator: {
          strategy: "css",
          value: "#\\6f aConfirm",
          alternatives: [],
        },
      },
      "hex-escaped #oaConfirm",
    );
  });

  it("gates [id*=Confirm] dedicated PoC", () => {
    mustBlock(
      {
        action: "click",
        locator: { strategy: "css", value: "[id*=Confirm]", alternatives: [] },
      },
      "[id*=Confirm]",
    );
  });

  it("gates Enter-to-submit (press Enter)", () => {
    mustBlock({ action: "press", key: "Enter" }, "press Enter");
  });
});
