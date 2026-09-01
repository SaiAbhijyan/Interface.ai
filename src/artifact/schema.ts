import { z } from "zod";

/** Locator strategies ordered by robustness preference for legacy UIs. */
export const LocatorStrategySchema = z.enum([
  "role_name", // accessibility role + accessible name
  "label", // associated label text
  "placeholder",
  "text", // visible text / getByText
  "css", // last-resort CSS (no test ids expected)
  "frame_role_name", // same as role_name but scoped to a named/titled frame
]);

export type LocatorStrategy = z.infer<typeof LocatorStrategySchema>;

export const LocatorSchema = z.object({
  strategy: LocatorStrategySchema,
  /** Primary locator value (role name, label text, CSS, etc.) */
  value: z.string(),
  /** For role_name: the ARIA role (button, textbox, …) */
  role: z.string().optional(),
  /** Frame title/name when the control lives inside an iframe/frame */
  frame: z.string().optional(),
  /** Ordered fallbacks if the primary locator misses */
  alternatives: z
    .array(
      z.object({
        strategy: LocatorStrategySchema,
        value: z.string(),
        role: z.string().optional(),
        frame: z.string().optional(),
      }),
    )
    .default([]),
  /** Why this locator was chosen — reviewable by humans */
  reasoning: z.string().optional(),
});

export type Locator = z.infer<typeof LocatorSchema>;

export const ParamDefSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string(),
  required: z.boolean().default(true),
  /** Fail-closed: values redacted from logs/artifacts unless explicitly marked false */
  sensitive: z.boolean().default(true),
});

export const OutputDefSchema = z.object({
  name: z.string(),
  type: z.enum(["string", "number", "boolean"]),
  description: z.string(),
  /** How to extract this output during replay */
  locator: LocatorSchema.optional(),
  /** Regex to capture a subgroup from matched text */
  extractPattern: z.string().optional(),
});

export const ActionTypeSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "press",
  "wait_for",
  "extract",
  "assert",
  "dismiss_if_present",
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export const CheckpointSchema = z.object({
  id: z.string(),
  description: z.string(),
  /** Text or role that must be visible */
  locator: LocatorSchema,
  /** Optional exact/contains text expectation */
  expectText: z.string().optional(),
  /** Map observed text patterns to business outcome codes */
  businessOutcomes: z
    .array(
      z.object({
        pattern: z.string(),
        code: z.string(),
        message: z.string(),
      }),
    )
    .default([]),
});

export const StepSchema = z.object({
  id: z.string(),
  action: ActionTypeSchema,
  description: z.string(),
  locator: LocatorSchema.optional(),
  /** Parameter name whose runtime value is used (e.g. fill memberId) */
  paramRef: z.string().optional(),
  /** Literal value when not parameterized */
  value: z.string().optional(),
  url: z.string().optional(),
  /** Key to press for "press" actions */
  key: z.string().optional(),
  /** Output name for extract steps */
  outputName: z.string().optional(),
  checkpoint: CheckpointSchema.optional(),
  /** Irreversible actions require confirmIrreversible on replay */
  irreversible: z.boolean().default(false),
  /** Known recoverable interstitials to dismiss before this step */
  recoverableHints: z.array(z.string()).default([]),
});

export const CapabilityArtifactSchema = z.object({
  version: z.literal("1.0.0"),
  name: z.string().min(1),
  description: z.string(),
  target: z.object({
    kind: z.enum(["web", "desktop"]).default("web"),
    entryUrl: z.string().url(),
    appId: z.string().default("legacy-bank-mock"),
  }),
  parameters: z.array(ParamDefSchema),
  outputs: z.array(OutputDefSchema),
  steps: z.array(StepSchema).min(1),
  /** Global success checkpoint (in addition to per-step) */
  successCheckpoint: CheckpointSchema,
  locatorStrategyMeta: z.object({
    preferredOrder: z.array(LocatorStrategySchema),
    notes: z.string(),
  }),
  safety: z.object({
    allowedOrigins: z.array(z.string()),
    allowedActions: z.array(ActionTypeSchema),
    requiresConfirmationForIrreversible: z.boolean().default(true),
  }),
  metadata: z.object({
    discoveredAt: z.string(),
    goal: z.string(),
    model: z.string().optional(),
    discoveryEvidencePath: z.string().optional(),
    synthetic: z.boolean().default(false),
  }),
});

export type CapabilityArtifact = z.infer<typeof CapabilityArtifactSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Checkpoint = z.infer<typeof CheckpointSchema>;

/** Replay result contract — explicit taxonomy */
export const ReplayStatusSchema = z.enum([
  "success",
  "business_outcome",
  "recoverable",
  "hard_failure",
]);

export type ReplayStatus = z.infer<typeof ReplayStatusSchema>;

export const ReplayResultSchema = z.object({
  status: ReplayStatusSchema,
  outputs: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  businessOutcome: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  error: z
    .object({
      stepId: z.string(),
      expected: z.string(),
      observed: z.string(),
      taxonomy: z.enum([
        "element_not_found",
        "checkpoint_mismatch",
        "timeout",
        "policy_violation",
        "irreversible_blocked",
        "navigation_error",
        "unknown",
      ]),
    })
    .optional(),
  evidence: z.object({
    logPath: z.string(),
    screenshotPath: z.string().optional(),
  }),
  durationMs: z.number(),
});

export type ReplayResult = z.infer<typeof ReplayResultSchema>;
