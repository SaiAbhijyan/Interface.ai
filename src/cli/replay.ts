#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { CapabilityArtifactSchema } from "../artifact/schema.js";
import { PlaywrightSurfaceDriver } from "../surface/playwright-driver.js";
import { replayCapability } from "../replay/executor.js";

const program = new Command();

program
  .name("replay")
  .description("Deterministic replay of a CapabilityArtifact (no LLM decisions)")
  .requiredOption("-a, --artifact <path>", "Path to artifact JSON")
  .option("-p, --param <keyValue...>", "Params as key=value", [])
  .option("--evidence-dir <dir>", "Evidence output directory", "evidence")
  .option("--confirm-irreversible", "Allow irreversible steps", false)
  .option("--hitl-on-failure", "Escalate to HITL on hard failure", false)
  .option("--headed", "Run headed browser", false)
  .action(async (opts) => {
    const params: Record<string, string | number | boolean> = {};
    for (const kv of opts.param as string[]) {
      const i = kv.indexOf("=");
      if (i === -1) throw new Error(`Bad --param ${kv}; expected key=value`);
      params[kv.slice(0, i)] = kv.slice(i + 1);
    }

    const raw = JSON.parse(fs.readFileSync(path.resolve(opts.artifact), "utf8"));
    const artifact = CapabilityArtifactSchema.parse(raw);
    const driver = new PlaywrightSurfaceDriver({ headless: !opts.headed });

    const result = await replayCapability({
      artifact,
      params,
      driver,
      evidenceDir: path.resolve(opts.evidenceDir),
      confirmIrreversible: opts.confirmIrreversible,
      hitlOnHardFailure: opts.hitlOnFailure,
    });

    console.log(JSON.stringify(result, null, 2));
    if (result.status === "hard_failure") process.exit(2);
    if (result.status === "business_outcome") process.exit(0);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
