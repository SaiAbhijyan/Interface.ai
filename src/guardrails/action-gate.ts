/**
 * Security gate for all automation actions.
 * Irreversible: explicit step.irreversible OR IRREVERSIBLE_CONTROL_POLICY
 * OR fail-closed confirm/submit signals from id / label / role name / text /
 * press value / hint text — not only a single locator-string regex.
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

const ACTIONS_REQUIRING_LOCATOR = new Set<ActionType>([
  "click", "fill", "select", "wait_for", "extract", "assert", "dismiss_if_present",
]);

/** Explicit policy table — extend this list deliberately. */
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

/** Trim, collapse whitespace, lowercase — for control name comparisons. */
export function normalizeControlName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Split camelCase / kebab / snake id tokens into words for \bconfirm\b checks. */
export function idTokenWords(id: string): string {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase();
}

/**
 * Extract element id candidates from CSS locators:
 *   #oaConfirm, [id=oaConfirm], [id="oaConfirm"], [id='oaConfirm']
 */
export function extractCssIds(cssValue: string): string[] {
  const ids: string[] = [];
  const hash = cssValue.matchAll(/#([A-Za-z][\w-]*)/g);
  for (const m of hash) ids.push(m[1]!);
  const attr = cssValue.matchAll(/\[\s*id\s*=\s*(?:["']?)([A-Za-z][\w-]*)(?:["']?)\s*\]/gi);
  for (const m of attr) ids.push(m[1]!);
  return [...new Set(ids)];
}

export type GatedAction = {
  action: ActionType;
  url?: string;
  locator?: Locator;
  value?: string;
  key?: string;
  irreversible?: boolean;
  /** Recoverable-hint / press-associated / description text to scan for confirm|submit */
  hint?: string;
};

function looksIrreversibleName(normalized: string): boolean {
  return /\b(confirm|submit)\b/.test(normalized);
}

function idIsIrreversible(id: string): boolean {
  if (IRREVERSIBLE_CONTROL_POLICY.cssIds.includes(id)) return true;
  return looksIrreversibleName(idTokenWords(id));
}

export function resolveIrreversible(gated: GatedAction): boolean {
  if (gated.irreversible === true) return true;
  const loc = gated.locator;

  // CSS id paths: #oaConfirm and [id=oaConfirm] (attribute form often missed by #only regex)
  if (loc?.strategy === "css") {
    for (const id of extractCssIds(loc.value)) {
      if (idIsIrreversible(id)) return true;
    }
  }

  const textCandidates: string[] = [];
  if (loc?.value) textCandidates.push(loc.value);
  if (gated.value) textCandidates.push(gated.value);
  if (gated.hint) textCandidates.push(gated.hint);
  // press may carry associated control text in value/hint without a locator
  if (gated.action === "press" && gated.key) {
    // key alone is not irreversible; value/hint already collected
  }

  for (const raw of textCandidates) {
    const normalized = normalizeControlName(raw);

    for (const rn of IRREVERSIBLE_CONTROL_POLICY.roleNames) {
      const policyName = normalizeControlName(rn.name);
      if (normalized === policyName) {
        if (!loc) return true; // hint/press/value path
        if (
          (loc.strategy === "role_name" || loc.strategy === "frame_role_name") &&
          (loc.role ?? "button") === rn.role
        ) {
          return true;
        }
        if (loc.strategy === "text" || loc.strategy === "label") return true;
        // css already handled via ids; still treat exact policy name on any strategy
        if (loc.strategy !== "css") return true;
      }
    }

    // Fail-closed word-boundary confirm|submit on label / role / text / hint / press value
    const strategy = loc?.strategy;
    const checkHeuristic =
      !loc ||
      strategy === "role_name" ||
      strategy === "frame_role_name" ||
      strategy === "text" ||
      strategy === "label" ||
      gated.action === "press" ||
      gated.hint != null;

    if (checkHeuristic && looksIrreversibleName(normalized)) {
      return true;
    }
  }

  return false;
}

export function gateAction(
  gated: GatedAction,
  cfg: AllowlistConfig,
  opts: { confirmIrreversible?: boolean } = {},
): void {
  assertActionAllowed(gated.action, cfg);

  if (ACTIONS_REQUIRING_LOCATOR.has(gated.action) && !gated.locator) {
    throw new PolicyViolation(gated.action + " requires a locator");
  }

  if (gated.action === "fill" || gated.action === "select") {
    if (gated.value == null && gated.action === "select") {
      // value may come from paramRef at execute time; locator still required
    }
    if (gated.locator) {
      if (!gated.locator.strategy || gated.locator.value == null || gated.locator.value === "") {
        throw new PolicyViolation(gated.action + " locator must include strategy and value");
      }
    }
  }

  const irreversible = resolveIrreversible(gated);
  assertIrreversibleAllowed(irreversible, opts.confirmIrreversible === true);

  if (gated.action === "navigate") {
    if (!gated.url) throw new PolicyViolation("navigate requires a URL");
    assertUrlAllowed(gated.url, cfg);
  }

  if (gated.action === "press" && !gated.key) {
    throw new PolicyViolation("press requires a key");
  }

  if (gated.key) {
    if (/\b(Meta|Control|Alt|Cmd|Super)\b/i.test(gated.key)) {
      throw new PolicyViolation('Key "' + gated.key + '" is not on the press allowlist');
    }
    const base = gated.key.split("+").pop() ?? gated.key;
    if (!ALLOWED_KEYS.has(base) && !/^[a-zA-Z0-9]$/.test(base)) {
      throw new PolicyViolation('Key "' + gated.key + '" is not on the press allowlist');
    }
  }

  if (gated.locator?.strategy === "css") {
    const v = gated.locator.value;
    if (/expression\s*\(|javascript:|@import|data:/i.test(v)) {
      throw new PolicyViolation("Blocked dangerous CSS locator");
    }
  }

  if (gated.value && /(?:^|\n)\s*(?:eval|Function|require|import\s*\()/m.test(gated.value)) {
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

/**
 * Sanitize capability/artifact file basenames: strip path traversal and
 * allowlist [A-Za-z0-9._-]. Empty/unsafe names fall back to "artifact".
 */
export function sanitizeArtifactFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  const trimmed = cleaned.slice(0, 120);
  return trimmed.length > 0 ? trimmed : "artifact";
}
