# REPORT

## Architecture

Single-process TypeScript CLI. Discover runs an observe-decide-act tool loop once and writes a versioned CapabilityArtifact; replay executes that artifact with no LLM decisions. Shared Playwright SurfaceDriver. Guardrails (allowlist, gateAction, redaction) front every driver call. HITL pauses the same live page.

Design justification: Anthropic computer-use motivates GUI agent loops, but production here compiles to an artifact rather than perpetual online CU (https://www.anthropic.com/news/3-5-models-and-computer-use). OSWorld shows frontier CUAs fail mainly on GUI grounding — discover once, durable selectors (https://arxiv.org/abs/2404.07972). GPA (demo to deterministic local replay) is the closest match to this pipeline (https://arxiv.org/abs/2604.01676).

## Artifact schema

Zod CapabilityArtifact v1.0.0: parameters (typed, optional sensitive), outputs with extract locators, ordered steps (navigate/click/fill/select/press/wait_for/extract/assert/dismiss_if_present), locator strategies with alternatives (role_name, label, frame_role_name preferred), checkpoints with businessOutcomes, safety.allowedOrigins/Actions, metadata.synthetic. UFO2 supports structured control trees over screenshot-only for replayable selectors (https://arxiv.org/abs/2504.14603).

## Determinism & error handling

Replay substitutes paramRef values, tries locator fallbacks, evaluates checkpoints, and classifies: success | business_outcome | recoverable | hard_failure (element_not_found, checkpoint_mismatch, timeout, policy_violation, irreversible_blocked, navigation_error, unknown). Tool hallucination work (Xu et al., https://arxiv.org/abs/2509.00083) motivates grounding steps to verified controls and abstain/escalate when uncertain — discovery refuses invented tools and stops on consecutive errors.

## Heterogeneity & multi-tenant

SurfaceDriver abstracts web vs desktop (desktop interface-only in this slice). Per-tenant allowedOrigins/allowedPaths and specialized artifacts avoid rewriting the executor. Path prefixes never allow bare slash.

## Escalation & handoff

escalateToHuman pauses the same Playwright session (pauseForHuman/resume). HITL_MODE=mock auto-resolves for demos; HITL_MODE=manual is fail-closed and requires waitForOperator. Discovery stop policy prefers escalate over inventing recovery tools.

## Safety

Origin allowlist is scheme+host+port (blocks localhost SSRF to other ports). assertUrlAllowed on open/navigate/observe/post-click. page.route + framenavigated interceptor; freezeAllowlist against TOCTOU; data:/blob:/javascript blocked. Irreversible via step flag + IRREVERSIBLE_CONTROL_POLICY ids/roleNames — not confirm-substring heuristics. fill/select require locators. Redaction before LLM observe and JSONL logs. results.html uses textContent/createElement only. See SECURITY.md.

## Cuts

Operator UI mocked; desktop interface-only; labeled synthetic discovery when no model API key (OPENAI absent in this env — evidence under discover-synthetic-*). Next: tenant policy packs, headed HITL attach UX, OCR scrub for screenshot PII.

Citations also listed in docs/RESEARCH_CITATIONS.md.
