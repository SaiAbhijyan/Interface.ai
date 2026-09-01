# Interface.ai Computer-Use Automation

Discover once to a CapabilityArtifact; replay deterministically (no LLM) on the legacy bank mock.

## Quick start

1. Install project dependencies.
2. Ensure Playwright Chromium is available.
3. Configure local env from the example file.
4. Start the mock bank (package script mock:bank).

Demo members: 10001 found; 99999 not found.

## Discover

Live: package script discover with --goal --url --param.
No key: add --synthetic-fallback for labeled fixture evidence.

## Replay

package script replay --artifact artifacts/lookup_member_savings_balance.json --param memberId=10001
Use memberId=99999 for business_outcome MEM_NOT_FOUND.
Open-account irreversible steps need --confirm-irreversible.

## Tests

package script test (vitest unit + integration).

## Deliverables

- README.md — this file
- REPORT.md — design (Architecture; Artifact schema; Determinism and error handling; Heterogeneity and multi-tenant; Escalation and handoff; Safety; Cuts)
- docs/PROCESS.md — step-by-step
- SECURITY.md — threat model
- docs/RESEARCH_CITATIONS.md — sources folded into REPORT
- artifacts/ and evidence/

## Safety defaults

Origin allowlist (scheme+host+port), nav interceptor, irreversible policy table (not confirm-substring), redaction before LLM, HITL manual fail-closed. See SECURITY.md.
