/**
 * File-based waitForOperator for demos and scripted HITL proofs.
 *
 * Handshake:
 * 1. Writes InterventionRequest + attachInstructions under proofDir
 * 2. Polls for a resume signal file (default: hitl-resume.json with { operatorNotes })
 * 3. Optional shortcut: HITL_AUTO_NOTES + explicit resumeFile path (proof scripts only)
 *
 * Never auto-resumes from env alone without an explicit resume/operator file path
 * (keeps production fail-closed unless the CLI opted into file wait).
 */

import fs from "node:fs";
import path from "node:path";
import type { HumanSessionHandle } from "../surface/types.js";
import type { InterventionRequest } from "./handoff.js";

export type FileWaitForOperatorOptions = {
  /** Directory for intervention + attach evidence (default: evidence/hitl-proof) */
  proofDir?: string;
  /**
   * Resume signal path. Explicit path also unlocks HITL_AUTO_NOTES shortcut.
   * Default: <proofDir>/hitl-resume.json
   */
  resumeFile?: string;
  /** Alias accepted by CLI (--hitl-operator-file) */
  operatorFile?: string;
  pollMs?: number;
  timeoutMs?: number;
  /** Optional logger (CLI RunLogger or console-compatible) */
  log?: (message: string, data?: Record<string, unknown>) => void;
};

export type ResumeSignal = {
  operatorNotes: string;
  resumedAt?: string;
  sessionId?: string;
};

const DEFAULT_PROOF_DIR = path.join("evidence", "hitl-proof");

function resolvePaths(opts: FileWaitForOperatorOptions): {
  proofDir: string;
  resumeFile: string;
  resumeExplicit: boolean;
} {
  const proofDir = path.resolve(opts.proofDir ?? DEFAULT_PROOF_DIR);
  const explicit = opts.resumeFile ?? opts.operatorFile;
  const resumeFile = path.resolve(explicit ?? path.join(proofDir, "hitl-resume.json"));
  return { proofDir, resumeFile, resumeExplicit: explicit != null && String(explicit).trim() !== "" };
}

function readResumeNotes(resumeFile: string): string | null {
  if (!fs.existsSync(resumeFile)) return null;
  const raw = fs.readFileSync(resumeFile, "utf8").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ResumeSignal;
    if (parsed && typeof parsed.operatorNotes === "string" && parsed.operatorNotes.trim()) {
      return parsed.operatorNotes.trim();
    }
  } catch {
    // plain-text notes file is also accepted
  }
  return raw;
}

/**
 * Write intervention evidence pack files (request + attach instructions).
 */
export function writeInterventionEvidence(
  proofDir: string,
  handle: HumanSessionHandle,
  request: InterventionRequest,
): { requestPath: string; attachPath: string; pauseLogPath: string } {
  fs.mkdirSync(proofDir, { recursive: true });
  const requestPath = path.join(proofDir, "intervention-request.json");
  const attachPath = path.join(proofDir, "attach-instructions.txt");
  const pauseLogPath = path.join(proofDir, "pause-log.txt");

  const payload = {
    ...request,
    sessionId: handle.sessionId,
    attachInstructions: handle.attachInstructions,
    pausedAt: new Date().toISOString(),
  };
  fs.writeFileSync(requestPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
  fs.writeFileSync(attachPath, handle.attachInstructions + "\n", "utf8");
  const pauseLine =
    `[${payload.pausedAt}] HITL pause sessionId=${handle.sessionId} reason=${request.reason}\n` +
    `attach: ${handle.attachInstructions}\n` +
    `waiting for resume file…\n`;
  fs.appendFileSync(pauseLogPath, pauseLine, "utf8");
  return { requestPath, attachPath, pauseLogPath };
}

/**
 * Write operator resume notes (for proof scripts / operators).
 */
export function writeResumeSignal(
  resumeFile: string,
  notes: string,
  extra?: Partial<ResumeSignal>,
): void {
  fs.mkdirSync(path.dirname(resumeFile), { recursive: true });
  const body: ResumeSignal = {
    operatorNotes: notes,
    resumedAt: new Date().toISOString(),
    ...extra,
  };
  fs.writeFileSync(resumeFile, JSON.stringify(body, null, 2) + "\n", "utf8");
}

/**
 * Build a waitForOperator callback suitable for escalateToHuman.
 */
export function createFileWaitForOperator(
  opts: FileWaitForOperatorOptions = {},
): (handle: HumanSessionHandle, req: InterventionRequest) => Promise<string> {
  const { proofDir, resumeFile, resumeExplicit } = resolvePaths(opts);
  const pollMs = opts.pollMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const log =
    opts.log ??
    ((message: string, data?: Record<string, unknown>) => {
      console.log(`[hitl-wait] ${message}`, data ?? "");
    });

  return async (handle, request) => {
    // Clear stale resume from a prior run so we do not instantly resume
    if (fs.existsSync(resumeFile)) {
      try {
        fs.unlinkSync(resumeFile);
      } catch {
        /* ignore */
      }
    }

    const paths = writeInterventionEvidence(proofDir, handle, request);
    log("Wrote intervention evidence; waiting for operator resume file", {
      proofDir,
      resumeFile,
      requestPath: paths.requestPath,
      sessionId: handle.sessionId,
    });

    const autoNotes = process.env.HITL_AUTO_NOTES?.trim();
    if (autoNotes && resumeExplicit) {
      // Proof-script shortcut: only when an explicit resume/operator file path was opted in
      writeResumeSignal(resumeFile, autoNotes, { sessionId: handle.sessionId });
      fs.appendFileSync(
        paths.pauseLogPath,
        `[${new Date().toISOString()}] HITL_AUTO_NOTES shortcut → wrote ${resumeFile}\n`,
        "utf8",
      );
      log("HITL_AUTO_NOTES + explicit resume file — auto-wrote resume signal", {
        resumeFile,
      });
      return autoNotes;
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const notes = readResumeNotes(resumeFile);
      if (notes) {
        fs.appendFileSync(
          paths.pauseLogPath,
          `[${new Date().toISOString()}] Resume signal received: ${notes.slice(0, 200)}\n`,
          "utf8",
        );
        const notesPath = path.join(proofDir, "operator-notes.txt");
        fs.writeFileSync(notesPath, notes + "\n", "utf8");
        log("Operator resume signal accepted", { resumeFile, notes });
        return notes;
      }
      await new Promise((r) => setTimeout(r, pollMs));
    }

    throw new Error(
      `HITL waitForOperator timed out after ${timeoutMs}ms waiting for resume file: ${resumeFile}`,
    );
  };
}
