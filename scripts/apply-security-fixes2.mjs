import { writeFileSync } from "fs";

writeFileSync("src/guardrails/action-gate.ts", `/**
 * Security gate for all automation actions.
 * Model/tool outputs are untrusted. No eval/exec of model-produced code.
 *
 * Irreversible gating uses EXPLICIT flags only (step.irreversible / actionPolicy),
 * never name heuristics like /confirm/i — those miss #oaSubmit / role "Submit".
 */

import type { ActionType, Locator } from "../artifact/schema.js";
import {
  type AllowlistConfig,
  assertActionAllowed,
  assertIrreversibleAllowed,
  assertUrlAllowed,
  PolicyViolation,
} from "./allowlist.js";

const ALLOWED_KEYS = new Set([
  "Enter", "Tab", "Escape", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight",
  "Backspace", "Delete", "Home", "End",
]);

/** Known irreversible control ids / roles from the target app policy (explicit list). */
export const IRREVERSIBLE_CONTROL_POLICY: {
  cssIds: string[];
  roleNames: { role: string; name: string }[];
} = {
  cssIds: ["oaConfirm", "oaSubmit"],
  roleNames: [
    { role: "button", name: "Confirm & Submit" },
    { role: "button", name: "Submit" },
  ],
};

export type GatedAction = {
  action: ActionType;
  url?: string;
  locator?: Locator;
  value?: string;
  key?: string;
  /** Explicit flag from artifact step or discover recording — authoritative */
  irreversible?: boolean;
};

/**
 * Resolve whether an action is irreversible from EXPLICIT policy, not heuristics.
 * Order: (1) explicit flag on the action (2) control id/role match against IRREVERSIBLE_CONTROL_POLICY.
 */
export function resolveIrreversible(gated: GatedAction): boolean {
  if (gated.irreversible === true) return true;
  if (gated.irreversible === false) {
    // Explicit false still checked against control policy — cannot opt out of known-irreversible controls
    // when locator targets a policy-listed control.
  }
  const loc = gated.locator;
  if (!loc) return gated.irreversible === true;

  if (loc.strategy === "css") {
    const idMatch = loc.value.match(/#([A-Za-z][\\w-]*)/);
    if (idMatch && IRREVERSIBLE_CONTROL_POLICY.cssIds.includes(idMatch[1]!)) {
      return true;
    }
  }
  for (const rn of IRREVERSIBLE_CONTROL_POLICY.roleNames) {
    if (
      (loc.strategy === "role_name" || loc.strategy === "frame_role_name") &&
      (loc.role ?? "button") === rn.role &&
      loc.value === rn.name
    ) {
      return true;
    }
    if (loc.strategy === "text" && loc.value === rn.name) return true;
  }
  return gated.irreversible === true;
}

export function gateAction(
  gated: GatedAction,
  cfg: AllowlistConfig,
  opts: { confirmIrreversible?: boolean } = {},
): void {
  assertActionAllowed(gated.action, cfg);

  const irreversible = resolveIrreversible(gated);
  assertIrreversibleAllowed(irreversible, opts.confirmIrreversible === true);

  if (gated.action === "navigate") {
    if (!gated.url) throw new PolicyViolation("navigate requires a URL");
    assertUrlAllowed(gated.url, cfg);
  }

  if (gated.key) {
    const base = gated.key.split("+").pop() ?? gated.key;
    if (!ALLOWED_KEYS.has(base) && !/^[a-zA-Z0-9]$/.test(base)) {
      throw new PolicyViolation('Key "' + gated.key + '" is not on the press allowlist');
    }
  }

  if (gated.locator?.strategy === "css") {
    const v = gated.locator.value;
    if (/expression\\s*\\(|javascript:|@import/i.test(v)) {
      throw new PolicyViolation("Blocked dangerous CSS locator");
    }
  }

  if (gated.value && /(?:^|\\n)\\s*(?:eval|Function|require|import\\s*\\()/m.test(gated.value)) {
    throw new PolicyViolation("Blocked value resembling executable code");
  }
}

export function sanitizeToolArgs(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v == null) {
      out[k] = v;
    } else if (Array.isArray(v)) {
      out[k] = v.map((item) =>
        item && typeof item === "object"
          ? sanitizeToolArgs(item)
          : typeof item === "string" || typeof item === "number" || typeof item === "boolean"
            ? item
            : null,
      );
    } else if (typeof v === "object") {
      out[k] = sanitizeToolArgs(v);
    }
  }
  return out;
}
`);

writeFileSync("src/guardrails/redaction.ts", `/**
 * Redact secrets and PII before artifacts, logs, or LLM observe payloads.
 */

const PATTERNS: { name: string; re: RegExp; replace: string }[] = [
  { name: "openai_key", re: /\\bsk-[A-Za-z0-9_-]{10,}\\b/g, replace: "[REDACTED_API_KEY]" },
  { name: "anthropic_key", re: /\\bsk-ant-[A-Za-z0-9_-]{10,}\\b/g, replace: "[REDACTED_API_KEY]" },
  { name: "bearer", re: /\\bBearer\\s+[A-Za-z0-9._\\-+/=]+/gi, replace: "Bearer [REDACTED_TOKEN]" },
  { name: "jwt", re: /\\beyJ[A-Za-z0-9_-]+\\.eyJ[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\b/g, replace: "[REDACTED_JWT]" },
  { name: "password_field", re: /(password["']?\\s*[:=]\\s*["']?)[^"'\\s]+/gi, replace: "$1[REDACTED]" },
  { name: "ssn", re: /\\b\\d{3}-\\d{2}-\\d{4}\\b/g, replace: "[REDACTED_SSN]" },
  { name: "card", re: /\\b(?:\\d[ -]*?){13,19}\\b/g, replace: "[REDACTED_PAN]" },
  { name: "email", re: /\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b/gi, replace: "[REDACTED_EMAIL]" },
  {
    name: "member_name_line",
    re: /(Member Name(?:<\\/td>)?\\s*(?:<td>)?\\s*)([A-Z][a-z]+\\s+[A-Z][a-z]+)/g,
    replace: "$1[REDACTED_NAME]",
  },
  {
    name: "person_name_row",
    re: /(\\bName\\b(?:<\\/td>)?\\s*(?:<td>)?\\s*)([A-Z][a-z]+\\s+[A-Z][a-z]+)/g,
    replace: "$1[REDACTED_NAME]",
  },
];

export function redactText(input: string): string {
  let out = input;
  for (const p of PATTERNS) {
    out = out.replace(p.re, p.replace);
  }
  return out;
}

export function redactValue(key: string, value: unknown): unknown {
  const sensitiveKeys = /password|secret|token|ssn|pan|card|cvv|pin|credential|api[_-]?key|authorization|cookie|session/i;
  if (sensitiveKeys.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((v, i) => redactValue(String(i), v));
  if (value && typeof value === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      o[k] = redactValue(k, v);
    }
    return o;
  }
  return value;
}

export function redactObject<T>(obj: T): T {
  return redactValue("root", obj) as T;
}

/** Redact an observe snapshot before sending to the LLM or writing logs. */
export function redactObserveSnapshot<T extends { visibleText?: string; accessibilityTree?: string; url?: string; title?: string }>(
  snap: T,
): T {
  return {
    ...snap,
    visibleText: snap.visibleText != null ? redactText(snap.visibleText) : snap.visibleText,
    accessibilityTree:
      snap.accessibilityTree != null ? redactText(snap.accessibilityTree) : snap.accessibilityTree,
    title: snap.title != null ? redactText(snap.title) : snap.title,
  };
}

export function assertNoSecretsInArtifactJson(json: string): void {
  if (/\\bsk-[A-Za-z0-9_-]{10,}\\b/.test(json)) {
    throw new Error("Refusing to persist artifact containing API key material");
  }
  if (/\\b\\d{3}-\\d{2}-\\d{4}\\b/.test(json)) {
    throw new Error("Refusing to persist artifact containing SSN-like data");
  }
  if (/\\bBearer\\s+[A-Za-z0-9._\\-+/=]+/i.test(json)) {
    throw new Error("Refusing to persist artifact containing bearer token");
  }
}
`);

console.log("wrote action-gate + redaction");
