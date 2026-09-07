import { describe, it, expect } from "vitest";
import path from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CapabilityArtifactSchema, type Locator } from "../../src/artifact/schema.js";
import type {
  DriverLocator,
  ObserveSnapshot,
  SurfaceDriver,
  HumanSessionHandle,
} from "../../src/surface/types.js";
import { resolveWithFallbacks, replayCapability } from "../../src/replay/executor.js";
import { gateAction, resolveIrreversible } from "../../src/guardrails/action-gate.js";
import { DEFAULT_ALLOWLIST, PolicyViolation } from "../../src/guardrails/allowlist.js";
import { safeEvidenceFileToken } from "../../src/guardrails/safe-path.js";

/**
 * Stub: primary "Missing" / "Benign Missing" never resolves; irreversible alt wins.
 * Tracks whether any act (click/fill/…) was attempted.
 */
function stubFallbackDriver(altValue: string): SurfaceDriver & {
  actCount: number;
  acted: DriverLocator[];
} {
  const state = { actCount: 0, acted: [] as DriverLocator[] };
  const isAlt = (loc: DriverLocator) => loc.value === altValue;
  const isPrimaryMiss = (loc: DriverLocator) =>
    /missing/i.test(loc.value) || loc.value === "Benign Missing";
  return {
    kind: "web",
    get actCount() {
      return state.actCount;
    },
    get acted() {
      return state.acted;
    },
    open: async () => undefined,
    close: async () => undefined,
    observe: async (): Promise<ObserveSnapshot> => ({
      url: "http://127.0.0.1:4173/",
      title: "t",
      accessibilityTree: "",
      visibleText: "page",
      frames: [],
    }),
    click: async (locator) => {
      state.actCount += 1;
      state.acted.push(locator);
      throw new Error("click must not run when irreversible alt wins without confirm");
    },
    fill: async (locator) => {
      state.actCount += 1;
      state.acted.push(locator);
      throw new Error("fill must not run");
    },
    select: async (locator) => {
      state.actCount += 1;
      state.acted.push(locator);
      throw new Error("select must not run");
    },
    press: async () => {
      state.actCount += 1;
      throw new Error("press must not run");
    },
    navigate: async () => undefined,
    waitFor: async (locator) => {
      if (isPrimaryMiss(locator) || !isAlt(locator)) throw new Error("primary not found");
    },
    readText: async (locator) => {
      state.actCount += 1;
      state.acted.push(locator);
      throw new Error("read must not run");
    },
    isVisible: async (locator) => isAlt(locator),
    screenshot: async () => undefined,
    pauseForHuman: async (): Promise<HumanSessionHandle> => ({
      attachInstructions: "x",
      sessionId: "s",
      resume: async () => undefined,
    }),
  };
}

function artifactWithAlt(locator: Locator) {
  return CapabilityArtifactSchema.parse({
    version: "1.0.0",
    name: "winning_alt_irreversible_poc",
    description: "PoC: primary missing, irreversible alt must be gated before act",
    target: { kind: "web", entryUrl: "http://127.0.0.1:4173/", appId: "legacy-bank-mock" },
    parameters: [],
    outputs: [],
    steps: [
      {
        id: "s1",
        action: "click",
        description: "click via fallback",
        locator,
        irreversible: false,
        recoverableHints: [],
      },
    ],
    successCheckpoint: {
      id: "done",
      description: "done",
      locator: { strategy: "text", value: "Done", alternatives: [] },
      businessOutcomes: [],
    },
    locatorStrategyMeta: {
      preferredOrder: ["text", "css"],
      notes: "poc",
    },
    safety: {
      allowedOrigins: ["http://127.0.0.1:4173"],
      allowedActions: ["click", "navigate", "wait_for", "assert"],
      requiresConfirmationForIrreversible: true,
    },
    metadata: {
      discoveredAt: new Date().toISOString(),
      goal: "poc winning alt gate",
      synthetic: true,
    },
  });
}

describe("HIGH: re-gate winning locator after resolveWithFallbacks", () => {
  it("partial alt inherits strategy/role/frame like resolveWithFallbacks", () => {
    // Without merge, alt would have strategy undefined and miss CSS id policy.
    const gated = {
      action: "click" as const,
      irreversible: false,
      locator: {
        strategy: "css" as const,
        value: "#benignSearch",
        role: "button",
        frame: "Main",
        // partial alt: value only — must inherit strategy via merge
        alternatives: [{ value: "#oaSubmit" }] as unknown as Locator["alternatives"],
      },
    };
    expect(resolveIrreversible(gated)).toBe(true);
    expect(() =>
      gateAction(gated, DEFAULT_ALLOWLIST, { confirmIrreversible: false }),
    ).toThrow(PolicyViolation);
  });

  it("Benign Missing primary + alt #oaSubmit: resolveWithFallbacks winner alone is gated", async () => {
    const altValue = "#oaSubmit";
    const driver = stubFallbackDriver(altValue);
    const loc: Locator = {
      strategy: "text",
      value: "Missing",
      alternatives: [{ strategy: "css", value: altValue }],
    };
    const won = await resolveWithFallbacks(driver, loc, "wait");
    expect(won).not.toBeNull();
    expect(won!.value).toBe(altValue);
    expect(won!.alternatives ?? []).toEqual([]);
    // Re-gate winning locator alone (alternatives: []) — must block before any act
    expect(() =>
      gateAction(
        {
          action: "click",
          locator: { ...won!, alternatives: [] },
          irreversible: false,
        },
        DEFAULT_ALLOWLIST,
        { confirmIrreversible: false },
      ),
    ).toThrow(PolicyViolation);
    expect(driver.actCount).toBe(0);
  });

  it("replay: primary not present / irreversible fallback wins → irreversible_blocked before act", async () => {
    const altValue = "#oaSubmit";
    const driver = stubFallbackDriver(altValue);
    const dir = mkdtempSync(path.join(tmpdir(), "win-alt-"));
    try {
      const result = await replayCapability({
        artifact: artifactWithAlt({
          strategy: "text",
          value: "Benign Missing",
          alternatives: [{ strategy: "css", value: altValue }],
        }),
        params: {},
        driver,
        evidenceDir: dir,
        confirmIrreversible: false,
      });
      expect(result.status).toBe("hard_failure");
      expect(result.error?.taxonomy).toBe("irreversible_blocked");
      expect(driver.actCount).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replay: primary Missing + alt text Confirm Payment → blocked before act", async () => {
    const altValue = "Confirm Payment";
    const driver = stubFallbackDriver(altValue);
    const dir = mkdtempSync(path.join(tmpdir(), "win-alt-txt-"));
    try {
      const result = await replayCapability({
        artifact: artifactWithAlt({
          strategy: "text",
          value: "Missing",
          alternatives: [{ strategy: "text", value: altValue }],
        }),
        params: {},
        driver,
        evidenceDir: dir,
        confirmIrreversible: false,
      });
      expect(result.status).toBe("hard_failure");
      expect(result.error?.taxonomy).toBe("irreversible_blocked");
      expect(driver.actCount).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("MEDIUM: safeEvidenceFileToken keeps failure-*.png under evidenceDir", () => {
  it("stepId ../../etc/passwd or ../x must not escape evidenceDir", () => {
    const evidenceDir = path.resolve("/tmp/iface-evidence-poc");
    for (const stepId of ["../../etc/passwd", "../x", "/etc/passwd", "..\\\\..\\\\secret"]) {
      const token = safeEvidenceFileToken(stepId);
      expect(token).not.toMatch(/[\\/]/);
      expect(token).not.toContain("..");
      const shot = path.join(evidenceDir, `failure-${token}.png`);
      const resolved = path.resolve(shot);
      expect(resolved.startsWith(evidenceDir + path.sep) || resolved === evidenceDir).toBe(true);
      expect(path.basename(resolved)).toBe(`failure-${token}.png`);
      expect(path.dirname(resolved)).toBe(evidenceDir);
    }
  });
});
