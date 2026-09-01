import { describe, it, expect } from "vitest";
import {
  redactText,
  redactObject,
  assertNoSecretsInArtifactJson,
  SECRET_REFUSAL_PATTERNS,
} from "../../src/guardrails/redaction.js";

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
    const o = redactObject({ password: "hunter2", memberId: "10001" });
    expect(o.password).toBe("[REDACTED]");
    expect(o.memberId).toBe("10001");
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
    expect(names).toEqual(expect.arrayContaining(["jwt", "card", "password_field", "ssn"]));
  });
});
