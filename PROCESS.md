# Process — step-by-step

## Problem framing

Working vertical slice: discover once, artifact as capability contract, deterministic replay with error taxonomy on a hostile legacy bank UI.

## Mock bank surface

Table layout, results iframe, no test ids. Lookup and open-sub-account flows. Business outcomes for not-found/validation. XSS fixed via textContent.

## Discovery design

Tool-calling loop with sanitizeToolArgs + gateAction. Redacted observe. Synthetic fallback when no model key.

## Artifact schema choices

Versioned typed params/outputs, locator fallbacks, checkpoints, safety origins.

## Replay and error taxonomy

Gated execution; tests for success, MEM_NOT_FOUND, irreversible block, allowlist escape.

## HITL

Same Playwright page. Manual fail-closed.

## Safety evolution

Origin port bind, nav interceptor, path on open, irreversible policy (not name heuristics), redaction, data scheme blocking, fill/select gate completeness, frozen allowlist, E2E escape tests.

## Testing and runbook

```bash
npm install
npx playwright install chromium
npm run mock:bank
npm test
npm run discover -- ...
npm run replay -- ...
```

## Merge / push

Parent owns gh auth and push. Do not commit secrets.
