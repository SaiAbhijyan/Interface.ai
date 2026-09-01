import type { ActionType } from "../artifact/schema.js";

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
    allowedOrigins: Object.freeze([...cfg.allowedOrigins]) as string[],
    allowedActions: Object.freeze([...cfg.allowedActions]) as ActionType[],
    allowedPaths: Object.freeze([...cfg.allowedPaths]) as string[],
    allowedPathPrefixes: Object.freeze([...cfg.allowedPathPrefixes]) as string[],
  });
}

function normalizeOrigin(url: URL): string {
  const port =
    url.port ||
    (url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : "");
  return url.protocol + "//" + url.hostname + (port ? ":" + port : "");
}

/**
 * Unit-testable navigation scheme allowlist.
 * Allows: about:blank (optional hash), http:, https:.
 * Blocks: data:, blob:, file:, javascript:, other about:, etc.
 */
export function isNavigationSchemeAllowed(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "about:") {
    // Only about:blank and about:blank#fragment
    return parsed.pathname === "blank" || /^about:blank(?:#.*)?$/i.test(url);
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/** Only about:blank is permitted among about:; all data: / blob: / file: / javascript: rejected. */
export function assertSchemeAllowed(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PolicyViolation("Invalid URL: " + url);
  }
  if (!isNavigationSchemeAllowed(url)) {
    if (parsed.protocol === "about:") {
      throw new PolicyViolation("Blocked about: URL (only about:blank allowed): " + url);
    }
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
