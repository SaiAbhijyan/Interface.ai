# Evidence keepers

Curated artifacts for the take-home brief. **Do not** commit mass per-run spam under `replay-*` or `discover-live-*` (gitignored).

## Keepers (committed)

### Freeze keepers (Assessment)

These directories are **freeze keepers** for handoff review (do not delete when trimming mass runs):

- `hitl-proof/` — file-handshake HITL evidence (`scripts/hitl-proof.mjs`); commit-allowed via `.gitignore` un-ignore (`!evidence/hitl-proof/**`).
- `discover-live-5e157187/` — live LLM discovery (`metadata.synthetic: false`); recreate with key/OmniRoute if missing.

### `discover-synthetic-*` (e.g. `discover-synthetic-302f56/`)

Labeled fixture discovery when `OPENAI_API_KEY` is absent and `--synthetic-fallback` is passed.

- Contains `artifact.json`, `run-*.jsonl`, and `SYNTHETIC_LABEL.txt`
- **Not enough for brief §4 / §6** — reviewers need a genuine LLM discovery run under `discover-live-*` once a key (or OmniRoute) is wired
- Replay against the live mock is still real and deterministic

### `discover-live-<runId>/` (gitignored; produce locally)

Layout written by live discover (`OPENAI_API_KEY` set; optional `OPENAI_BASE_URL` for OmniRoute):

| File | Purpose |
|------|---------|
| `artifact.json` | CapabilityArtifact from the observe/decide/act loop (`metadata.synthetic: false`) |
| `run-<runId>.jsonl` | Redacted run log (PII/secrets scrubbed before write; `assertNoSecretsInEvidenceDir` on close) |
| optional screenshots | e.g. `hitl.png`, `policy-violation.png`, stop/failure shots |

Local live run produced: `discover-live-5e157187/` (`metadata.synthetic: false`). Freeze keeper — recreate with key/OmniRoute as needed.

### `replay-success.json`

Deterministic lookup replay (member `10001`) → status `success`. Summary only; accompanying `replay-<id>/` JSONL dirs are gitignored.

### `replay-business-outcome.json`

Lookup with member `99999` → status `business_outcome`, code `MEM_NOT_FOUND`.

**Important:** `MEM_NOT_FOUND` is a **business_outcome** (capability-correct, exit 0) — **not** a `hard_failure`. Keeper path for domain-not-found.

### `demo-proof/`

QA screenshots, short webms, and `MANIFEST.json` against the local mock (lookup success, MEM_NOT_FOUND UI, open-account wizard). Complements the JSON keepers; not a substitute for live LLM discovery evidence.

### `hitl-proof/`

File-handshake HITL proof pack from `scripts/hitl-proof.mjs` (intervention request/resume, pause log, fail-closed, operator notes). Freeze keeper; allowed to commit via `.gitignore`.

Default `HITL_MODE=manual` is **fail-closed**: without a `waitForOperator` callback, escalation throws (`HitlBlockedError`) — no silent auto-resume. Covered by `tests/unit/hitl.test.ts`. Set `HITL_MODE=mock` only for demos/tests. Live headed attach UX is a documented cut (see REPORT.md).

## Ignored mass runs

- `evidence/replay-*/` — per-run JSONL / failure screenshots (**gitignored**)
- `evidence/discover-live-*/` — live LLM discovery runs (**gitignored**; recreate with key/OmniRoute)

Delete local mass `replay-*` / `discover-live-*` dirs when trimming the tree. Keepers above stay tracked.


## Pre-commit redaction gate (Data Expert)

Before promoting or committing any discover evidence:

1. Live run must land under `discover-live-*` with `metadata.synthetic: false`.
2. Run `bun run evidence:clean-check` (or pass a specific dir).
3. Gate refuses API keys, JWTs, PANs, emails, password assignments, and env key leaks in `artifact.json` / `*.jsonl` / `*.txt`.
4. Identity params (`memberId`, account/customer/bank fields) are redacted at rest in logs/LLM payloads via `SENSITIVE_KEY_RE`.

`discover-live-*` stays gitignored unless Assessment explicitly promotes a scrubbed keeper.
