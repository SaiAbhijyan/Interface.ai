/**
 * Security gate for all automation actions.
 * Irreversible: explicit step.irreversible OR IRREVERSIBLE_CONTROL_POLICY
 * OR fail-closed confirm/submit signals from id / label / role name / text /
 * placeholder / name / aria-label / title / press value / hint text /
 * CSS id (including hex-escaped and [id*=] forms) — not only exact #id.
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

/** Name-bearing HTML/ARIA attributes often used in CSS attribute selectors. */
const NAME_BEARING_ATTRS = ["name", "aria-label", "title", "placeholder", "aria-labelledby", "value", "alt"];

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
 * Decode CSS identifier escapes so #\6f aSubmit → #oaSubmit.
 * Hex escapes: \HHHHHH with optional whitespace terminator (CSS Syntax).
 */
export function decodeCssIdent(raw: string): string {
  return raw
    .replace(/\\([0-9a-fA-F]{1,6})[\t\n\f ]?/g, (_m, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/\\(.)/g, "$1");
}

export function looksIrreversibleName(normalized: string): boolean {
  return /\b(confirm|submit)\b/.test(normalized);
}

/**
 * Extract element id candidates from CSS locators, including escapes and
 * attribute operators: #oaConfirm, #\6f aSubmit, [id=oaConfirm], [id*=Confirm].
 */
export function extractCssIds(cssValue: string): string[] {
  const decoded = decodeCssIdent(cssValue);
  const ids: string[] = [];

  for (const m of decoded.matchAll(/#([A-Za-z_][\w-]*)/g)) {
    ids.push(m[1]!);
  }
  // Exact equals (optional quotes)
  for (const m of decoded.matchAll(/\[\s*id\s*=\s*(["']?)([A-Za-z_][\w-]*)\1\s*\]/gi)) {
    ids.push(m[2]!);
  }
  // *= ^= $= |= ~= operators — capture the comparison token
  for (const m of decoded.matchAll(/\[\s*id\s*[*^$|~]=(["']?)([^\]"']+)\1\s*\]/gi)) {
    ids.push(m[2]!.trim());
  }
  return [...new Set(ids)];
}

/**
 * Extract name-bearing attribute values from CSS selectors:
 *   [aria-label="Confirm Payment"], [name=confirm], [title*="Submit"],
 *   [placeholder="Confirm Payment"]
 */
export function extractCssNameSignals(cssValue: string): string[] {
  const decoded = decodeCssIdent(cssValue);
  const out: string[] = [];
  const attrAlt = NAME_BEARING_ATTRS.map((a) => a.replace(/-/g, "\\-")).join("|");
  const re = new RegExp(
    String.raw`\[\s*(?:${attrAlt})\s*(?:[*^$|~]?=)\s*(["']?)([^\]"']+)\1\s*\]`,
    "gi",
  );
  for (const m of decoded.matchAll(re)) {
    const v = m[2]!.trim();
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

function idIsIrreversible(id: string): boolean {
  const decoded = decodeCssIdent(id);
  if (IRREVERSIBLE_CONTROL_POLICY.cssIds.includes(decoded)) return true;
  if (looksIrreversibleName(idTokenWords(decoded))) return true;
  if (looksIrreversibleName(normalizeControlName(decoded))) return true;
  return false;
}

function textIsIrreversible(raw: string): boolean {
  const normalized = normalizeControlName(raw);
  if (looksIrreversibleName(normalized)) return true;
  for (const rn of IRREVERSIBLE_CONTROL_POLICY.roleNames) {
    if (normalized === normalizeControlName(rn.name)) return true;
  }
  return false;
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

export function resolveIrreversible(gated: GatedAction): boolean {
  if (gated.irreversible === true) return true;
  const loc = gated.locator;

  // Enter commonly submits forms — fail-closed without confirmIrreversible
  if (gated.action === "press") {
    const key = (gated.key ?? "").split("+").pop() ?? "";
    if (/^Enter$/i.test(key)) return true;
  }

  // CSS id paths: #id, hex-escaped #id, [id=…], [id*=Confirm], etc.
  if (loc?.strategy === "css") {
    for (const id of extractCssIds(loc.value)) {
      if (idIsIrreversible(id)) return true;
    }
    // CSS name/aria-label/title/placeholder attribute selectors
    for (const signal of extractCssNameSignals(loc.value)) {
      if (textIsIrreversible(signal) || idIsIrreversible(signal)) return true;
    }
  }

  const textCandidates: string[] = [];
  if (loc?.value) textCandidates.push(loc.value);
  if (gated.value) textCandidates.push(gated.value);
  if (gated.hint) textCandidates.push(gated.hint);

  for (const raw of textCandidates) {
    const normalized = normalizeControlName(raw);

    for (const rn of IRREVERSIBLE_CONTROL_POLICY.roleNames) {
      const policyName = normalizeControlName(rn.name);
      if (normalized === policyName) {
        if (!loc) return true;
        if (
          (loc.strategy === "role_name" || loc.strategy === "frame_role_name") &&
          (loc.role ?? "button") === rn.role
        ) {
          return true;
        }
        // text / label / placeholder all name-bearing strategies
        if (
          loc.strategy === "text" ||
          loc.strategy === "label" ||
          loc.strategy === "placeholder"
        ) {
          return true;
        }
        if (loc.strategy !== "css") return true;
      }
    }

    // Fail-closed confirm|submit on name-bearing strategies (incl. placeholder)
    const strategy = loc?.strategy;
    const checkHeuristic =
      !loc ||
      strategy === "role_name" ||
      strategy === "frame_role_name" ||
      strategy === "text" ||
      strategy === "label" ||
      strategy === "placeholder" ||
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
