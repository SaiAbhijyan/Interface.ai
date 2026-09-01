
## What this is

| Mode | LLM? | Purpose |
|------|------|---------|
| Discover | Yes (or labeled synthetic fallback) | Observe, decide, act once; compile a reviewable CapabilityArtifact |
| Replay | No | Execute the artifact deterministically with checkpoints, business outcomes, and policy gates |

Production preference: once an artifact exists, always replay. Do not re-enter the LLM loop (use --refuse-if-artifact).
