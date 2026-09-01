import { CapabilityArtifactSchema, type CapabilityArtifact } from "./schema.js";

/** Hand-authored artifact matching a successful member-lookup → savings balance flow. */
export function buildLookupSavingsArtifact(entryUrl: string): CapabilityArtifact {
  return CapabilityArtifactSchema.parse({
    version: "1.0.0",
    name: "lookup_member_savings_balance",
    description:
      "Look up a member by Member ID on the legacy CoreBank console and return their savings balance from the results iframe.",
    target: {
      kind: "web",
      entryUrl,
      appId: "legacy-bank-mock",
    },
    parameters: [
      {
        name: "memberId",
        type: "string",
        description: "Member ID (4–8 digits)",
        required: true,
        sensitive: false,
      },
    ],
    outputs: [
      {
        name: "savingsBalance",
        type: "string",
        description: "Current savings balance as displayed",
        locator: {
          strategy: "label",
          value: "Savings Balance",
          frame: "Lookup Results",
          alternatives: [
            { strategy: "text", value: "$", frame: "Lookup Results" },
          ],
          reasoning: "Balance is in a strong with aria-label inside the results iframe",
        },
      },
    ],
    steps: [
      {
        id: "s1",
        action: "navigate",
        description: "Open Member Lookup",
        url: entryUrl.replace(/\/?$/, "/").replace(/\/$/, "") + "/lookup.html",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s2",
        action: "fill",
        description: "Enter Member ID",
        locator: {
          strategy: "label",
          value: "Member ID",
          alternatives: [
            { strategy: "role_name", role: "textbox", value: "Member ID" },
            { strategy: "css", value: "#memberIdField" },
          ],
          reasoning: "Label association is stable on this form; CSS id is last-resort fallback only",
        },
        paramRef: "memberId",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s3",
        action: "click",
        description: "Click Search",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Search",
          alternatives: [{ strategy: "text", value: "Search" }],
          reasoning: "Button accessible name is unique on the page",
        },
        irreversible: false,
        recoverableHints: [],
        checkpoint: {
          id: "after-search",
          description: "Results iframe populated (member found or not found)",
          locator: {
            strategy: "text",
            value: "Member",
            frame: "Lookup Results",
            alternatives: [
              { strategy: "text", value: "MEMBER NOT FOUND", frame: "Lookup Results" },
              { strategy: "text", value: "Savings Balance", frame: "Lookup Results" },
            ],
          },
          businessOutcomes: [
            {
              pattern: "MEMBER NOT FOUND|MEM_NOT_FOUND",
              code: "MEM_NOT_FOUND",
              message: "No member exists for the given Member ID",
            },
            {
              pattern: "Validation Error",
              code: "VALIDATION_ERROR",
              message: "Form validation failed",
            },
          ],
        },
      },
      {
        id: "s4",
        action: "extract",
        description: "Read savings balance from results iframe",
        locator: {
          strategy: "label",
          value: "Savings Balance",
          frame: "Lookup Results",
          alternatives: [
            { strategy: "css", value: 'strong[aria-label="Savings Balance"]', frame: "Lookup Results" },
          ],
          reasoning: "aria-label on strong is intentional accessibility hook without data-testid",
        },
        outputName: "savingsBalance",
        irreversible: false,
        recoverableHints: [],
      },
    ],
    successCheckpoint: {
      id: "success",
      description: "Member located and savings balance visible",
      locator: {
        strategy: "text",
        value: "Member located",
        frame: "Lookup Results",
        alternatives: [{ strategy: "text", value: "Savings Balance", frame: "Lookup Results" }],
      },
      expectText: "Member located",
      businessOutcomes: [
        {
          pattern: "MEMBER NOT FOUND|MEM_NOT_FOUND",
          code: "MEM_NOT_FOUND",
          message: "No member exists for the given Member ID",
        },
      ],
    },
    locatorStrategyMeta: {
      preferredOrder: ["role_name", "label", "frame_role_name", "text", "placeholder", "css"],
      notes:
        "Hostile legacy UI: table layout, results in iframe titled Lookup Results, no test ids. Prefer roles/labels; CSS ids only as fallback.",
    },
    safety: {
      allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
      allowedActions: [
        "navigate",
        "click",
        "fill",
        "select",
        "press",
        "wait_for",
        "extract",
        "assert",
        "dismiss_if_present",
      ],
      requiresConfirmationForIrreversible: true,
    },
    metadata: {
      discoveredAt: new Date().toISOString(),
      goal: "look up member and read savings balance",
      model: "synthetic-fixture",
      synthetic: true,
    },
  });
}

export function buildOpenSubAccountArtifact(entryUrl: string): CapabilityArtifact {
  const base = entryUrl.replace(/\/$/, "");
  return CapabilityArtifactSchema.parse({
    version: "1.0.0",
    name: "open_member_sub_account",
    description:
      "Open a new sub-account for a member through the wizard and reach the confirmation/complete screen.",
    target: { kind: "web", entryUrl, appId: "legacy-bank-mock" },
    parameters: [
      {
        name: "memberId",
        type: "string",
        description: "Member ID",
        required: true,
        sensitive: false,
      },
      {
        name: "accountType",
        type: "string",
        description: "Account type label (Savings, Checking, Money Market)",
        required: true,
        sensitive: false,
      },
      {
        name: "productCode",
        type: "string",
        description: "Product code e.g. SAV-01",
        required: true,
        sensitive: false,
      },
    ],
    outputs: [
      {
        name: "confirmationCode",
        type: "string",
        description: "Confirmation code after submit",
        locator: {
          strategy: "label",
          value: "Confirmation Code",
          alternatives: [{ strategy: "text", value: "CNF-" }],
        },
      },
      {
        name: "newAccountNumber",
        type: "string",
        description: "New account number",
        locator: {
          strategy: "label",
          value: "New Account Number",
          alternatives: [],
        },
      },
    ],
    steps: [
      {
        id: "s1",
        action: "navigate",
        description: "Open sub-account wizard",
        url: `${base}/open-account.html`,
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s2",
        action: "fill",
        description: "Enter Member ID",
        locator: {
          strategy: "label",
          value: "Member ID",
          alternatives: [{ strategy: "css", value: "#oaMemberId" }],
        },
        paramRef: "memberId",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s3",
        action: "click",
        description: "Continue from step 1",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Continue",
          alternatives: [],
        },
        irreversible: false,
        recoverableHints: [],
        checkpoint: {
          id: "step2",
          description: "Account details step visible",
          locator: {
            strategy: "text",
            value: "Account Details",
            alternatives: [{ strategy: "text", value: "Account Type" }],
          },
          businessOutcomes: [
            {
              pattern: "MEMBER NOT FOUND|MEM_NOT_FOUND",
              code: "MEM_NOT_FOUND",
              message: "No member exists for the given Member ID",
            },
            {
              pattern: "Validation Error",
              code: "VALIDATION_ERROR",
              message: "Form validation failed",
            },
          ],
        },
      },
      {
        id: "s4",
        action: "select",
        description: "Choose account type",
        locator: {
          strategy: "label",
          value: "Account Type",
          alternatives: [{ strategy: "role_name", role: "combobox", value: "Account Type" }],
        },
        paramRef: "accountType",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s5",
        action: "fill",
        description: "Enter product code",
        locator: {
          strategy: "label",
          value: "Product Code",
          alternatives: [{ strategy: "css", value: "#oaProduct" }],
        },
        paramRef: "productCode",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s6",
        action: "click",
        description: "Review",
        locator: { strategy: "role_name", role: "button", value: "Review", alternatives: [] },
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s7",
        action: "click",
        description: "Confirm & Submit (irreversible)",
        locator: {
          strategy: "role_name",
          role: "button",
          value: "Confirm & Submit",
          alternatives: [{ strategy: "text", value: "Confirm" }],
        },
        irreversible: true,
        recoverableHints: [],
      },
      {
        id: "s8",
        action: "extract",
        description: "Read confirmation code",
        locator: {
          strategy: "label",
          value: "Confirmation Code",
          alternatives: [],
        },
        outputName: "confirmationCode",
        irreversible: false,
        recoverableHints: [],
      },
      {
        id: "s9",
        action: "extract",
        description: "Read new account number",
        locator: {
          strategy: "label",
          value: "New Account Number",
          alternatives: [],
        },
        outputName: "newAccountNumber",
        irreversible: false,
        recoverableHints: [],
      },
    ],
    successCheckpoint: {
      id: "success",
      description: "Sub-account opened confirmation visible",
      locator: {
        strategy: "text",
        value: "Sub-Account Opened",
        alternatives: [{ strategy: "text", value: "Status: COMPLETE" }],
      },
      expectText: "COMPLETE",
      businessOutcomes: [
        {
          pattern: "MEMBER NOT FOUND|MEM_NOT_FOUND",
          code: "MEM_NOT_FOUND",
          message: "No member exists for the given Member ID",
        },
      ],
    },
    locatorStrategyMeta: {
      preferredOrder: ["role_name", "label", "text", "css"],
      notes: "Wizard is multi-step; Confirm & Submit is irreversible and requires confirmation flag.",
    },
    safety: {
      allowedOrigins: ["http://127.0.0.1:4173", "http://localhost:4173"],
      allowedActions: [
        "navigate",
        "click",
        "fill",
        "select",
        "press",
        "wait_for",
        "extract",
        "assert",
        "dismiss_if_present",
      ],
      requiresConfirmationForIrreversible: true,
    },
    metadata: {
      discoveredAt: new Date().toISOString(),
      goal: "open a new sub-account and reach confirmation",
      model: "synthetic-fixture",
      synthetic: true,
    },
  });
}
