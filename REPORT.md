# REPORT

## Architecture

Single-process TypeScript CLI. Discover runs an observe-decide-act tool loop once and writes a versioned CapabilityArtifact; replay executes that artifact with no LLM decisions. Shared Playwright SurfaceDriver. Guardrails (allowlist, gateAction, redaction) front every driver call. HITL pauses the same live page.

**Capability as callable tool:** the artifact is the agent-facing contract — `name` + typed `parameters`/`outputs` + ordered steps — invoked via `replay --artifact … -p key=value`. Callers never re-enter the LLM; production is tool call → deterministic SurfaceDriver execution (`src/cli/replay.ts`, `src/replay/executor.ts`). Discovery is compile-time only; `--refuse-if-artifact` / `preferReplayOverDiscover` refuse rediscovery once the tool exists.

Design justification: Anthropic computer-use motivates GUI agent loops, but production here compiles to an artifact rather than perpetual online CU (https://www.anthropic.com/news/3-5-models-and-computer-use). OSWorld shows frontier CUAs fail mainly on GUI grounding — discover once, durable selectors (https://arxiv.org/abs/2404.07972). GPA (demo to deterministic local replay) is the closest match to this pipeline (https://arxiv.org/abs/2604.01676). WebArena/Mind2Web (low long-horizon success; grounding hard) justify bounding online act loops — citations in docs/RESEARCH_CITATIONS.md.

## Artifact schema

Zod CapabilityArtifact v1.0.0: parameters (typed, optional sensitive), outputs with extract locators, ordered steps (navigate/click/fill/select/press/wait_for/extract/assert/dismiss_if_present), locator strategies with alternatives (role_name, label, frame_role_name preferred), checkpoints with businessOutcomes, safety.allowedOrigins/Actions, metadata.synthetic. UFO2 supports structured control trees over screenshot-only for replayable selectors (https://arxiv.org/abs/2504.14603).

## Determinism & error handling

Replay substitutes paramRef values, tries locator fallbacks, evaluates checkpoints, and classifies: success | business_outcome | recoverable | hard_failure (element_not_found, checkpoint_mismatch, timeout, policy_violation, irreversible_blocked, navigation_error, unknown). Tool hallucination work (Xu et al., https://arxiv.org/abs/2412.04141) motivates grounding steps to verified controls and abstain/escalate when uncertain — discovery refuses invented tools and stops on consecutive errors.

## Heterogeneity & multi-tenant

SurfaceDriver abstracts web vs desktop (desktop interface-only in this slice). Runtime navigation allowlist is **operator/env-configured** (scheme+host+port, default loopback `:4173`) and enforced in the driver on every open/nav — not yet intersected from `artifact.safety.allowedOrigins` at replay. Artifacts may record intended origins for documentation/fixtures; production isolation today is the shared env allowlist + path prefixes (never bare slash). True per-tenant artifact-driven origin packs are a next cut once replay intersects `artifact.safety` into the driver.

## Escalation & handoff

When stuck (locator miss, consecutive tool errors, irreversible risk, hard_failure with `--hitl-on-failure`), escalateToHuman pauses the **same** Playwright session (pauseForHuman/resume) — operator attaches live, then resume. HITL_MODE defaults to **manual fail-closed** (requires waitForOperator); mock auto-resume only if HITL_MODE=mock is set explicitly. Discovery stop policy prefers escalate / hard stop over inventing recovery tools (Xu et al. tool-hallucination abstain path).

## Safety

Origin allowlist is scheme+host+port (blocks localhost SSRF to other ports). assertUrlAllowed on open/navigate/observe/post-click. page.route + framenavigated interceptor; freezeAllowlist against TOCTOU; data:/blob:/javascript blocked. Irreversible via step flag + IRREVERSIBLE_CONTROL_POLICY ids/roleNames — not confirm-substring heuristics. fill/select require locators. Redaction before LLM observe and JSONL logs. results.html uses textContent/createElement only. See SECURITY.md.


## Evaluation metrics

Discovery success = valid CapabilityArtifact via `done` (or labeled synthetic); not a production win. Replay success = `success` **or** `business_outcome` (domain codes like `MEM_NOT_FOUND` are capability-correct, exit 0) — never fold BO into `hard_failure`. Report rates over fixed packs: capability success, true failure, BO share, policy blocks, median `durationMs`, evidence completeness (JSONL; screenshot on hard_failure). Stability: identical status (+ BO code / outputs) across ≥3 replays on the same artifact+params. Helpers: `src/observability/eval-metrics.ts`. Full contract: docs/EVAL_METRICS.md.

## Cuts

Operator UI mocked; desktop interface-only; labeled synthetic discovery when no model API key (OPENAI absent in this env — evidence under discover-synthetic-*). Next: tenant policy packs, headed HITL attach UX, OCR scrub for screenshot PII.

Citations also listed in docs/RESEARCH_CITATIONS.md.
