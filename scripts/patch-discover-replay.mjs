import { readFileSync, writeFileSync } from "fs";

// --- discover.ts ---
let d = readFileSync("src/agent/discover.ts", "utf8");
d = d.replace(
  `import {
  assertHostAllowed,
  assertIrreversibleAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";
import { gateAction, sanitizeToolArgs } from "../guardrails/action-gate.js";`,
  `import {
  assertUrlAllowed,
  assertIrreversibleAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";
import { gateAction, sanitizeToolArgs, resolveIrreversible } from "../guardrails/action-gate.js";`,
);
d = d.replace(
  `assertHostAllowed(opts.entryUrl, allowlist);`,
  `assertUrlAllowed(opts.entryUrl, allowlist);`,
);
// Remove /confirm/i heuristics — use resolveIrreversible / explicit policy
d = d.replace(
  `case "click": {
            const loc = locFromArgs(args);
            const irrev = /confirm/i.test(loc.value);
            gateAction({ action: "click", locator: loc, irreversible: irrev }, allowlist, {
              confirmIrreversible: opts.confirmIrreversible,
            });
            await opts.driver.click(toDriver(loc));
            recorded.push({
              action: "click",
              description: \`Click \${loc.role ?? ""} \${loc.value}\`.trim(),
              locator: loc,
              irreversible: /confirm/i.test(loc.value),
            });`,
  `case "click": {
            const loc = locFromArgs(args);
            const irrev = resolveIrreversible({ action: "click", locator: loc });
            gateAction({ action: "click", locator: loc, irreversible: irrev }, allowlist, {
              confirmIrreversible: opts.confirmIrreversible,
            });
            await opts.driver.click(toDriver(loc));
            recorded.push({
              action: "click",
              description: \`Click \${loc.role ?? ""} \${loc.value}\`.trim(),
              locator: loc,
              irreversible: irrev,
            });`,
);
d = d.replace(
  `  // Mark confirm clicks irreversible
  for (const s of steps) {
    if (
      s.action === "click" &&
      s.locator &&
      /confirm/i.test(s.locator.value)
    ) {
      s.irreversible = true;
      try {
        assertIrreversibleAllowed(true, opts.confirmIrreversible === true);
      } catch (e) {
        logger.warn("discover", "Irreversible confirm seen during discovery", {
          msg: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }`,
  `  // Mark irreversible via explicit control policy (not name heuristics)
  for (const s of steps) {
    if (s.action === "click" && s.locator) {
      const irrev = resolveIrreversible({ action: "click", locator: s.locator, irreversible: s.irreversible });
      if (irrev) {
        s.irreversible = true;
        try {
          assertIrreversibleAllowed(true, opts.confirmIrreversible === true);
        } catch (e) {
          logger.warn("discover", "Irreversible control seen during discovery", {
            msg: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }`,
);
d = d.replace(
  `allowedHosts: allowlist.allowedHosts,`,
  `allowedOrigins: allowlist.allowedOrigins,`,
);
writeFileSync("src/agent/discover.ts", d);
console.log("discover patched", d.includes("/confirm/i") ? "STILL HAS HEURISTIC" : "heuristic removed");

// --- replay ---
let r = readFileSync("src/replay/executor.ts", "utf8");
r = r.replace(
  `import {
  assertHostAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";`,
  `import {
  assertUrlAllowed,
  loadAllowlistFromEnv,
  PolicyViolation,
} from "../guardrails/allowlist.js";`,
);
r = r.replace(
  `assertHostAllowed(artifact.target.entryUrl, allowlist);`,
  `assertUrlAllowed(artifact.target.entryUrl, allowlist);`,
);
writeFileSync("src/replay/executor.ts", r);
console.log("replay patched");

// --- schema safety ---
let s = readFileSync("src/artifact/schema.ts", "utf8");
s = s.replace(
  `allowedHosts: z.array(z.string()),`,
  `allowedOrigins: z.array(z.string()),`,
);
writeFileSync("src/artifact/schema.ts", s);
console.log("schema patched");

// --- fixtures ---
let f = readFileSync("src/artifact/fixtures.ts", "utf8");
f = f.replaceAll(
  `allowedHosts: ["127.0.0.1", "localhost"],`,
  `allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],`,
);
writeFileSync("src/artifact/fixtures.ts", f);
console.log("fixtures patched");
