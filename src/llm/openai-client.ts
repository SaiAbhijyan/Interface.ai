import OpenAI from "openai";

/** Build OpenAI SDK client; honors OPENAI_BASE_URL for OmniRoute OpenAI-compat. */
export function createOpenAIClient(apiKey: string, env: NodeJS.ProcessEnv = process.env): OpenAI {
  const baseURL = env.OPENAI_BASE_URL?.trim() || undefined;
  return new OpenAI({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  });
}
