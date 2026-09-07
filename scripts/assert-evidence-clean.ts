#!/usr/bin/env tsx
/**
 * Data Expert pre-commit gate: refuse evidence dirs with raw keys/PII.
 * Usage: bunx tsx scripts/assert-evidence-clean.ts [evidenceDir...]
 * Default: every evidence/discover-* and evidence/discover-live-* dir present.
 */
import fs from "node:fs";
import path from "node:path";
import { assertNoSecretsInEvidenceDir } from "../src/guardrails/redaction.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const evidenceRoot = path.join(root, "evidence");

function listDefaultDirs(): string[] {
  if (!fs.existsSync(evidenceRoot)) return [];
  return fs
    .readdirSync(evidenceRoot)
    .filter((d) => /^(discover-|discover-live-)/.test(d))
    .map((d) => path.join(evidenceRoot, d))
    .filter((p) => fs.statSync(p).isDirectory());
}

const targets = process.argv.slice(2).length
  ? process.argv.slice(2).map((p) => path.resolve(p))
  : listDefaultDirs();

if (targets.length === 0) {
  console.log("No discover evidence dirs to scan.");
  process.exit(0);
}

let failed = 0;
for (const dir of targets) {
  try {
    assertNoSecretsInEvidenceDir(dir);
    console.log(`CLEAN ${path.relative(root, dir)}`);
  } catch (e) {
    failed += 1;
    console.error(`DIRTY ${path.relative(root, dir)}: ${e instanceof Error ? e.message : e}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
