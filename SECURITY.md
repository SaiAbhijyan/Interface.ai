# Security

## Threat model (scope of this take-home)

This system drives legacy bank back-office UIs with an LLM during discovery, then runs deterministic replay without the model.

| Threat | Mitigation |
|--------|------------|
| Localhost any-port SSRF (e.g. :6379/:9200/:3000) feeding observe to LLM | Full **origin** allowlist (scheme+host+port), default `http://127.0.0.1:4173` |
| Click-driven navigation off allowlist | Playwright `page.route` + `framenavigated` re-check; click post-nav assert |
| Path escape / asset-suffix bypass | Exact path allowlist; no `*.js|css` wildcard |
| Irreversible actions without intent | Explicit `irreversible` flag + control policy (`#oaSubmit`, role Submit) — **not** `/confirm/i` heuristics |
| XSS in mock results poisoning observation | `results.html` builds DOM via textContent/createElement only |
| PII/secrets to LLM or logs | `redactObserveSnapshot` / `redactText` before LLM + JSONL |
| Tool-arg injection / code exec | `sanitizeToolArgs`; no eval of model output; fixed tool schema |
| HITL fail-open | `HITL_MODE=manual` requires `waitForOperator` or throws |
| Secrets in git | `.gitignore` excludes `.env`; only `.env.example` committed |

## Allowlist model

- `allowedOrigins`: full origins only (CRITICAL port bind)
- `allowedPaths`: exact pathnames
- `allowedPathPrefixes`: optional; `/` is rejected as a prefix
- `gateAction` + `assertUrlAllowed` before driver calls
- `PlaywrightSurfaceDriver.open` asserts origin+path **before** launch navigation

## Irreversible policy

Authoritative sources (in order):

1. Explicit `step.irreversible: true` on the CapabilityArtifact
2. `IRREVERSIBLE_CONTROL_POLICY` — known CSS ids (`oaConfirm`, `oaSubmit`) and role/name pairs (`Submit`, `Confirm & Submit`)

A step with `irreversible: false` targeting `#oaSubmit` still gates. Name heuristics like `/confirm/i` are **not** used (they miss Submit / #oaSubmit).

## Residual risks

- Screenshots can visually contain on-screen PII (no OCR scrub)
- Production must load per-tenant origin/path policy
- HITL operators are privileged by design

## Reviewer checklist

- [x] Origin allowlist rejects :6379/:9200/:3000
- [x] Navigation interceptor on route + framenavigated
- [x] Path allowlist on open; no asset-suffix bypass
- [x] Irreversible via flags/policy, not confirm substring
- [x] results.html XSS fixed (textContent)
- [x] Observe redacted before LLM
- [x] HITL manual fail-closed
- [x] Unit tests for origin port bind + irreversible + redaction

## Freeze residuals (closed)

- data:/blob: blocked; about:blank only
- Allowlist frozen at driver install (TOCTOU)
- fill/select/extract require locators
- Irreversible: explicit flags + exact policy table
- E2E nav-escape integration tests green
