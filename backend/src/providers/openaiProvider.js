import OpenAI from "openai";
import { buildGroundedSystemPrompt } from "./context.js";
import { AIProviderError, quotaExhaustedMessage } from "./errors.js";

export function createOpenAIProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  client: providedClient
} = {}) {
  const client = providedClient || (apiKey ? new OpenAI({ apiKey }) : null);

  return {
    name: "openai",
    async generateReply({ botId, message, history = [], botContext }) {
      if (!client) {
        throw new AIProviderError(
          "OpenAI is not configured. Set OPENAI_API_KEY before using chat."
        );
      }

      try {
        const completion = await client.chat.completions.create({
          model,
          messages: [
            {
              role: "system",
              content: buildGroundedSystemPrompt({ botId, botContext })
            },
            ...history,
            { role: "user", content: message }
          ]
        });

        return (
          completion.choices[0]?.message?.content?.trim() ||
          "I could not generate a response."
        );
      } catch (error) {
        if (isOpenAIQuotaExhaustedError(error)) {
          throw new AIProviderError(quotaExhaustedMessage, {
            status: 503,
            cause: error
          });
        }

        throw new AIProviderError("Something went wrong.", { cause: error });
      }
    }
  };
}

export function isOpenAIQuotaExhaustedError(error) {
  return (
    error?.status === 429 &&
    (error?.code === "insufficient_quota" ||
      error?.type === "insufficient_quota" ||
      error?.error?.code === "insufficient_quota" ||
      error?.error?.type === "insufficient_quota")
  );
}
