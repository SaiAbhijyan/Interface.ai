/** OpenAI tool definitions for the observe → decide → act discovery loop.
 * Schemas are closed (additionalProperties: false). Runtime also allowlists tool names
 * in loop-policy so the model cannot invent off-policy actions.
 */

export const DISCOVERY_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "observe",
      description:
        "Observe the current UI: URL, title, accessibility tree, visible text, frames. Call this before acting.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "click",
      description: "Click a control identified by accessibility-first locator.",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "string",
            enum: ["role_name", "label", "placeholder", "text", "css", "frame_role_name"],
          },
          value: { type: "string", description: "Accessible name, label, text, or CSS" },
          role: { type: "string", description: "ARIA role when strategy is role_name" },
          frame: { type: "string", description: "iframe title/name if inside a frame" },
          reasoning: { type: "string" },
        },
        required: ["strategy", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "fill",
      description: "Fill an input. Use paramName to bind a capability parameter.",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "string",
            enum: ["role_name", "label", "placeholder", "text", "css", "frame_role_name"],
          },
          value: { type: "string", description: "Literal text if not using paramName" },
          locatorValue: { type: "string", description: "Locator target when distinct from fill text" },
          paramName: { type: "string", description: "Parameter name to bind (preferred)" },
          role: { type: "string" },
          frame: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["strategy"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "select",
      description: "Select an option in a <select> by label or value.",
      parameters: {
        type: "object",
        properties: {
          strategy: {
            type: "string",
            enum: ["role_name", "label", "placeholder", "text", "css"],
          },
          locatorValue: { type: "string" },
          option: { type: "string" },
          paramName: { type: "string" },
          role: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["strategy", "locatorValue", "option"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate",
      description: "Navigate to a URL on the allowlisted host.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "extract",
      description: "Extract text from a locator as a named output of the capability.",
      parameters: {
        type: "object",
        properties: {
          outputName: { type: "string" },
          strategy: {
            type: "string",
            enum: ["role_name", "label", "placeholder", "text", "css", "frame_role_name"],
          },
          value: { type: "string" },
          role: { type: "string" },
          frame: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["outputName", "strategy", "value"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "done",
      description:
        "Call when the goal is achieved. Provide capability name, description, success criteria, parameters, and outputs.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          successDescription: { type: "string" },
          successText: {
            type: "string",
            description: "Visible text proving success (used as success checkpoint)",
          },
          parameters: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["string", "number", "boolean"] },
                description: { type: "string" },
                sensitive: {
                  type: "boolean",
                  description:
                    "If true, redact at rest in logs. Default true. Always true for memberId/account/customer/bank identity fields.",
                },
              },
              required: ["name", "type", "description"],
              additionalProperties: false,
            },
          },
          outputs: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["string", "number", "boolean"] },
                description: { type: "string" },
              },
              required: ["name", "type", "description"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "description", "successDescription", "successText"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "escalate",
      description: "Escalate to a human operator when stuck or facing irreversible risk.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string" },
        },
        required: ["reason"],
        additionalProperties: false,
      },
    },
  },
];
