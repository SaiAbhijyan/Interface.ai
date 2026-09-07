import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CapabilityArtifactSchema, type Locator } from "../../src/artifact/schema.js";
import type {
  DriverLocator,
  ObserveSnapshot,
  SurfaceDriver,
  HumanSessionHandle,
} from "../../src/surface/types.js";
import { resolveWithFallbacks, replayCapability } from "../../src/replay/executor.js";

/**
 * Stub driver: primary locator NEVER resolves; alternative "Alt Target" does.
 * Action methods throw if callers wait-on-alt then act-on-primary.
 */
function stubDriver(): SurfaceDriver & { lastActedValue: string | null; acted: DriverLocator[] } {
  const state = {
    lastActedValue: null as string | null,
    acted: [] as DriverLocator[],
  };
  const isAlt = (loc: DriverLocator) => loc.value === "Alt Target";
  const driver: SurfaceDriver & { lastActedValue: string | null; acted: DriverLocator[] } = {
    kind: "web",
    get lastActedValue() {
      return state.lastActedValue;
    },
    set lastActedValue(v: string | null) {
      state.lastActedValue = v;
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
      visibleText: "Done Alt Target",
      frames: [],
    }),
    click: async (locator) => {
      state.lastActedValue = locator.value;
      state.acted.push(locator);
      if (!isAlt(locator)) throw new Error("acted on primary — winning alt ignored");
    },
    fill: async (locator, _value) => {
      state.lastActedValue = locator.value;
      state.acted.push(locator);
      if (!isAlt(locator)) throw new Error("acted on primary — winning alt ignored");
    },
    select: async (locator) => {
      state.lastActedValue = locator.value;
      state.acted.push(locator);
      if (!isAlt(locator)) throw new Error("acted on primary — winning alt ignored");
    },
    press: async () => undefined,
    navigate: async () => undefined,
    waitFor: async (locator) => {
      if (!isAlt(locator)) throw new Error("primary not found");
    },
    readText: async (locator) => {
      state.lastActedValue = locator.value;
      state.acted.push(locator);
      if (!isAlt(locator)) throw new Error("acted on primary — winning alt ignored");
      return "extracted-via-alt";
    },
    isVisible: async (locator) => isAlt(locator),
    screenshot: async () => undefined,
    pauseForHuman: async (): Promise<HumanSessionHandle> => ({
      attachInstructions: "x",
      sessionId: "s",
      resume: async () => undefined,
    }),
  };
  return driver;
}

const locWithAlt: Locator = {
  strategy: "role_name",
  role: "button",
  value: "Primary Missing",
  alternatives: [{ strategy: "role_name", role: "button", value: "Alt Target" }],
};

function minimalArtifact(action: "click" | "fill" | "select" | "extract") {
  const stepBase = {
    id: "s1",
    description: `exercise ${action} with alt locator`,
    locator: locWithAlt,
    irreversible: false,
    recoverableHints: [] as string[],
  };
  const step =
    action === "fill"
      ? { ...stepBase, action, value: "typed" }
      : action === "select"
        ? { ...stepBase, action, value: "opt" }
        : action === "extract"
          ? { ...stepBase, action, outputName: "out" }
          : { ...stepBase, action };

  return CapabilityArtifactSchema.parse({
    version: "1.0.0",
    name: `fallback_${action}`,
    description: "unit fixture",
    target: { kind: "web", entryUrl: "http://127.0.0.1:4173/", appId: "legacy-bank-mock" },
    parameters: [],
    outputs:
      action === "extract"
        ? [{ name: "out", type: "string", description: "x" }]
        : [],
    steps: [step],
    successCheckpoint: {
      id: "done",
      description: "done",
      locator: {
        strategy: "text",
        value: "Alt Target",
        alternatives: [],
      },
      businessOutcomes: [],
    },
    locatorStrategyMeta: {
      preferredOrder: ["role_name", "text", "css"],
      notes: "test",
    },
    safety: {
      allowedOrigins: ["http://127.0.0.1:4173"],
      allowedActions: ["click", "fill", "select", "extract", "navigate", "wait_for", "assert"],
      requiresConfirmationForIrreversible: true,
    },
    metadata: {
      discoveredAt: new Date().toISOString(),
      goal: "test winning fallback",
      synthetic: true,
    },
  });
}

describe("resolveWithFallbacks winning locator (SR HOLD)", () => {
  it("returns the alternative that resolved, not the primary", async () => {
    const driver = stubDriver();
    const won = await resolveWithFallbacks(driver, locWithAlt, "wait");
    expect(won).not.toBeNull();
    expect(won!.value).toBe("Alt Target");
  });

  it("fails if action uses primary after alt won (direct click)", async () => {
    const driver = stubDriver();
    const won = await resolveWithFallbacks(driver, locWithAlt, "wait");
    expect(won!.value).toBe("Alt Target");
    await driver.click({ strategy: won!.strategy, value: won!.value, role: won!.role });
    expect(driver.lastActedValue).toBe("Alt Target");
    await expect(
      driver.click({ strategy: "role_name", value: "Primary Missing", role: "button" }),
    ).rejects.toThrow(/winning alt ignored/);
  });

  for (const action of ["click", "fill", "select", "extract"] as const) {
    it(`executeStep/${action} acts on winning alternative (fails if primary-only)`, async () => {
      const driver = stubDriver();
      const dir = mkdtempSync(join(tmpdir(), `fb-${action}-`));
      try {
        const result = await replayCapability({
          artifact: minimalArtifact(action),
          params: {},
          driver,
          evidenceDir: dir,
        });
        expect(result.status).toBe("success");
        expect(driver.acted.length).toBeGreaterThanOrEqual(1);
        for (const loc of driver.acted) {
          expect(loc.value).toBe("Alt Target");
        }
        if (action === "extract") {
          expect(result.outputs?.out).toBe("extracted-via-alt");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
