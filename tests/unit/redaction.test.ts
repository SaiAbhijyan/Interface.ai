import { describe, it, expect } from "vitest";
import {
  redactText,
  redactObject,
  assertNoSecretsInArtifactJson,
  assertNoSecretsInEvidenceDir,
  SECRET_REFUSAL_PATTERNS,
  SENSITIVE_KEY_RE,
} from "../../src/guardrails/redaction.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

describe("redaction", () => {
  it("redacts API keys and SSNs", () => {
    const s = redactText("key sk-abcdefghijklmnopqrstuvwxyz1234 and ssn 123-45-6789");
    expect(s).toContain("[REDACTED_API_KEY]");
    expect(s).toContain("[REDACTED_SSN]");
    expect(s).not.toContain("sk-abcdefghijklmnop");
  });

  it("redacts JWT and PAN-like sequences", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signaturepart";
    const s = redactText(`token ${jwt} card 4111111111111111`);
    expect(s).toContain("[REDACTED_JWT]");
    expect(s).toContain("[REDACTED_PAN]");
    expect(s).not.toContain("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9");
  });

  it("redacts password/secret field assignments", () => {
    const s = redactText('password: hunter2 secret="s3cr3t"');
    expect(s).toMatch(/password.*\[REDACTED\]/i);
    expect(s).toMatch(/secret.*\[REDACTED\]/i);
    expect(s).not.toContain("hunter2");
    expect(s).not.toContain("s3cr3t");
  });

  it("redacts sensitive object keys", () => {
    const o = redactObject({ password: "hunter2", memberId: "10001", note: "ok" });
    expect(o.password).toBe("[REDACTED]");
    expect(o.memberId).toBe("[REDACTED]");
    expect(o.note).toBe("ok");
  });

  it("assertNoSecretsInArtifactJson throws on key material", () => {
    expect(() =>
      assertNoSecretsInArtifactJson('{"k":"sk-abcdefghijklmnopqrstuvwxyz"}'),
    ).toThrow();
    expect(() => assertNoSecretsInArtifactJson('{"name":"ok"}')).not.toThrow();
  });

  it("assertNoSecretsInArtifactJson refuses JWT, PAN, password fields", () => {
    expect(() =>
      assertNoSecretsInArtifactJson(
        '{"t":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"}',
      ),
    ).toThrow(/JWT/i);
    expect(() =>
      assertNoSecretsInArtifactJson('{"pan":"4111111111111111"}'),
    ).toThrow(/PAN/i);
    expect(() =>
      assertNoSecretsInArtifactJson('{"cfg":"password=hunter2"}'),
    ).toThrow(/password/i);
    expect(() =>
      assertNoSecretsInArtifactJson('{"cfg":"secret: abcdef"}'),
    ).toThrow(/secret/i);
  });

  it("exports shared SECRET_REFUSAL_PATTERNS list", () => {
    expect(SECRET_REFUSAL_PATTERNS.length).toBeGreaterThanOrEqual(6);
    const names = SECRET_REFUSAL_PATTERNS.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(["jwt", "card", "password_field", "ssn", "email"]));
  });

  it("assertNoSecretsInArtifactJson refuses email", () => {
    expect(() =>
      assertNoSecretsInArtifactJson('{"e":"member@bank.example"}'),
    ).toThrow(/email/i);
  });

  it("redacts identity keys (memberId/account/email) at rest", () => {
    const o = redactObject({ memberId: "10001", accountNumber: "9988", email: "a@b.co", ok: "x" });
    expect(o.memberId).toBe("[REDACTED]");
    expect(o.accountNumber).toBe("[REDACTED]");
    expect(o.email).toBe("[REDACTED]");
    expect(o.ok).toBe("x");
    expect(SENSITIVE_KEY_RE.test("memberId")).toBe(true);
  });

  it("redacts OPENAI_API_KEY assignments in text", () => {
    const s = redactText('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz');
    expect(s).toContain("[REDACTED_API_KEY]");
    expect(s).not.toContain("sk-abcdefghijklmnop");
  });

  it("assertNoSecrets allows already-redacted placeholders", () => {
    expect(() =>
      assertNoSecretsInArtifactJson('{"password":"[REDACTED]","apiKey":"[REDACTED_API_KEY]"}'),
    ).not.toThrow();
  });

  it("assertNoSecretsInEvidenceDir scans jsonl and refuses raw keys", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ev-clean-"));
    fs.writeFileSync(path.join(dir, "artifact.json"), '{"name":"ok"}');
    fs.writeFileSync(
      path.join(dir, "run-x.jsonl"),
      JSON.stringify({ message: "leak sk-abcdefghijklmnopqrstuvwxyz" }) + "\n",
    );
    expect(() => assertNoSecretsInEvidenceDir(dir)).toThrow(/API key/i);
    fs.writeFileSync(
      path.join(dir, "run-x.jsonl"),
      JSON.stringify({ message: "safe", data: { memberId: "[REDACTED]" } }) + "\n",
    );
    expect(() => assertNoSecretsInEvidenceDir(dir)).not.toThrow();
  });

});
