/**
 * Agent-loop policy for observe → decide → act discovery.
 * Hard-rejects invented / off-policy tools; defines stop conditions;
 * prefers deterministic replay once a capability artifact exists.
 */

import fs from "node:fs";
import { PolicyViolation } from "../guardrails/allowlist.js";

/** Exact tool names the discovery LLM may call. Anything else is invented / off-policy. */
export const DISCOVERY_TOOL_NAMES = [
  "observe",
  "click",
  "fill",
  "select",
  "navigate",
  "extract",
  "done",
  "escalate",
] as const;

export type DiscoveryToolName = (typeof DISCOVERY_TOOL_NAMES)[number];

const DISCOVERY_TOOL_SET = new Set<string>(DISCOVERY_TOOL_NAMES);

export function isKnownDiscoveryTool(name: string): name is DiscoveryToolName {
  return DISCOVERY_TOOL_SET.has(name);
}

/** Reject model-invented tools (e.g. type, drag, eval_js) before any side effect. */
export function assertKnownDiscoveryTool(name: string): asserts name is DiscoveryToolName {
  if (!isKnownDiscoveryTool(name)) {
    throw new PolicyViolation(
      `Off-policy / invented tool "${name}". Allowed: ${DISCOVERY_TOOL_NAMES.join(", ")}`,
    );
  }
}

const LOCATOR_STRATEGIES = new Set([
  "role_name",
  "label",
  "placeholder",
  "text",
  "css",
  "frame_role_name",
]);

/** Schema hygiene: required fields + strategy enums. extra keys already stripped by sanitizeToolArgs. */
export function validateDiscoveryToolArgs(
  name: DiscoveryToolName,
  args: Record<string, unknown>,
): void {
  switch (name) {
    case "observe":
      return;
    case "click":
      requireString(args, "strategy");
      requireString(args, "value");
      assertStrategy(args.strategy);
      return;
    case "fill":
      requireString(args, "strategy");
      assertStrategy(args.strategy);
      if (args.locatorValue == null || String(args.locatorValue).trim() === "") {
        if (!(args.paramName != null && args.value != null && String(args.value).trim() !== "")) {
          throw new PolicyViolation(
            "fill requires locatorValue (or value as label when paramName is set)",
          );
        }
      }
      return;
    case "select":
      requireString(args, "strategy");
      requireString(args, "locatorValue");
      requireString(args, "option");
      assertStrategy(args.strategy);
      return;
    case "navigate":
      requireString(args, "url");
      return;
    case "extract":
      requireString(args, "outputName");
      requireString(args, "strategy");
      requireString(args, "value");
      assertStrategy(args.strategy);
      return;
    case "done":
      requireString(args, "name");
      requireString(args, "description");
      requireString(args, "successDescription");
      requireString(args, "successText");
      return;
    case "escalate":
      requireString(args, "reason");
      return;
    default: {
      const _exhaustive: never = name;
      throw new PolicyViolation(`Unhandled tool ${( _exhaustive as string)}`);
    }
  }
}

function requireString(args: Record<string, unknown>, key: string): void {
  const v = args[key];
  if (typeof v !== "string" || v.trim() === "") {
    throw new PolicyViolation(`Tool args missing required string field "${key}"`);
  }
}

function assertStrategy(raw: unknown): void {
  if (typeof raw !== "string" || !LOCATOR_STRATEGIES.has(raw)) {
    throw new PolicyViolation(
      `Invalid locator strategy "${String(raw)}". Allowed: ${[...LOCATOR_STRATEGIES].join(", ")}`,
    );
  }
}

export type StopReason =
  | "done"
  | "max_steps"
  | "consecutive_errors"
  | "consecutive_no_tool_calls"
  | "continue";

export type StopState = {
  turn: number;
  maxSteps: number;
  consecutiveErrors: number;
  consecutiveNoToolCalls: number;
  done: boolean;
  /** Defaults: 3 consecutive tool/policy errors, 2 turns with no tool_calls */
  maxConsecutiveErrors?: number;
  maxConsecutiveNoToolCalls?: number;
};

/**
 * Deterministic stop conditions for the discovery loop.
 * Prefer escalate / hard stop over letting the model invent recovery actions forever.
 */
export function evaluateDiscoveryStop(state: StopState): StopReason {
  if (state.done) return "done";
  const maxErr = state.maxConsecutiveErrors ?? 3;
  const maxNoTool = state.maxConsecutiveNoToolCalls ?? 2;
  if (state.consecutiveErrors >= maxErr) return "consecutive_errors";
  if (state.consecutiveNoToolCalls >= maxNoTool) return "consecutive_no_tool_calls";
  if (state.turn >= state.maxSteps) return "max_steps";
  return "continue";
}

export type ExecutionMode = "replay" | "discover";

/**
 * Once a CapabilityArtifact exists on disk, production must use deterministic replay —
 * do not re-enter the LLM observe→decide→act loop for the same capability.
 */
export function preferReplayOverDiscover(artifactPath: string | undefined | null): ExecutionMode {
  if (!artifactPath) return "discover";
  try {
    if (fs.existsSync(artifactPath) && fs.statSync(artifactPath).isFile()) {
      return "replay";
    }
  } catch {
    /* treat missing/unreadable as discover */
  }
  return "discover";
}

export function assertPreferReplay(artifactPath: string): void {
  if (preferReplayOverDiscover(artifactPath) === "replay") {
    throw new PolicyViolation(
      `Capability artifact already exists at ${artifactPath}. Prefer deterministic replay over LLM rediscovery.`,
    );
  }
}
