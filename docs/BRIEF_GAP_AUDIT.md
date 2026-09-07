# Brief gap audit - Interface.ai vs take-home 3.1-3.7 + 6

**Audited:** /workspace/Interface.ai against /workspace/interface-ai-assignment.pdf (pdftotext).
**Date:** 2026-09-07 (America/New_York).
**Constraint honored:** do not push; do not invent / commit an API key.

---

## Executive verdict

Strong vertical **code** slice for artifact schema, deterministic replay, allowlist/safety, and labeled synthetic discovery. **Submission-critical gaps** remain vs the brief non-negotiables:

1. **No genuine LLM discovery evidence** in /evidence/ (brief section 4: discovery run has to be real).
2. **HITL** file waitForOperator + evidence/hitl-proof keeper landed; live CDP attach UX still a cut.
3. **Committed replay evidence** is thin: summary JSON only; JSONL under gitignored replay-* dirs; no curated hard_failure keeper (only business_outcome).
4. **README demo path** lacks exact copy-paste commands (deliverable 6.1).
5. **REPORT.md** has seven required headings but inserts Evaluation metrics before Cuts; section 3.7 multi-tenant story is shallow.

---

## Section 3 Must-haves

### 3.1 Goal-driven agent loop - DONE (code); evidence THIN

- DONE: agent loop in src/agent/discover.ts
- DONE: Live UI Playwright src/surface/playwright-driver.ts
- DONE: tools.ts, loop-policy.ts, CLI src/cli/discover.ts
- THIN: only synthetic discovery evidence (evidence/discover-synthetic-302f56/, SYNTHETIC_LABEL.txt)

### 3.2 Structured artifact - DONE

- DONE: Zod schema src/artifact/schema.ts
- DONE: Fixtures artifacts/lookup_member_savings_balance.json and open_member_sub_account.json

### 3.3 Deterministic replay - DONE code, partial evidence

- DONE: src/replay/executor.ts and src/cli/replay.ts
- DONE: Taxonomy success, business_outcome, recoverable, hard_failure
- DONE: tests/integration/replay.test.ts
- DONE partial: evidence/replay-success.json and replay-business-outcome.json
- THIN: summary keepers point logPath at gitignored replay-UUID JSONL
- THIN: no curated committed hard_failure pack

### 3.4 Safety and policy guardrails - DONE with residuals

- DONE: Origin allowlist scheme+host+port, path allowlist, nav interceptor: src/guardrails/allowlist.ts, playwright-driver.ts
- DONE: Action gate + irreversible policy: src/guardrails/action-gate.ts
- DONE: Redaction src/guardrails/redaction.ts; safe-path.ts
- DONE: SECURITY.md plus unit/integration allowlist tests
- Residual: artifact.safety.allowedOrigins not intersected at replay; screenshot OCR scrub cut

### 3.5 Evidence / observability - DONE code; packaging THIN

- DONE: JSONL RunLogger src/observability/logger.ts; screenshots on failure
- DONE: evidence/demo-proof/ png+webm (mock UI proof, not LLM discovery)
- THIN: about 310 local evidence/replay-* dirs (gitignored spam)

### 3.6 HITL escalation and handoff - DONE (file wait); CDP attach still CUT

- DONE seam: src/hitl/handoff.ts pause same SurfaceDriver, InterventionRequest, resume; fail-closed manual vs HITL_MODE=mock
- DONE driver: pauseForHuman in playwright-driver.ts (~L384)
- DONE waiter: src/hitl/wait-for-operator.ts (file handshake + AUTO_NOTES only with explicit resume path)
- DONE CLI: replay on-failure + proof-dir / resume-file / operator-file; discover same flags when escalating
- DONE proof: scripts/hitl-proof.mjs -> evidence/hitl-proof/ keeper
- DONE tests: tests/unit/hitl.test.ts (fail-closed + file resume + AUTO_NOTES guard)
- CUT: live CDP/ws attach UX / human-action recording (documented)

### 3.7 Heterogeneity and multi-tenant design - THIN

- DONE partial: SurfaceDriver web/desktop seam in src/surface/types.ts
- THIN: REPORT Heterogeneity section weak on vendor-base artifact, tenant overlays, drift detection


## Section 6 Deliverables
### 6.1 README.md - THIN
- Setup partial; env example exists; exact install more in docs/PROCESS.md
- Demo path MISSING as copy-paste literal package script commands for discover then replay

### 6.2 REPORT.md seven headings - MOSTLY DONE with drift
- Present: Architecture; Artifact schema; Determinism and error handling; Heterogeneity and multi-tenant; Escalation and handoff; Safety; Cuts
- Issue: Extra Evaluation metrics heading between Safety and Cuts; move to docs/EVAL_METRICS.md
- Length about 40 lines; several sections one paragraph

### 6.3 evidence/ - PARTIAL
- Saved artifact: YES under artifacts/ and evidence/discover-synthetic-302f56/artifact.json
- Discovery logs: synthetic JSONL only; not a genuine LLM run
- Replay logs: summary keepers only; JSONL under gitignored replay-* dirs
- Exceptional state: replay-business-outcome.json MEM_NOT_FOUND good; no committed hard_failure pack

---

## Evidence spam - keepers only for commit

.gitignore ignores evidence/replay-*/ and evidence/discover-*/ with exceptions for the two summary JSON files and README.
Local tree: about 310 evidence/replay-* directories. Do not commit them.

### Recommended keepers

- evidence/README.md
- evidence/replay-success.json
- evidence/replay-business-outcome.json
- evidence/discover-synthetic-302f56/** (honest synthetic until replaced by live LLM pack)
- evidence/demo-proof/** (optional UI recordings)
- evidence/hitl-proof/** (HITL file-handshake proof; run `node scripts/hitl-proof.mjs`)
- ADD: evidence/replay-success/ and evidence/replay-business-outcome/ with copied JSONL so logs survive gitignore; use repo-relative logPath
- ADD blocking: evidence/discover-live-*/ with LLM JSONL + artifact + LIVE_LLM_LABEL.txt after operator supplies real key locally
- DELETE/leave untracked: all evidence/replay-HEX/ mass runs
- Tighten .gitignore exceptions for discover-synthetic-302f56 and demo-proof and named keeper dirs

---

## Exact next actions by role

Do not push. Do not invent or commit an API key.

### Interface AI (assignment / product owner)
1. Accept synthetic-only discovery fails brief section 4 hard rule until one live LLM evidence pack exists.
2. Prefer minimal-real HITL (headed + stdin/watchfile waitForOperator) over mock-only for scoring.
3. Treat SECURITY.md as a plus; not a substitute for section 6 evidence/README gaps.

### Eng Lead
1. Gate submit on: live discover evidence; README exact demo commands; REPORT seven headings + stronger 3.7; replay JSONL keepers with relative paths; HITL CLI wait or documented Cuts.
2. Order: README/REPORT packaging, evidence keepers, live discover (human-owned key), HITL wire-up.
3. Delete local evidence/replay-* spam before staging; verify git check-ignore.
4. No remote push from agents; human owns auth and public repo publish.

### Software Dev
1. README: exact commands for install, mock:bank, discover (live and --synthetic-fallback), replay success and memberId=99999 BO.
2. Live discovery: operator pastes key into local .env only; run discover once; write evidence/discover-id/ with artifact+JSONL+synthetic false label; never commit .env.
3. Replay evidence pack: copy JSONL into non-ignored keeper dirs; relative logPath; optional hard_failure keeper (irreversible without confirm).
4. HITL: DONE file waitForOperator + evidence/hitl-proof/; HITL_MODE=mock for CI only; CDP attach still cut.
5. REPORT: remove Evaluation metrics from main seven; expand Heterogeneity multi-tenant; honest Cuts.
6. Cleanup spam; tighten gitignore; do not push.

---

## Priority order (blocking to polish)

1. P0 Genuine LLM discovery evidence (operator-supplied key; no invented key)
2. P0 README exact demo path
3. P0 Commit-safe replay and discovery logs with relative paths; scrub replay spam
4. P1 HITL CLI waitForOperator + evidence/hitl-proof — DONE (CDP attach still cut)
5. P1 REPORT exactly seven headings; deepen section 3.7
6. P2 Curated hard_failure keeper; intersect artifact.safety origins at replay

## SECURITY note

SECURITY.md is solid and beyond section 6 required deliverables (threat model, allowlist, irreversible, redaction, HITL fail-closed, checklist). Keep it. Residuals listed under 3.4.

## DONE path index (building blocks)

apps/legacy-bank-mock/server.ts; artifacts/*.json; src/agent/{discover,loop-policy,tools}.ts; src/artifact/{schema,fixtures}.ts; src/cli/{discover,replay}.ts; src/guardrails/*; src/hitl/{handoff,wait-for-operator}.ts; scripts/hitl-proof.mjs; evidence/hitl-proof/; src/observability/logger.ts; src/replay/executor.ts; src/surface/{types,playwright-driver}.ts; tests/integration/replay.test.ts; tests/unit/hitl.test.ts; SECURITY.md; REPORT.md; README.md; evidence/{README.md,demo-proof/,discover-synthetic-302f56/,replay-success.json,replay-business-outcome.json}; .env.example
