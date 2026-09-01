import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PolicyViolation } from "../../src/guardrails/allowlist.js";
import {
  assertKnownDiscoveryTool,
  assertPreferReplay,
  evaluateDiscoveryStop,
  isKnownDiscoveryTool,
  preferReplayOverDiscover,
  validateDiscoveryToolArgs,
} from "../../src/agent/loop-policy.js";

describe("off-policy / invented tools", () => {
  it("rejects invented tools the model might hallucinate", () => {
    for (const name of ["type", "drag", "eval_js", "press", "screenshot", "wait"]) {
      expect(() => assertKnownDiscoveryTool(name)).toThrow(PolicyViolation);
      expect(isKnownDiscoveryTool(name)).toBe(false);
    }
  });

  it("allows the closed discovery tool set", () => {
    for (const name of [
      "observe",
      "click",
      "fill",
      "select",
      "navigate",
      "extract",
      "done",
      "escalate",
    ]) {
      expect(() => assertKnownDiscoveryTool(name)).not.toThrow();
    }
  });
});

describe("tool arg schema hygiene", () => {
  it("requires click strategy+value", () => {
    expect(() => validateDiscoveryToolArgs("click", { strategy: "role_name" })).toThrow(
      PolicyViolation,
    );
    expect(() =>
      validateDiscoveryToolArgs("click", { strategy: "role_name", value: "Lookup" }),
    ).not.toThrow();
  });

  it("rejects invalid locator strategies (invented)", () => {
    expect(() =>
      validateDiscoveryToolArgs("click", { strategy: "xpath", value: "//button" }),
    ).toThrow(PolicyViolation);
  });

  it("requires done contract fields", () => {
    expect(() => validateDiscoveryToolArgs("done", { name: "x" })).toThrow(PolicyViolation);
    expect(() =>
      validateDiscoveryToolArgs("done", {
        name: "lookup",
        description: "d",
        successDescription: "ok",
        successText: "Balance",
      }),
    ).not.toThrow();
  });
});

describe("discovery stop conditions", () => {
  it("continues under normal progress", () => {
    expect(
      evaluateDiscoveryStop({
        turn: 2,
        maxSteps: 20,
        consecutiveErrors: 0,
        consecutiveNoToolCalls: 0,
        done: false,
      }),
    ).toBe("continue");
  });

  it("stops on consecutive errors before inventing recovery", () => {
    expect(
      evaluateDiscoveryStop({
        turn: 5,
        maxSteps: 20,
        consecutiveErrors: 3,
        consecutiveNoToolCalls: 0,
        done: false,
      }),
    ).toBe("consecutive_errors");
  });

  it("stops when model stops calling tools", () => {
    expect(
      evaluateDiscoveryStop({
        turn: 4,
        maxSteps: 20,
        consecutiveErrors: 0,
        consecutiveNoToolCalls: 2,
        done: false,
      }),
    ).toBe("consecutive_no_tool_calls");
  });

  it("prefers done over other stops", () => {
    expect(
      evaluateDiscoveryStop({
        turn: 99,
        maxSteps: 20,
        consecutiveErrors: 9,
        consecutiveNoToolCalls: 9,
        done: true,
      }),
    ).toBe("done");
  });
});

describe("prefer replay once artifact exists", () => {
  it("discovers when no artifact path", () => {
    expect(preferReplayOverDiscover(undefined)).toBe("discover");
    expect(preferReplayOverDiscover("/no/such/artifact.json")).toBe("discover");
  });

  it("replays when artifact file exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iface-art-"));
    const art = path.join(dir, "cap.json");
    fs.writeFileSync(art, "{}");
    expect(preferReplayOverDiscover(art)).toBe("replay");
    expect(() => assertPreferReplay(art)).toThrow(PolicyViolation);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
