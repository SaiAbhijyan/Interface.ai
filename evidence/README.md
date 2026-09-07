# Evidence

## Curated keepers (committed)
- `replay-success.json` — deterministic lookup success (member 10001) → status `success`
- `replay-business-outcome.json` — MEM_NOT_FOUND (member 99999) → status `business_outcome` (not hard_failure)
- `discover-synthetic-302f56/` — one labeled synthetic discovery run (see SYNTHETIC_LABEL.txt)

## Ignored mass runs
Per-run JSONL/screenshot dirs under `evidence/replay-*/` are **gitignored** (see root `.gitignore`).
Do not commit mass replay spam; delete local `replay-*` dirs when trimming the tree.
