# Research citations (design justification)

Use in REPORT.md Architecture / Artifact schema / Determinism / Agent-loop sections.

## Core thesis: discover once with an LLM, then deterministic replay

Online computer-use agents are powerful for *discovery* but non-deterministic and expensive for production. This repo compiles a successful discovery trajectory into a typed **CapabilityArtifact**, then executes it with **no LLM decisions** (`src/replay/executor.ts`). Prefer replay once an artifact exists (`src/agent/loop-policy.ts` → `preferReplayOverDiscover` / `--refuse-if-artifact`).

## Citations

### LLM agent loop (observe → decide → act)

- **ReAct: Synergizing Reasoning and Acting in Language Models** (Yao et al., ICLR 2023) — Interleaved reasoning + tool actions; canonical observe/act loop for discovery.
  - https://arxiv.org/abs/2210.03629

- **Introducing computer use / Developing a computer use model** (Anthropic, 2024) — LLM→GUI agent loop (observe + act); motivates compile-to-artifact for production instead of perpetual online CU.
  - https://www.anthropic.com/news/3-5-models-and-computer-use
  - https://www.anthropic.com/news/developing-computer-use

### Why perpetual online CU fails for production reliability

- **OSWorld** (Xie et al., NeurIPS 2024) — Frontier CUAs fail mainly on GUI grounding; supports LLM discovers once → durable CapabilityArtifact.
  - https://arxiv.org/abs/2404.07972

- **WebArena** (Zhou et al., ICLR 2024) — Realistic long-horizon web agents; GPT-4-class success far below humans (~14% vs ~78%), arguing against unbounded online act loops in production.
  - https://arxiv.org/abs/2307.13854
  - https://webarena.dev/

- **Mind2Web** (Deng et al., NeurIPS 2023) — Generalist web agents on real sites; element selection / grounding remains hard — favors recording verified steps over rediscovering every run.
  - https://arxiv.org/abs/2306.06070

### Discovery → durable artifact → deterministic replay

- **GPA: Learning GUI Process Automation from Demonstrations** (Zhao et al. / Salesforce AI Research, 2026) — Demo → deterministic local replay (RPA-style); closest match to discovery → artifact → replay; argues VLM/CU agents are non-deterministic for mission-critical workflows.
  - https://arxiv.org/abs/2604.01676
  - https://www.salesforce.com/blog/gpa-gui-process-automation/

- **UFO2: The Desktop AgentOS** (Zhang et al. / Microsoft, 2025) — Hybrid UIA/a11y + vision; structured control trees beat screenshot-only for replayable selectors.
  - https://arxiv.org/abs/2504.14603

### Tool / action hallucination and stop / escalate

- **Reducing Tool Hallucination via Reliability Alignment** (Xu et al., 2024) — Tool *selection* and *usage* hallucination; justifies closed tool schemas, hard allowlists, and abstain/escalate (indecisive actions) when uncertain — mapped to `assertKnownDiscoveryTool`, closed OpenAI tool schemas (`additionalProperties: false`), and `evaluateDiscoveryStop` in `src/agent/loop-policy.ts`.
  - https://arxiv.org/abs/2412.04141
  - https://github.com/X-LANCE/ToolHallucination

- **The Reasoning Trap: How Enhancing LLM Reasoning Amplifies Tool Hallucination** (2025) — Stronger “think then act” can *increase* invented tool calls; further reason to bound discovery with stop conditions and prefer replay in production.
  - https://arxiv.org/abs/2510.22977

### Locator / grounding strategy (accessibility-first)

- **Playwright locators & best practices** — Prefer user-facing contracts (`getByRole`, label, text) over CSS/XPath; matches our locator strategy order (`role_name` → `label` → `frame_role_name` → `text` → …) and rejection of invented strategies (e.g. xpath) in loop-policy.
  - https://playwright.dev/docs/locators
  - https://playwright.dev/docs/best-practices

## Codebase mapping (freeze)

| Design claim | Implementation |
| --- | --- |
| Closed tool surface; no invented UI actions | `src/agent/tools.ts`, `assertKnownDiscoveryTool` |
| Arg / strategy schema hygiene | `validateDiscoveryToolArgs` |
| Stop instead of inventing recovery | `evaluateDiscoveryStop` (consecutive errors / no-tool-calls / max_steps) |
| Prefer deterministic replay once artifact exists | `preferReplayOverDiscover`, discover `--refuse-if-artifact` |
| Production path has no LLM decide | `src/cli/replay.ts`, `src/replay/executor.ts` |

## Citation hygiene note

Verified arXiv IDs against abs pages at freeze. Do **not** cite `2509.00083` for tool hallucination — that ID is unrelated (GenDataCarto / memorization). Correct tool-hallucination paper is `2412.04141`.
