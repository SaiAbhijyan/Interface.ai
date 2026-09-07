# Evaluation metrics — discovery vs replay

Defines how we label runs and what counts as success in evidence. Encoded in `src/observability/eval-metrics.ts` and `tests/unit/eval-metrics.test.ts`.

## Status taxonomy (replay)

| Status | Meaning | Exit | Counts as |
|--------|---------|------|-----------|
| `success` | Goal completed; outputs extracted; success checkpoint met | 0 | **capability success** |
| `business_outcome` | App returned an expected domain result (e.g. `MEM_NOT_FOUND`) matched via checkpoint patterns | 0 | **capability success** (valid tool result, not a system failure) |
| `recoverable` | Transient interstitial dismissed or retryable UI state (schema-ready; rarely emitted today) | 0 | soft success / continue |
| `hard_failure` | Locator miss, checkpoint mismatch, timeout, policy, irreversible block, nav error | 2 | **system failure** |

**Rule:** never fold `business_outcome` into `hard_failure`. A correct “member not found” is product behavior. Mislabeling it as failure inflates failure rate and hides grounding bugs.

Hard-failure taxonomy codes: `element_not_found` | `checkpoint_mismatch` | `timeout` | `policy_violation` | `irreversible_blocked` | `navigation_error` | `unknown`.

## Discovery success (compile-time)

Discovery succeeds only when all of:

1. Loop exits via `done` (not max_steps / consecutive errors / no-tool-calls stop).
2. Artifact parses as CapabilityArtifact v1.0.0.
3. Artifact includes ≥1 step, typed params/outputs, successCheckpoint, and safety allowlists.
4. Params marked sensitive by default; observe/logs redacted before LLM.

### discover-live vs discover-synthetic (evidence dirs)

| Kind | Dir pattern | `metadata.synthetic` | Counts toward PDF “live discover” evidence? |
|------|-------------|----------------------|-----------------------------------------------|
| **discover-live** | `evidence/discover-live-<runId>/` | `false` | **Yes** — required once OmniRoute key is up |
| **discover-synthetic** | `evidence/discover-synthetic-*` + `SYNTHETIC_LABEL.txt` | `true` | **No** — labeled fixture only; insufficient alone per brief |

Live discovery success additionally requires:

- Run via `createOpenAIClient` (`OPENAI_API_KEY` + optional `OPENAI_BASE_URL`), **without** `--synthetic-fallback`.
- Evidence dir name `discover-live-*` (not the `_PLACEHOLDER` stub).
- Artifact `metadata.synthetic === false`, JSONL present, params/observe redacted (Data Expert gate).
- Same structural checks as above (`done` → Zod artifact).

`evidence/discover-live-_PLACEHOLDER/` is a stub only — delete before commit once a real live run lands.

Discovery **does not** count as production capability success. Prefer `--refuse-if-artifact` / replay once an artifact exists. Replay metrics below are the production bar; live discover only proves the compile path.

## Replay success (production)

Primary metrics on evidence under `evidence/replay-*` + summary JSON:

| Metric | Definition |
|--------|------------|
| **Replay success rate** | `(success + business_outcome) / N` over fixed param packs |
| **True failure rate** | `hard_failure / N` |
| **Business outcome rate** | `business_outcome / N` (expected for negative member packs) |
| **Policy block rate** | hard_failures with `policy_violation` or `irreversible_blocked` |
| **Median durationMs** | latency stability across identical packs |
| **Evidence completeness** | each run has JSONL `logPath`; hard_failure preferably has `screenshotPath` |

Canonical packs in-repo:

- success: `memberId=10001` → `evidence/replay-success.json`
- business_outcome: `memberId=99999` → `MEM_NOT_FOUND` → `evidence/replay-business-outcome.json`
- hard_failure: allowlist escape / irreversible without confirm (integration tests)

## Stability across runs

For the same artifact + params + mock surface:

1. Status must be identical across ≥3 consecutive replays (byte-stable classification).
2. Outputs for `success` must match (redacted form).
3. `businessOutcome.code` must be stable when status is `business_outcome`.
4. Duration may vary; flag only if p95 >> 3× median on same machine (smoke signal, not a gate).

Instability ⇒ locator fragility or non-determinism in the surface — treat as hard_failure investigation, not “flaky success.”

## What we do *not* measure as success

- Discovery completing after inventing off-policy tools (policy must reject).
- Replay that reaches the page but mislabels domain errors as `hard_failure`.
- Any run whose logs/LLM payloads contain unredacted secrets/PII (Data Expert / Security gate) — evidence is invalid regardless of status.
