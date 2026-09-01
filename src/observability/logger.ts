import fs from "node:fs";
import path from "node:path";
import { redactObject, redactText } from "../guardrails/redaction.js";

export type LogEvent = {
  ts: string;
  level: "info" | "warn" | "error" | "debug";
  runId: string;
  phase: "discover" | "replay" | "hitl" | "system";
  message: string;
  data?: Record<string, unknown>;
};

export class RunLogger {
  readonly runId: string;
  readonly logPath: string;
  readonly dir: string;
  private stream: fs.WriteStream;

  constructor(opts: { runId: string; dir: string }) {
    this.runId = opts.runId;
    this.dir = opts.dir;
    fs.mkdirSync(opts.dir, { recursive: true });
    this.logPath = path.join(opts.dir, `run-${opts.runId}.jsonl`);
    this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
  }

  private write(event: LogEvent): void {
    const safe: LogEvent = {
      ...event,
      message: redactText(event.message),
      data: event.data ? (redactObject(event.data) as Record<string, unknown>) : undefined,
    };
    this.stream.write(JSON.stringify(safe) + "\n");
    const line = `[${safe.level}] ${safe.phase} ${safe.message}`;
    if (safe.level === "error") console.error(line);
    else console.log(line);
  }

  info(phase: LogEvent["phase"], message: string, data?: Record<string, unknown>): void {
    this.write({ ts: new Date().toISOString(), level: "info", runId: this.runId, phase, message, data });
  }

  warn(phase: LogEvent["phase"], message: string, data?: Record<string, unknown>): void {
    this.write({ ts: new Date().toISOString(), level: "warn", runId: this.runId, phase, message, data });
  }

  error(phase: LogEvent["phase"], message: string, data?: Record<string, unknown>): void {
    this.write({ ts: new Date().toISOString(), level: "error", runId: this.runId, phase, message, data });
  }

  debug(phase: LogEvent["phase"], message: string, data?: Record<string, unknown>): void {
    this.write({ ts: new Date().toISOString(), level: "debug", runId: this.runId, phase, message, data });
  }

  async close(): Promise<void> {
    await new Promise<void>((resolve) => this.stream.end(resolve));
  }
}
