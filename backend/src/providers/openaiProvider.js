import OpenAI from "openai";
import { buildGroundedSystemPrompt } from "./context.js";
import {
  createProviderError,
  normalizeProviderError,
  providerErrorCategories
} from "./errors.js";

export function createOpenAIProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  client: providedClient
} = {}) {
  const client = providedClient || (apiKey ? new OpenAI({ apiKey }) : null);

  return {
    name: "openai",
    async generateReply({ botId, message, history = [], botContext, signal }) {
      if (!client) {
        throw createProviderError(providerErrorCategories.AUTH_ERROR);
      }

      try {
        const completion = await client.chat.completions.create(
          {
            model,
            messages: [
              {
                role: "system",
                content: buildGroundedSystemPrompt({ botId, botContext })
              },
              ...history,
              { role: "user", content: message }
            ]
          },
          signal ? { signal } : undefined
        );

        const text = completion.choices[0]?.message?.content?.trim() || "";
        if (!text) {
          throw createProviderError(providerErrorCategories.INVALID_RESPONSE);
        }

        return text;
      } catch (error) {
        if (isOpenAIQuotaExhaustedError(error)) {
          throw createProviderError(providerErrorCategories.QUOTA_EXCEEDED, {
            cause: error
          });
        }

        throw normalizeProviderError(error);
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
