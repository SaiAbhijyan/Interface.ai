import { writeFileSync, readFileSync } from "fs";

// 1) allowlist — tighten about:/data:; freeze config copy helper
writeFileSync("src/guardrails/allowlist.ts", `import type { ActionType } from "../artifact/schema.js";

export type AllowlistConfig = {
  allowedOrigins: string[];
  allowedActions: ActionType[];
  allowedPaths: string[];
  allowedPathPrefixes: string[];
};

export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
  allowedActions: [
    "navigate", "click", "fill", "select", "press",
    "wait_for", "extract", "assert", "dismiss_if_present",
  ],
  allowedPaths: [
    "/", "/index.html", "/lookup.html", "/open-account.html",
    "/results.html", "/bank-logic.js",
  ],
  allowedPathPrefixes: [],
};

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

/** Deep-freeze a snapshot so callers cannot mutate policy mid-flight (TOCTOU). */
export function freezeAllowlist(cfg: AllowlistConfig): Readonly<AllowlistConfig> {
  return Object.freeze({
    allowedOrigins: Object.freeze([...cfg.allowedOrigins]),
    allowedActions: Object.freeze([...cfg.allowedActions]) as ActionType[],
    allowedPaths: Object.freeze([...cfg.allowedPaths]),
    allowedPathPrefixes: Object.freeze([...cfg.allowedPathPrefixes]),
  });
}

function normalizeOrigin(url: URL): string {
  const port =
    url.port ||
    (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return url.protocol + "//" + url.hostname + (port ? ":" + port : "");
}

/** Only about:blank is permitted; all data: / blob: / file: / javascript: rejected. */
export function assertSchemeAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PolicyViolation("Invalid URL: " + url);
  }
  if (parsed.protocol === "about:") {
    if (parsed.pathname === "blank" || url === "about:blank") return;
    throw new PolicyViolation("Blocked about: URL (only about:blank allowed): " + url);
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:" || parsed.protocol === "file:") {
    throw new PolicyViolation("Blocked navigation scheme: " + parsed.protocol);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PolicyViolation("Blocked navigation scheme: " + parsed.protocol);
  }
}

export function loadAllowlistFromEnv(): AllowlistConfig {
  const origins = process.env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  const prefixes = process.env.ALLOWED_PATH_PREFIXES?.split(",").map((s) => s.trim()).filter(Boolean);
  const paths = process.env.ALLOWED_PATHS?.split(",").map((s) => s.trim()).filter(Boolean);
  return freezeAllowlist({
    ...DEFAULT_ALLOWLIST,
    allowedOrigins: origins?.length ? origins : DEFAULT_ALLOWLIST.allowedOrigins,
    allowedPathPrefixes: prefixes ?? DEFAULT_ALLOWLIST.allowedPathPrefixes,
    allowedPaths: paths?.length ? paths : DEFAULT_ALLOWLIST.allowedPaths,
  }) as AllowlistConfig;
}

export function assertOriginAllowed(url: string, cfg: AllowlistConfig): void {
  assertSchemeAllowed(url);
  const parsed = new URL(url);
  if (parsed.protocol === "about:") return;
  const origin = normalizeOrigin(parsed);
  const allowed = cfg.allowedOrigins.map((o) => normalizeOrigin(new URL(o)));
  if (!allowed.includes(origin)) {
    throw new PolicyViolation(
      'Origin "' + origin + '" is not on the allowlist (' + cfg.allowedOrigins.join(", ") + ")",
    );
  }
}

export function assertHostAllowed(url: string, cfg: AllowlistConfig): void {
  assertOriginAllowed(url, cfg);
}

export function assertActionAllowed(action: ActionType, cfg: AllowlistConfig): void {
  if (!cfg.allowedActions.includes(action)) {
    throw new PolicyViolation('Action "' + action + '" is not permitted by allowlist');
  }
}

export function assertPathAllowed(url: string, cfg: AllowlistConfig): void {
  const u = new URL(url);
  if (u.protocol === "about:") return;
  const path = u.pathname || "/";
  if (cfg.allowedPaths.includes(path)) return;
  for (const prefix of cfg.allowedPathPrefixes) {
    if (!prefix || prefix === "/") continue;
    const normalized = prefix.endsWith("/") ? prefix : prefix + "/";
    if (path === prefix || path.startsWith(normalized)) return;
  }
  throw new PolicyViolation(
    'Path "' + path + '" is outside allowed routes (' + cfg.allowedPaths.join(", ") + ")",
  );
}

export function assertUrlAllowed(url: string, cfg: AllowlistConfig): void {
  assertOriginAllowed(url, cfg);
  assertPathAllowed(url, cfg);
}

export function assertIrreversibleAllowed(
  irreversible: boolean | undefined,
  confirmIrreversible: boolean,
): void {
  if (irreversible && !confirmIrreversible) {
    throw new PolicyViolation(
      "Irreversible action blocked: pass --confirm-irreversible (or confirmIrreversible: true) to proceed",
    );
  }
}
`);

// 2) action-gate — fill/select completeness; irreversible = flag + css id policy only (exact roleNames as explicit policy table, not fuzzy)
writeFileSync("src/guardrails/action-gate.ts", `/**
 * Security gate for all automation actions.
 * Irreversible: explicit step.irreversible OR exact IRREVERSIBLE_CONTROL_POLICY entries.
 * No fuzzy /confirm|submit/i heuristics.
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

/** Explicit policy table — extend this list deliberately; do not use regex name heuristics. */
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
  irreversible?: boolean;
};

export function resolveIrreversible(gated: GatedAction): boolean {
  if (gated.irreversible === true) return true;
  const loc = gated.locator;
  if (!loc) return false;

  if (loc.strategy === "css") {
    const idMatch = loc.value.match(/#([A-Za-z][\\w-]*)/);
    if (idMatch && IRREVERSIBLE_CONTROL_POLICY.cssIds.includes(idMatch[1]!)) return true;
  }
  for (const rn of IRREVERSIBLE_CONTROL_POLICY.roleNames) {
    if (
      (loc.strategy === "role_name" || loc.strategy === "frame_role_name") &&
      (loc.role ?? "button") === rn.role &&
      loc.value === rn.name
    ) {
      return true;
    }
    // Exact text match against policy table only (not substring heuristics)
    if (loc.strategy === "text" && loc.value === rn.name) return true;
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

  if (gated.key) {
    const base = gated.key.split("+").pop() ?? gated.key;
    if (!ALLOWED_KEYS.has(base) && !/^[a-zA-Z0-9]$/.test(base)) {
      throw new PolicyViolation('Key "' + gated.key + '" is not on the press allowlist');
    }
  }

  if (gated.locator?.strategy === "css") {
    const v = gated.locator.value;
    if (/expression\\s*\\(|javascript:|@import|data:/i.test(v)) {
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
console.log("allowlist+gate residuals fixed");
