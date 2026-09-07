import fs from "node:fs";
import path from "node:path";

/**
 * Redact secrets and PII before artifacts, logs, or LLM observe payloads.
 */

export const SECRET_REFUSAL_PATTERNS: { name: string; re: RegExp; replace: string }[] = [
  { name: "openai_key", re: /\bsk-[A-Za-z0-9_-]{10,}\b/g, replace: "[REDACTED_API_KEY]" },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, replace: "[REDACTED_API_KEY]" },
  { name: "bearer", re: /\bBearer\s+[A-Za-z0-9._\-+/=]+/gi, replace: "Bearer [REDACTED_TOKEN]" },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replace: "[REDACTED_JWT]" },
  {
    name: "password_field",
    re: /((?:password|secret)["']?\s*[:=]\s*["']?)[^"'\s,}]+/gi,
    replace: "$1[REDACTED]",
  },
  { name: "ssn", re: /\b\d{3}-\d{2}-\d{4}\b/g, replace: "[REDACTED_SSN]" },
  { name: "card", re: /\b(?:\d[ -]*?){13,19}\b/g, replace: "[REDACTED_PAN]" },
  { name: "email", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, replace: "[REDACTED_EMAIL]" },
  {
    name: "member_name_line",
    re: /(Member Name(?:<\/td>)?\s*(?:<td>)?\s*)([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    replace: "$1[REDACTED_NAME]",
  },
  {
    name: "person_name_row",
    re: /(\bName\b(?:<\/td>)?\s*(?:<td>)?\s*)([A-Z][a-z]+\s+[A-Z][a-z]+)/g,
    replace: "$1[REDACTED_NAME]",
  },
  {
    name: "env_api_key",
    re: /((?:OPENAI_API_KEY|ANTHROPIC_API_KEY|API[_-]?KEY)["']?\s*[:=]\s*["']?)[^"'\s}]+/gi,
    replace: "$1[REDACTED_API_KEY]",
  },
];

function clonePattern(name: string): RegExp | null {
  const p = SECRET_REFUSAL_PATTERNS.find((x) => x.name === name);
  if (!p) return null;
  return new RegExp(p.re.source, p.re.flags);
}

export function redactText(input: string): string {
  let out = input;
  for (const p of SECRET_REFUSAL_PATTERNS) {
    out = out.replace(new RegExp(p.re.source, p.re.flags), p.replace);
  }
  return out;
}

/** Keys whose values are always redacted at rest (logs / LLM payloads / evidence). */
export const SENSITIVE_KEY_RE =
  /password|secret|token|ssn|pan|card|cvv|pin|credential|api[_-]?key|authorization|cookie|session|member[_-]?id|account(?:[_-]?id|[_-]?number)?|customer(?:[_-]?id)?|bank|routing|iban|email|phone|dob|date[_-]?of[_-]?birth/i;

export function redactValue(key: string, value: unknown): unknown {
  const sensitiveKeys = SENSITIVE_KEY_RE;
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
  // Ignore already-redacted placeholders so fail-closed scans of logs don't false-positive.
  const scrubbed = json.replace(/\[REDACTED[^\]]*\]/gi, "");
  const checks: { name: string; label: string }[] = [
    { name: "openai_key", label: "API key material" },
    { name: "anthropic_key", label: "API key material" },
    { name: "env_api_key", label: "API key assignment" },
    { name: "bearer", label: "bearer token" },
    { name: "ssn", label: "SSN-like data" },
    { name: "jwt", label: "JWT" },
    { name: "card", label: "PAN-like digit run" },
    { name: "password_field", label: "password/secret assignment" },
    { name: "email", label: "email address" },
  ];
  for (const { name, label } of checks) {
    const re = clonePattern(name);
    if (re && re.test(scrubbed)) {
      throw new Error("Refusing to persist artifact containing " + label);
    }
  }
}

/**
 * Fail-closed scan of an evidence directory before commit/promotion.
 * Scans artifact.json, *.jsonl, and *.txt under `dir` (non-recursive).
 */
export function assertNoSecretsInEvidenceDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    throw new Error(`Evidence dir missing: ${dir}`);
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(json|jsonl|txt)$/i.test(f));
  for (const f of files) {
    const full = path.join(dir, f);
    const body = fs.readFileSync(full, "utf8");
    try {
      assertNoSecretsInArtifactJson(body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${msg} (file: ${f})`);
    }
  }
}
