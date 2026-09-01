import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  CapabilityArtifactSchema,
  type ActionType,
  type CapabilityArtifact,
  type Locator,
  type Step,
} from "../artifact/schema.js";
import type { SurfaceDriver, DriverLocator } from "../surface/types.js";
import {
  assertUrlAllowed,
  assertIrreversibleAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";
import { gateAction, sanitizeToolArgs, resolveIrreversible } from "../guardrails/action-gate.js";
import { assertNoSecretsInArtifactJson, redactText, redactObject, redactObserveSnapshot } from "../guardrails/redaction.js";
import { artifactJsonFileName } from "../guardrails/safe-path.js";

import { RunLogger } from "../observability/logger.js";
import { escalateToHuman } from "../hitl/handoff.js";
import { DISCOVERY_TOOLS } from "./tools.js";
import {
  assertKnownDiscoveryTool,
  assertPreferReplay,
  evaluateDiscoveryStop,
  validateDiscoveryToolArgs,
} from "./loop-policy.js";
import { buildLookupSavingsArtifact, buildOpenSubAccountArtifact } from "../artifact/fixtures.js";


const SENSITIVE_PARAM_NAME = /member|account|customer|ssn|pan|email|phone|balance|routing|iban|name|dob|address/i;

function normalizeParamDefs(
  params: Array<{ name: string; type: string; description: string; sensitive?: boolean; required?: boolean }>,
): CapabilityArtifact["parameters"] {
  return params.map((p) => ({
    name: p.name,
    type: p.type as "string" | "number" | "boolean",
    description: p.description,
    required: p.required ?? true,
    // Fail-closed: default true; force true for bank/member-like names
    sensitive: SENSITIVE_PARAM_NAME.test(p.name) ? true : p.sensitive !== false,
  }));
}


export type DiscoverOptions = {
  goal: string;
  entryUrl: string;
  params?: Record<string, string>;
  driver: SurfaceDriver;
  evidenceDir: string;
  maxSteps?: number;
  confirmIrreversible?: boolean;
  model?: string;
  /** When no API key, allow emitting a labeled synthetic artifact for known goals */
  allowSyntheticFallback?: boolean;
  /** If set and the file exists, refuse LLM rediscovery — prefer deterministic replay */
  refuseIfArtifactExists?: string;
};

export type DiscoverResult = {
  artifact: CapabilityArtifact;
  evidenceDir: string;
  logPath: string;
  synthetic: boolean;
};

type Recorded = {
  action: ActionType;
  description: string;
  locator?: Locator;
  paramRef?: string;
  value?: string;
  url?: string;
  outputName?: string;
  irreversible?: boolean;
};

export function locFromArgs(args: Record<string, unknown>): Locator {
  return {
    strategy: args.strategy as Locator["strategy"],
    value: String(args.value ?? args.locatorValue ?? ""),
    role: args.role ? String(args.role) : undefined,
    frame: args.frame ? String(args.frame) : undefined,
    alternatives: [],
    reasoning: args.reasoning ? String(args.reasoning) : undefined,
  };
}

export function toDriver(loc: Locator): DriverLocator {
  return {
    strategy: loc.strategy,
    value: loc.value,
    role: loc.role,
    frame: loc.frame,
  };
}

/**
 * Build fill locator + text BEFORE gateAction so CSS/code checks always run.
 * Fail-closed if strategy or locator value is missing (no silent Member ID default).
 */
export function prepareFillGate(
  args: Record<string, unknown>,
  params: Record<string, string>,
): { locator: Locator; text: string; paramName?: string } {
  const strategy = args.strategy as Locator["strategy"] | undefined;
  if (!strategy) {
    throw new PolicyViolation("fill requires a locator strategy");
  }

  const paramName = args.paramName != null ? String(args.paramName) : undefined;

  // Locator target must be explicit: locatorValue, or (when paramName binds typed text) value as label.
  let locValue: string | undefined;
  if (args.locatorValue != null && String(args.locatorValue).trim() !== "") {
    locValue = String(args.locatorValue);
  } else if (paramName && args.value != null && String(args.value).trim() !== "") {
    locValue = String(args.value);
  }

  if (!locValue) {
    throw new PolicyViolation("fill requires locatorValue (or value as label when paramName is set)");
  }

  let text: string;
  if (paramName && params[paramName] != null) {
    text = String(params[paramName]);
  } else if (args.locatorValue != null) {
    // locatorValue set → args.value is the typed text
    if (args.value == null && !paramName) {
      throw new PolicyViolation("fill requires a value (or paramName)");
    }
    text = String(args.value ?? "");
  } else {
    // value was consumed as locator label; typed text must come from params
    if (paramName && params[paramName] == null) {
      throw new PolicyViolation("fill paramName \"" + paramName + "\" missing from params");
    }
    text = paramName && params[paramName] != null ? String(params[paramName]) : "";
  }

  const locator: Locator = {
    strategy,
    value: locValue,
    role: args.role
      ? String(args.role)
      : strategy === "role_name" || strategy === "frame_role_name"
        ? "textbox"
        : undefined,
    frame: args.frame ? String(args.frame) : undefined,
    alternatives: [],
    reasoning: args.reasoning ? String(args.reasoning) : undefined,
  };

  return { locator, text, paramName };
}

/**
 * Build select locator + option BEFORE gateAction. Fail-closed if missing.
 */
export function prepareSelectGate(
  args: Record<string, unknown>,
  params: Record<string, string>,
): { locator: Locator; option: string; paramName?: string } {
  const strategy = args.strategy as Locator["strategy"] | undefined;
  if (!strategy) {
    throw new PolicyViolation("select requires a locator strategy");
  }
  const locValue = args.locatorValue != null ? String(args.locatorValue) : "";
  if (!locValue.trim()) {
    throw new PolicyViolation("select requires locatorValue");
  }
  const paramName = args.paramName != null ? String(args.paramName) : undefined;
  const option =
    paramName && params[paramName] != null
      ? String(params[paramName])
      : args.option != null
        ? String(args.option)
        : "";
  if (!option.trim() && !paramName) {
    throw new PolicyViolation("select requires an option (or paramName)");
  }
  const locator: Locator = {
    strategy,
    value: locValue,
    role: args.role ? String(args.role) : "combobox",
    frame: args.frame ? String(args.frame) : undefined,
    alternatives: [],
    reasoning: args.reasoning ? String(args.reasoning) : undefined,
  };
  return { locator, option, paramName };
}

export async function discoverCapability(opts: DiscoverOptions): Promise<DiscoverResult> {
  const allowlist = loadAllowlistFromEnv();
  assertUrlAllowed(opts.entryUrl, allowlist);
  if (opts.refuseIfArtifactExists) {
    assertPreferReplay(opts.refuseIfArtifactExists);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (!opts.allowSyntheticFallback) {
      throw new Error(
        "OPENAI_API_KEY is missing. Set it in .env for live discovery, or pass --synthetic-fallback for labeled fixtures.",
      );
    }
    return syntheticDiscover(opts);
  }

  const runId = randomUUID().slice(0, 8);
  const evidenceDir = path.join(opts.evidenceDir, `discover-${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const logger = new RunLogger({ runId, dir: evidenceDir });
  const model = opts.model ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const client = new OpenAI({ apiKey });
  const maxSteps = opts.maxSteps ?? 20;
  const recorded: Recorded[] = [];
  const extracted: Record<string, string> = {};
  const params = opts.params ?? {};

  logger.info("discover", "Starting LLM discovery", { goal: opts.goal, entryUrl: opts.entryUrl, model });

  await opts.driver.open(opts.entryUrl);

  const system = `You are a computer-use agent automating a legacy bank back-office UI.
Goal: ${opts.goal}
Entry URL: ${opts.entryUrl}
Runtime params available (redacted): ${JSON.stringify(redactObject(params))}

Rules:
- Prefer accessibility locators: role+name, label, text. Never invent test ids (there are none).
- Results may be inside an iframe titled "Lookup Results" — set frame accordingly.
- Call observe before acting when unsure.
- Bind fills to paramName when the value comes from runtime params.
- When the goal is met, call done with a clear capability contract.
- Escalate if stuck after several attempts — do not invent new tools or recovery actions.
- Only call tools from the provided schema (observe/click/fill/select/navigate/extract/done/escalate). Never invent tools.
- Do not invent secrets or PII. Do not navigate off the allowlisted host.`;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: `Accomplish the goal. Params (redacted): ${JSON.stringify(redactObject(params))}` },
  ];

  let donePayload: Record<string, unknown> | null = null;
  let consecutiveErrors = 0;
  let consecutiveNoToolCalls = 0;

  for (let i = 0; i < maxSteps; i++) {
    const stopEarly = evaluateDiscoveryStop({
      turn: i,
      maxSteps,
      consecutiveErrors,
      consecutiveNoToolCalls,
      done: donePayload != null,
    });
    if (stopEarly === "consecutive_errors") {
      await opts.driver.screenshot(path.join(evidenceDir, "stop-consecutive-errors.png")).catch(() => {});
      await opts.driver.close();
      await logger.close();
      throw new Error(
        "Discovery stopped: consecutive tool/policy errors — escalate or fix surface; refusing to invent off-policy recovery",
      );
    }
    if (stopEarly === "consecutive_no_tool_calls") {
      await opts.driver.screenshot(path.join(evidenceDir, "stop-no-tool-calls.png")).catch(() => {});
      await opts.driver.close();
      await logger.close();
      throw new Error(
        "Discovery stopped: model stopped calling tools — refuse free-form inventing; call escalate or done",
      );
    }

    logger.info("discover", `LLM turn ${i + 1}`);
    const completion = await client.chat.completions.create({
      model,
      messages,
      tools: DISCOVERY_TOOLS,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const msg = completion.choices[0]?.message;
    if (!msg) throw new Error("Empty LLM response");
    messages.push(msg);

    if (!msg.tool_calls?.length) {
      consecutiveNoToolCalls += 1;
      messages.push({
        role: "user",
        content:
          "Please call a tool from the schema only (observe/click/fill/select/navigate/extract/done/escalate). Do not invent tools.",
      });
      continue;
    }
    consecutiveNoToolCalls = 0;

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try {
        args = sanitizeToolArgs(JSON.parse(call.function.arguments || "{}"));
      } catch {
        args = {};
      }

      logger.info("discover", `tool:${name}`, { args: redactObject(args) as Record<string, unknown> });
      let toolResult = "";

      try {
        assertKnownDiscoveryTool(name);
        validateDiscoveryToolArgs(name, args);
        switch (name) {
          case "observe": {
            const snap = await opts.driver.observe();
            toolResult = JSON.stringify(redactObserveSnapshot(snap)).slice(0, 12000);
            break;
          }
          case "click": {
            const loc = locFromArgs(args);
            const irrev = resolveIrreversible({ action: "click", locator: loc });
            gateAction({ action: "click", locator: loc, irreversible: irrev }, allowlist, {
              confirmIrreversible: opts.confirmIrreversible,
            });
            await opts.driver.click(toDriver(loc));
            recorded.push({
              action: "click",
              description: `Click ${loc.role ?? ""} ${loc.value}`.trim(),
              locator: loc,
              irreversible: irrev,
            });
            toolResult = "clicked";
            break;
          }
          case "fill": {
            const { locator: fillLoc, text, paramName } = prepareFillGate(args, params);
            const irrev = resolveIrreversible({ action: "fill", locator: fillLoc, value: text });
            gateAction(
              { action: "fill", locator: fillLoc, value: text, irreversible: irrev },
              allowlist,
              { confirmIrreversible: opts.confirmIrreversible },
            );
            await opts.driver.fill(toDriver(fillLoc), text);
            recorded.push({
              action: "fill",
              description: `Fill ${fillLoc.value}`,
              locator: fillLoc,
              paramRef: paramName,
              value: paramName ? undefined : text,
              irreversible: irrev,
            });
            toolResult = "filled";
            break;
          }
          case "select": {
            const { locator: loc, option, paramName } = prepareSelectGate(args, params);
            const irrev = resolveIrreversible({ action: "select", locator: loc, value: option });
            gateAction(
              { action: "select", locator: loc, value: option, irreversible: irrev },
              allowlist,
              { confirmIrreversible: opts.confirmIrreversible },
            );
            await opts.driver.select(toDriver(loc), option);
            recorded.push({
              action: "select",
              description: `Select ${option}`,
              locator: loc,
              paramRef: paramName,
              value: paramName ? undefined : option,
              irreversible: irrev,
            });
            toolResult = "selected";
            break;
          }
          case "navigate": {
            const url = String(args.url);
            gateAction({ action: "navigate", url }, allowlist, {
              confirmIrreversible: opts.confirmIrreversible,
            });
            await opts.driver.navigate(url);
            recorded.push({ action: "navigate", description: `Navigate to ${url}`, url });
            toolResult = "navigated";
            break;
          }
          case "extract": {
            const loc = locFromArgs(args);
            if (!loc.strategy || loc.value == null || loc.value === "") {
              throw new PolicyViolation("extract requires locator strategy and value");
            }
            gateAction(
              { action: "extract", locator: loc },
              allowlist,
              { confirmIrreversible: opts.confirmIrreversible },
            );
            const text = redactText(await opts.driver.readText(toDriver(loc)));
            const outputName = String(args.outputName);
            extracted[outputName] = text;
            recorded.push({
              action: "extract",
              description: `Extract ${outputName}`,
              locator: loc,
              outputName,
            });
            toolResult = JSON.stringify({ outputName, text });
            break;
          }
          case "escalate": {
            const shot = path.join(evidenceDir, "hitl.png");
            try {
              await opts.driver.screenshot(shot);
            } catch {
              /* ignore */
            }
            await escalateToHuman({
              driver: opts.driver,
              logger,
              request: {
                reason: String(args.reason ?? "stuck"),
                goal: opts.goal,
                observedSummary: redactText((await opts.driver.observe()).visibleText.slice(0, 500)),
                screenshotPath: fs.existsSync(shot) ? shot : undefined,
                createdAt: new Date().toISOString(),
              },
            });
            toolResult = "human resumed control; continue";
            break;
          }
          case "done": {
            donePayload = args;
            toolResult = "ok";
            break;
          }
          default:
            throw new PolicyViolation(`Off-policy tool reached switch: ${name}`);
        }
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors += 1;
        toolResult = `ERROR: ${e instanceof Error ? e.message : String(e)}`;
        logger.warn("discover", "tool error", { name, toolResult, consecutiveErrors });
        if (e instanceof PolicyViolation) {
          try {
            await opts.driver.screenshot(path.join(evidenceDir, "policy-violation.png"));
          } catch {
            /* ignore */
          }
        }
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: redactText(toolResult).slice(0, 10000),
      });
    }

    if (donePayload) break;
  }

  if (!donePayload) {
    await opts.driver.screenshot(path.join(evidenceDir, "max-steps.png")).catch(() => {});
    await opts.driver.close();
    await logger.close();
    throw new Error(
      "Discovery stop: max_steps reached without done() — prefer escalate over inventing further actions",
    );
  }

  const steps: Step[] = recorded.map((r, idx) => ({
    id: `s${idx + 1}`,
    action: r.action,
    description: r.description,
    locator: r.locator,
    paramRef: r.paramRef,
    value: r.value,
    url: r.url,
    outputName: r.outputName,
    irreversible: r.irreversible ?? false,
    recoverableHints: [],
  }));

  // Mark irreversible via explicit control policy (not name heuristics)
  for (const s of steps) {
    if (s.action === "click" && s.locator) {
      const irrev = resolveIrreversible({ action: "click", locator: s.locator, irreversible: s.irreversible });
      if (irrev) {
        s.irreversible = true;
        try {
          assertIrreversibleAllowed(true, opts.confirmIrreversible === true);
        } catch (e) {
          logger.warn("discover", "Irreversible control seen during discovery", {
            msg: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  const successText = String(donePayload.successText);
  const artifact: CapabilityArtifact = CapabilityArtifactSchema.parse({
    version: "1.0.0",
    name: String(donePayload.name),
    description: String(donePayload.description),
    target: {
      kind: "web",
      entryUrl: opts.entryUrl,
      appId: "legacy-bank-mock",
    },
    parameters: normalizeParamDefs((donePayload.parameters as Array<{ name: string; type: string; description: string; sensitive?: boolean; required?: boolean }>) ?? []),
    outputs: (donePayload.outputs as CapabilityArtifact["outputs"]) ?? [],
    steps,
    successCheckpoint: {
      id: "success",
      description: String(donePayload.successDescription),
      locator: { strategy: "text", value: successText, alternatives: [] },
      expectText: successText,
      businessOutcomes: [
        {
          pattern: "MEMBER NOT FOUND|MEM_NOT_FOUND",
          code: "MEM_NOT_FOUND",
          message: "No member exists for the given Member ID",
        },
        {
          pattern: "Validation Error",
          code: "VALIDATION_ERROR",
          message: "Form validation failed",
        },
      ],
    },
    locatorStrategyMeta: {
      preferredOrder: ["role_name", "label", "frame_role_name", "text", "placeholder", "css"],
      notes:
        "Accessibility-first. Frames use frame title. No test ids on this legacy surface.",
    },
    safety: {
      allowedOrigins: allowlist.allowedOrigins,
      allowedActions: allowlist.allowedActions,
      requiresConfirmationForIrreversible: true,
    },
    metadata: {
      discoveredAt: new Date().toISOString(),
      goal: opts.goal,
      model,
      discoveryEvidencePath: evidenceDir,
      synthetic: false,
    },
  });

  // Attach extract locators onto outputs when possible
  for (const out of artifact.outputs) {
    const extractStep = steps.find((s) => s.action === "extract" && s.outputName === out.name);
    if (extractStep?.locator) out.locator = extractStep.locator;
  }

  const outPath = path.join(evidenceDir, "artifact.json");
  const json = JSON.stringify(artifact, null, 2);
  assertNoSecretsInArtifactJson(json);
  fs.writeFileSync(outPath, json);
  // Also copy to artifacts/
  const artDir = path.resolve(path.join(evidenceDir, "..", "..", "artifacts"));
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(artDir, artifactJsonFileName(artifact.name)), json);

  logger.info("discover", "Discovery complete — artifact saved", { outPath, name: artifact.name });
  await opts.driver.close();
  await logger.close();

  return { artifact, evidenceDir, logPath: logger.logPath, synthetic: false };
}

async function syntheticDiscover(opts: DiscoverOptions): Promise<DiscoverResult> {
  const runId = `synthetic-${randomUUID().slice(0, 6)}`;
  const evidenceDir = path.join(opts.evidenceDir, `discover-${runId}`);
  fs.mkdirSync(evidenceDir, { recursive: true });
  const logger = new RunLogger({ runId, dir: evidenceDir });

  logger.warn(
    "discover",
    "OPENAI_API_KEY missing — emitting LABELED SYNTHETIC artifact fixture (not a live LLM run)",
    { goal: opts.goal },
  );

  const goal = opts.goal.toLowerCase();
  let artifact: CapabilityArtifact;
  if (goal.includes("sub-account") || goal.includes("subaccount") || goal.includes("open")) {
    artifact = buildOpenSubAccountArtifact(opts.entryUrl);
  } else {
    artifact = buildLookupSavingsArtifact(opts.entryUrl);
  }

  // Prove the mock surface works even without LLM by doing a dry observe
  try {
    await opts.driver.open(opts.entryUrl);
    const snap = await opts.driver.observe();
    logger.info("discover", "Synthetic path observed live mock UI", {
      title: snap.title,
      url: snap.url,
    });
    await opts.driver.close();
  } catch (e) {
    logger.warn("discover", "Could not open mock during synthetic path", {
      err: e instanceof Error ? e.message : String(e),
    });
    try {
      await opts.driver.close();
    } catch {
      /* ignore */
    }
  }

  const json = JSON.stringify(artifact, null, 2);
  assertNoSecretsInArtifactJson(json);
  fs.writeFileSync(path.join(evidenceDir, "artifact.json"), json);
  fs.writeFileSync(path.join(evidenceDir, "SYNTHETIC_LABEL.txt"), [
    "SYNTHETIC DISCOVERY EVIDENCE",
    "This artifact was generated without a live LLM because OPENAI_API_KEY was not set.",
    "The step sequence matches a validated manual traversal of the legacy-bank-mock.",
    "Replay against the live mock is still real and deterministic.",
    `goal: ${opts.goal}`,
    `generatedAt: ${new Date().toISOString()}`,
  ].join("\n"));

  const artDir = path.resolve(path.join(evidenceDir, "..", "..", "artifacts"));
  fs.mkdirSync(artDir, { recursive: true });
  fs.writeFileSync(path.join(artDir, artifactJsonFileName(artifact.name)), json);

  await logger.close();
  return { artifact, evidenceDir, logPath: logger.logPath, synthetic: true };
}
