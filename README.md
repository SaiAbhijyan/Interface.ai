# Interface.ai Computer-Use Automation

Discover once to a CapabilityArtifact; replay deterministically (no LLM) on the legacy bank mock.

## Quick start

```bash
# Install
npm install
npx playwright install chromium

# Env
cp .env.example .env
# Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL for OmniRoute)

# Mock bank (keep running)
npm run mock:bank
# → http://127.0.0.1:4173
```

Demo members: **10001** found; **99999** not found (`MEM_NOT_FOUND`).

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `OPENAI_API_KEY` | For live discover | Model provider key |
| `OPENAI_BASE_URL` | Optional | OpenAI-compatible base URL (**OmniRoute** / proxies); honored by `createOpenAIClient` |
| `OPENAI_MODEL` | Optional | Default `gpt-4o` |
| `HITL_MODE` | Optional | Default `manual` (fail-closed); set `mock` only for demos/tests |
| `BANK_MOCK_URL` | Optional | Default `http://127.0.0.1:4173` |
| `ALLOWED_ORIGINS` | Optional | Full origins (scheme+host+port) |
| `ALLOWED_PATHS` / `ALLOWED_PATH_PREFIXES` | Optional | Path allowlist (never bare `/` prefix) |

## Discover

**Live LLM** (writes `evidence/discover-live-<runId>/` with `artifact.json` + redacted `run-*.jsonl`):

```bash
npm run discover -- \
  --goal "look up member and read savings balance" \
  --url http://127.0.0.1:4173 \
  --param memberId=10001
```

With OmniRoute: set `OPENAI_BASE_URL` (and key) in `.env`, then the same command.

**Synthetic fallback** (labeled fixture only):

```bash
npm run discover -- \
  --goal "look up member and read savings balance" \
  --url http://127.0.0.1:4173 \
  --param memberId=10001 \
  --synthetic-fallback
```

`--synthetic-fallback` / `discover-synthetic-*` is **insufficient for brief §4 / §6** — those sections expect a genuine LLM run under `evidence/discover-live-*` once a key or OmniRoute is wired.

## Replay

```bash
# Success (member 10001) -> evidence summary like replay-success.json
npm run replay -- \
  --artifact artifacts/lookup_member_savings_balance.json \
  --param memberId=10001

# Business outcome MEM_NOT_FOUND (member 99999) — NOT hard_failure
npm run replay -- \
  --artifact artifacts/lookup_member_savings_balance.json \
  --param memberId=99999
```

Open-account irreversible steps need `--confirm-irreversible`.

Keeper summaries: `evidence/replay-success.json`, `evidence/replay-business-outcome.json`.

## HITL (manual fail-closed + file wait)

Default HITL_MODE=manual is fail-closed: without waitForOperator, escalation throws HitlBlockedError. Use HITL_MODE=mock only for demos/CI.

File handshake (src/hitl/wait-for-operator.ts) writes intervention-request.json + attach instructions, then polls hitl-resume.json for operatorNotes.

**Proof pack (stub driver, no API key, no secrets in evidence):**

```bash
node scripts/hitl-proof.mjs
```

**Replay with HITL on hard failure:**

```bash
HITL_MODE=manual npm run replay -- \
  --artifact artifacts/lookup_member_savings_balance.json \
  --param memberId=10001 \
  --hitl-on-failure \
  --hitl-proof-dir evidence/hitl-proof \
  --hitl-resume-file evidence/hitl-proof/hitl-resume.json
```

After intervention-request.json appears, write hitl-resume.json with an operatorNotes field.

Discover: pass proof-dir / resume-file / operator-file flags when escalate may fire.

HITL_AUTO_NOTES only applies with an explicit resume or operator file path.

Unit coverage: `tests/unit/hitl.test.ts`.

## Tests

```bash
npm test                 # vitest unit + integration
npm run test:unit
npm run test:integration
npm run typecheck
```

## Deliverables

- `README.md` — this file
- `REPORT.md` — design (Architecture; Artifact schema; Determinism and error handling; Heterogeneity and multi-tenant; Escalation and handoff; Safety; Cuts)
- `docs/PROCESS.md` — step-by-step
- `SECURITY.md` — threat model
- `docs/RESEARCH_CITATIONS.md` — sources folded into REPORT
- `artifacts/` and `evidence/` (see `evidence/README.md` for keepers vs gitignored mass runs)
- `evidence/demo-proof/` — QA screenshots / webms

## Safety defaults

Origin allowlist (scheme+host+port), nav interceptor, irreversible policy (explicit flags + control policy + fail-closed name heuristics), redaction before LLM/logs, HITL manual fail-closed. See `SECURITY.md`.
