import path from "node:path";
import { PolicyViolation } from "./allowlist.js";

/**
 * Sanitize artifact.name (or any user/model-influenced name) for filesystem writes.
 * Rejects path separators, .., empty, and absolute paths.
 */
export function safeArtifactBaseName(name: string): string {
  const raw = String(name ?? "").trim();
  if (!raw) throw new PolicyViolation("Artifact name is empty");
  // Strip any directory components — basename alone is not enough if name is "../x"
  if (raw.includes("\0") || /[\\/]/.test(raw) || raw.includes("..")) {
    throw new PolicyViolation('Unsafe artifact name (path characters): "' + raw + '"');
  }
  const base = path.basename(raw);
  if (!base || base === "." || base === "..") {
    throw new PolicyViolation('Unsafe artifact name: "' + raw + '"');
  }
  // Allow only conservative charset for the file stem
  const safe = base.replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!safe || safe === "." || safe === "..") {
    throw new PolicyViolation('Artifact name sanitized to empty/unsafe: "' + raw + '"');
  }
  return safe;
}

export function artifactJsonFileName(name: string): string {
  const safe = safeArtifactBaseName(name);
  return safe.endsWith(".json") ? safe : safe + ".json";
}
