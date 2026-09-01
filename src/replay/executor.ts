import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import {
  CapabilityArtifactSchema,
  type CapabilityArtifact,
  type Locator,
  type ReplayResult,
  type Step,
} from "../artifact/schema.js";
import type { SurfaceDriver, DriverLocator } from "../surface/types.js";
import {
  assertUrlAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";
import { gateAction, resolveIrreversible } from "../guardrails/action-gate.js";
import { RunLogger } from "../observability/logger.js";
import { escalateToHuman } from "../hitl/handoff.js";

export type ReplayOptions = {
  artifact: CapabilityArtifact;
  params: Record<string, string | number | boolean>;
  driver: SurfaceDriver;
  evidenceDir: string;
  confirmIrreversible?: boolean;
  /** Escalate to HITL on hard_failure instead of returning immediately */
  hitlOnHardFailure?: boolean;
};

function toDriverLocator(loc: Locator): DriverLocator {
  return {
    strategy: loc.strategy,
    value: loc.value,
    role: loc.role,
    frame: loc.frame,
  };
}

async function resolveWithFallbacks(
  driver: SurfaceDriver,
  loc: Locator,
  op: "wait" | "visible",
): Promise<boolean> {
  const chain = [loc, ...(loc.alternatives ?? []).map((a) => ({ ...loc, ...a }))];
  for (const candidate of chain) {
    const d = toDriverLocator(candidate);
    try {
      if (op === "wait") {
        await driver.waitFor(d, 5_000);
        return true;
      }
      if (await driver.isVisible(d, 1_500)) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

function matchBusinessOutcome(
  text: string,
  patterns: { pattern: string; code: string; message: string }[],
): { code: string; message: string } | null {
  for (const p of patterns) {
    const re = new RegExp(p.pattern, "i");
    if (re.test(text)) return { code: p.code, message: p.message };
  }
  return null;
}

function validateParams(
  artifact: CapabilityArtifact,
  params: Record<string, string | number | boolean>,
): void {
  for (const p of artifact.parameters) {
    if (p.required && !(p.name in params)) {
      throw new Error(`Missing required parameter: ${p.name}`);
    }
  }
}

export async function replayCapability(opts: ReplayOptions): Promise<ReplayResult> {
  const started = Date.now();
  const artifact = CapabilityArtifactSchema.parse(opts.artifact);
  validateParams(artifact, opts.params);

  const runId = randomUUID().slice(0, 8);
  const evidenceDir = path.join(opts.evidenceDir, `replay-${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const logger = new RunLogger({ runId, dir: evidenceDir });
  const allowlist = loadAllowlistFromEnv();

  const fail = async (
    stepId: string,
    expected: string,
    observed: string,
    taxonomy: NonNullable<ReplayResult["error"]>["taxonomy"],
    status: ReplayResult["status"] = "hard_failure",
  ): Promise<ReplayResult> => {
    const shot = path.join(evidenceDir, `failure-${stepId}.png`);
    try {
      await opts.driver.screenshot(shot);
    } catch {
      /* ignore */
    }
    logger.error("replay", `Failure at step ${stepId}`, { expected, observed, taxonomy, status });
    await logger.close();
    return {
      status,
      error: { stepId, expected, observed, taxonomy },
      evidence: {
        logPath: logger.logPath,
        screenshotPath: fs.existsSync(shot) ? shot : undefined,
      },
      durationMs: Date.now() - started,
    };
  };

  try {
    assertUrlAllowed(artifact.target.entryUrl, allowlist);
    logger.info("replay", "Starting deterministic replay", {
      capability: artifact.name,
      entryUrl: artifact.target.entryUrl,
      params: Object.fromEntries(
        Object.entries(opts.params).map(([k, v]) => {
          const def = artifact.parameters.find((p) => p.name === k);
          return [k, def?.sensitive ? "[REDACTED]" : v];
        }),
      ),
    });

    await opts.driver.open(artifact.target.entryUrl);

    const outputs: Record<string, string | number | boolean> = {};

    for (const step of artifact.steps) {
      logger.info("replay", `Step ${step.id}: ${step.action} — ${step.description}`);

      try {
        gateAction(
          {
            action: step.action,
            url: step.url,
            locator: step.locator,
            value: step.value,
            key: step.key,
            irreversible: step.irreversible,
          },
          allowlist,
          { confirmIrreversible: opts.confirmIrreversible },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const irrev =
          resolveIrreversible({
            action: step.action,
            url: step.url,
            locator: step.locator,
            value: step.value,
            key: step.key,
            irreversible: step.irreversible,
          });
        const taxonomy =
          e instanceof PolicyViolation && irrev
            ? "irreversible_blocked"
            : "policy_violation";
        return await fail(step.id, "policy allow", msg, taxonomy);
      }

      // Recoverable: dismiss known interstitials
      for (const hint of step.recoverableHints ?? []) {
        const visible = await opts.driver.isVisible(
          { strategy: "text", value: hint },
          800,
        );
        if (visible) {
          logger.warn("replay", "Recoverable interstitial detected — dismissing", { hint });
          try {
            await opts.driver.click({ strategy: "text", value: hint });
          } catch {
            /* best-effort */
          }
        }
      }

      try {
        await executeStep(opts.driver, step, opts.params, outputs, logger);
      } catch (e) {
        const observed = e instanceof Error ? e.message : String(e);

        // After action, check business outcomes on page text if checkpoint defines them
        if (step.checkpoint?.businessOutcomes?.length) {
          const snap = await opts.driver.observe();
          const bo = matchBusinessOutcome(snap.visibleText, step.checkpoint.businessOutcomes);
          if (bo) {
            logger.info("replay", "Business outcome detected", bo);
            await logger.close();
            return {
              status: "business_outcome",
              businessOutcome: bo,
              evidence: { logPath: logger.logPath },
              durationMs: Date.now() - started,
            };
          }
        }

        if (opts.hitlOnHardFailure) {
          await escalateToHuman({
            driver: opts.driver,
            logger,
            request: {
              reason: `Replay stuck at step ${step.id}: ${observed}`,
              capabilityName: artifact.name,
              stepId: step.id,
              observedSummary: observed,
              createdAt: new Date().toISOString(),
            },
          });
          // After HITL, retry once
          try {
            await executeStep(opts.driver, step, opts.params, outputs, logger);
            continue;
          } catch (e2) {
            return await fail(
              step.id,
              step.description,
              e2 instanceof Error ? e2.message : String(e2),
              "element_not_found",
            );
          }
        }

        return await fail(step.id, step.description, observed, "element_not_found");
      }

      // Per-step checkpoint + business outcomes
      if (step.checkpoint) {
        const snap = await opts.driver.observe();
        const bo = matchBusinessOutcome(
          snap.visibleText,
          step.checkpoint.businessOutcomes ?? [],
        );
        if (bo) {
          logger.info("replay", "Business outcome at checkpoint", bo);
          await logger.close();
          await opts.driver.close();
          return {
            status: "business_outcome",
            businessOutcome: bo,
            evidence: { logPath: logger.logPath },
            durationMs: Date.now() - started,
          };
        }

        const ok = await resolveWithFallbacks(opts.driver, step.checkpoint.locator, "wait");
        if (!ok) {
          // Re-check business outcomes from broader text patterns even if locator missed
          const bo2 = matchBusinessOutcome(
            snap.visibleText,
            step.checkpoint.businessOutcomes ?? [],
          );
          if (bo2) {
            await logger.close();
            await opts.driver.close();
            return {
              status: "business_outcome",
              businessOutcome: bo2,
              evidence: { logPath: logger.logPath },
              durationMs: Date.now() - started,
            };
          }
          return await fail(
            step.id,
            step.checkpoint.description,
            "checkpoint locator not visible",
            "checkpoint_mismatch",
          );
        }

        if (step.checkpoint.expectText) {
          const text = await opts.driver.readText(toDriverLocator(step.checkpoint.locator));
          if (!text.toLowerCase().includes(step.checkpoint.expectText.toLowerCase())) {
            // business outcome?
            const bo3 = matchBusinessOutcome(text + "\n" + snap.visibleText, step.checkpoint.businessOutcomes ?? []);
            if (bo3) {
              await logger.close();
              await opts.driver.close();
              return {
                status: "business_outcome",
                businessOutcome: bo3,
                evidence: { logPath: logger.logPath },
                durationMs: Date.now() - started,
              };
            }
            return await fail(
              step.id,
              `expectText: ${step.checkpoint.expectText}`,
              text,
              "checkpoint_mismatch",
            );
          }
        }
      }
    }

    // Global success checkpoint
    const sc = artifact.successCheckpoint;
    const snap = await opts.driver.observe();
    const boFinal = matchBusinessOutcome(snap.visibleText, sc.businessOutcomes ?? []);
    if (boFinal) {
      await logger.close();
      await opts.driver.close();
      return {
        status: "business_outcome",
        businessOutcome: boFinal,
        evidence: { logPath: logger.logPath },
        durationMs: Date.now() - started,
      };
    }

    const successOk = await resolveWithFallbacks(opts.driver, sc.locator, "wait");
    if (!successOk) {
      return await fail(
        "successCheckpoint",
        sc.description,
        "success checkpoint not met",
        "checkpoint_mismatch",
      );
    }

    // Extract declared outputs that weren't filled by extract steps
    for (const out of artifact.outputs) {
      if (out.name in outputs) continue;
      if (!out.locator) continue;
      try {
        let text = await opts.driver.readText(toDriverLocator(out.locator));
        if (out.extractPattern) {
          const m = text.match(new RegExp(out.extractPattern, "i"));
          if (m) text = m[1] ?? m[0];
        }
        outputs[out.name] = text;
      } catch {
        logger.warn("replay", `Could not extract output ${out.name}`);
      }
    }

    logger.info("replay", "Replay succeeded", { outputs });
    await logger.close();
    await opts.driver.close();

    return {
      status: "success",
      outputs,
      evidence: { logPath: logger.logPath },
      durationMs: Date.now() - started,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error("replay", "Unhandled replay error", { msg });
    const shot = path.join(evidenceDir, "failure-unhandled.png");
    try {
      await opts.driver.screenshot(shot);
    } catch {
      /* ignore */
    }
    try {
      await opts.driver.close();
    } catch {
      /* ignore */
    }
    await logger.close();
    return {
      status: "hard_failure",
      error: {
        stepId: "unhandled",
        expected: "clean completion",
        observed: msg,
        taxonomy: e instanceof PolicyViolation ? "policy_violation" : "unknown",
      },
      evidence: {
        logPath: logger.logPath,
        screenshotPath: fs.existsSync(shot) ? shot : undefined,
      },
      durationMs: Date.now() - started,
    };
  }
}

async function executeStep(
  driver: SurfaceDriver,
  step: Step,
  params: Record<string, string | number | boolean>,
  outputs: Record<string, string | number | boolean>,
  logger: RunLogger,
): Promise<void> {
  const paramValue = step.paramRef != null ? params[step.paramRef] : undefined;

  switch (step.action) {
    case "navigate": {
      const url = step.url ?? String(paramValue ?? "");
      if (!url) throw new Error("navigate requires url or paramRef");
      gateAction({ action: "navigate", url }, loadAllowlistFromEnv(), {});
      await driver.navigate(url);
      break;
    }
    case "click": {
      if (!step.locator) throw new Error("click requires locator");
      const ok = await resolveWithFallbacks(driver, step.locator, "wait");
      if (!ok) throw new Error(`click target not found: ${step.locator.value}`);
      await driver.click(toDriverLocator(step.locator));
      break;
    }
    case "fill": {
      if (!step.locator) throw new Error("fill requires locator");
      const value = paramValue != null ? String(paramValue) : (step.value ?? "");
      const ok = await resolveWithFallbacks(driver, step.locator, "wait");
      if (!ok) throw new Error(`fill target not found: ${step.locator.value}`);
      await driver.fill(toDriverLocator(step.locator), value);
      break;
    }
    case "select": {
      if (!step.locator) throw new Error("select requires locator");
      const value = paramValue != null ? String(paramValue) : (step.value ?? "");
      await driver.select(toDriverLocator(step.locator), value);
      break;
    }
    case "press": {
      await driver.press(step.key ?? "Enter");
      break;
    }
    case "wait_for": {
      if (!step.locator) throw new Error("wait_for requires locator");
      const ok = await resolveWithFallbacks(driver, step.locator, "wait");
      if (!ok) throw new Error(`wait_for timed out: ${step.locator.value}`);
      break;
    }
    case "extract": {
      if (!step.locator || !step.outputName) throw new Error("extract requires locator+outputName");
      const text = await driver.readText(toDriverLocator(step.locator));
      outputs[step.outputName] = text;
      logger.info("replay", `Extracted ${step.outputName}`, { preview: text.slice(0, 80) });
      break;
    }
    case "assert": {
      if (!step.locator) throw new Error("assert requires locator");
      const ok = await resolveWithFallbacks(driver, step.locator, "wait");
      if (!ok) throw new Error(`assert failed: ${step.description}`);
      break;
    }
    case "dismiss_if_present": {
      if (!step.locator) return;
      if (await driver.isVisible(toDriverLocator(step.locator), 800)) {
        await driver.click(toDriverLocator(step.locator));
      }
      break;
    }
    default:
      throw new Error(`Unknown action: ${(step as Step).action}`);
  }

  // Small settle for legacy UI / iframe loads
  await new Promise((r) => setTimeout(r, 150));
}
