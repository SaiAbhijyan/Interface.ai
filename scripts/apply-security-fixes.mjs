import { writeFileSync } from "fs";

writeFileSync("src/guardrails/allowlist.ts", String.raw`import type { ActionType } from "../artifact/schema.js";

export type AllowlistConfig = {
  allowedHosts: string[];
  allowedActions: ActionType[];
  allowedPaths: string[];
  allowedPathPrefixes: string[];
};

export const DEFAULT_ALLOWLIST: AllowlistConfig = {
  allowedHosts: ["127.0.0.1", "localhost"],
  allowedActions: [
    "navigate",
    "click",
    "fill",
    "select",
    "press",
    "wait_for",
    "extract",
    "assert",
    "dismiss_if_present",
  ],
  allowedPaths: [
    "/",
    "/index.html",
    "/lookup.html",
    "/open-account.html",
    "/results.html",
    "/bank-logic.js",
  ],
  // Empty by default. Do NOT use "/" — that would allow every path.
  allowedPathPrefixes: [],
};

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

export function loadAllowlistFromEnv(): AllowlistConfig {
  const hosts = process.env.ALLOWED_HOSTS?.split(",").map((s) => s.trim()).filter(Boolean);
  const prefixes = process.env.ALLOWED_PATH_PREFIXES?.split(",").map((s) => s.trim()).filter(Boolean);
  const paths = process.env.ALLOWED_PATHS?.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    ...DEFAULT_ALLOWLIST,
    allowedHosts: hosts?.length ? hosts : DEFAULT_ALLOWLIST.allowedHosts,
    allowedPathPrefixes: prefixes ?? DEFAULT_ALLOWLIST.allowedPathPrefixes,
    allowedPaths: paths?.length ? paths : DEFAULT_ALLOWLIST.allowedPaths,
  };
}

export function assertHostAllowed(url: string, cfg: AllowlistConfig): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PolicyViolation("Invalid URL: " + url);
  }
  if (parsed.protocol === "about:") return;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PolicyViolation("Blocked navigation scheme: " + parsed.protocol);
  }
  if (!cfg.allowedHosts.includes(parsed.hostname)) {
    throw new PolicyViolation(
      'Host "' + parsed.hostname + '" is not on the allowlist (' + cfg.allowedHosts.join(", ") + ")",
    );
  }
}

export function assertActionAllowed(action: ActionType, cfg: AllowlistConfig): void {
  if (!cfg.allowedActions.includes(action)) {
    throw new PolicyViolation('Action "' + action + '" is not permitted by allowlist');
  }
}

/** Fail-closed. Exact paths OR non-root prefixes only. No *.js|css wildcard bypass. */
export function assertPathAllowed(url: string, cfg: AllowlistConfig): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PolicyViolation("Invalid URL for path check: " + url);
  }
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
  assertHostAllowed(url, cfg);
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

console.log("wrote allowlist");
