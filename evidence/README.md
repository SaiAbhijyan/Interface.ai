# Evidence

## Discovery
Live LLM discovery was **not** run: OPENAI_API_KEY was missing in this environment.
Synthetic labeled discovery evidence is under the discover-synthetic-* directory (see SYNTHETIC_LABEL.txt).
The mock UI was observed live during synthetic discover.

## Replay
- replay-success.json — deterministic lookup success (member 10001) → status `success`
- replay-business-outcome.json — MEM_NOT_FOUND (member 99999) → status `business_outcome` (not hard_failure)
- Per-run JSONL logs under replay-*/

## Metrics
See docs/EVAL_METRICS.md — capability success = success ∪ business_outcome; hard_failure is system failure only.
