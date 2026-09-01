#!/usr/bin/env node
import "dotenv/config";
import path from "node:path";
import { Command } from "commander";
import { PlaywrightSurfaceDriver } from "../surface/playwright-driver.js";
import { discoverCapability } from "../agent/discover.js";

const program = new Command();

program
  .name("discover")
  .description("LLM-driven observe/decide/act → CapabilityArtifact")
  .requiredOption("-g, --goal <goal>", "Natural language goal")
  .option(
    "-u, --url <url>",
    "Target entry URL",
    process.env.BANK_MOCK_URL ?? "http://127.0.0.1:4173",
  )
  .option("-p, --param <keyValue...>", "Params as key=value", [])
  .option("--evidence-dir <dir>", "Evidence output directory", "evidence")
  .option("--confirm-irreversible", "Allow irreversible actions during discovery", false)
  .option(
    "--synthetic-fallback",
    "If OPENAI_API_KEY missing, emit labeled synthetic artifact",
    false,
  )
  .option("--headed", "Run headed browser", false)
  .option(
    "--refuse-if-artifact <path>",
    "If artifact JSON already exists, refuse rediscovery (prefer deterministic replay)",
  )
  .action(async (opts) => {
    const params: Record<string, string> = {};
    for (const kv of opts.param as string[]) {
      const i = kv.indexOf("=");
      if (i === -1) throw new Error(`Bad --param ${kv}; expected key=value`);
      params[kv.slice(0, i)] = kv.slice(i + 1);
    }

    const driver = new PlaywrightSurfaceDriver({ headless: !opts.headed });
    const result = await discoverCapability({
      goal: opts.goal,
      entryUrl: opts.url,
      params,
      driver,
      evidenceDir: path.resolve(opts.evidenceDir),
      confirmIrreversible: opts.confirmIrreversible,
      allowSyntheticFallback: opts.syntheticFallback,
      refuseIfArtifactExists: opts.refuseIfArtifact,
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          synthetic: result.synthetic,
          artifactName: result.artifact.name,
          evidenceDir: result.evidenceDir,
          logPath: result.logPath,
        },
        null,
        2,
      ),
    );
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
