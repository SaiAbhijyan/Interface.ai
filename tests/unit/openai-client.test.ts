import { describe, it, expect } from "vitest";
import { createOpenAIClient } from "../../src/llm/openai-client.js";

describe("createOpenAIClient OPENAI_BASE_URL", () => {
  it("passes baseURL when OPENAI_BASE_URL is set (OmniRoute)", () => {
    const client = createOpenAIClient("sk-test", {
      OPENAI_BASE_URL: "https://gateway.example/v1",
    } as NodeJS.ProcessEnv);
    expect(client.baseURL).toBe("https://gateway.example/v1");
  });

  it("omits custom baseURL when unset", () => {
    const client = createOpenAIClient("sk-test", {} as NodeJS.ProcessEnv);
    // SDK default ends with /v1
    expect(client.baseURL).toMatch(/\/?v1\/?$/);
  });
});
