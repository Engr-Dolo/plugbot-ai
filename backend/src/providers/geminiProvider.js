import { GoogleGenAI } from "@google/genai";
import { buildGroundedSystemPrompt } from "./context.js";
import {
  createProviderError,
  getProviderErrorCode,
  getProviderErrorMessage,
  getProviderErrorStatus,
  normalizeProviderError,
  providerErrorCategories
} from "./errors.js";

const defaultGeminiModel = "gemini-2.5-flash";

export function createGeminiProvider({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || defaultGeminiModel,
  client: providedClient
} = {}) {
  const client = providedClient || (apiKey ? new GoogleGenAI({ apiKey }) : null);

  return {
    name: "gemini",
    async generateReply({ botId, message, history = [], botContext }) {
      if (!client) {
        throw createProviderError(providerErrorCategories.AUTH_ERROR);
      }

      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            ...history.map(toGeminiContent),
            { role: "user", parts: [{ text: message }] }
          ],
          config: {
            systemInstruction: buildGroundedSystemPrompt({ botId, botContext })
          }
        });

        return normalizeGeminiText(response);
      } catch (error) {
        throw normalizeGeminiError(error);
      }
    }
  };
}

function toGeminiContent(entry) {
  return {
    role: entry.role === "assistant" ? "model" : "user",
    parts: [{ text: entry.content }]
  };
}

function normalizeGeminiText(response) {
  const text =
    typeof response?.text === "string" ? response.text.trim() : "";

  if (!text) {
    throw createProviderError(providerErrorCategories.INVALID_RESPONSE);
  }

  return text;
}

function normalizeGeminiError(error) {
  if (isGeminiQuotaError(error)) {
    return createProviderError(providerErrorCategories.QUOTA_EXCEEDED, { cause: error });
  }

  if (isGeminiAuthenticationError(error)) {
    return createProviderError(providerErrorCategories.AUTH_ERROR, { cause: error });
  }

  if (isGeminiTimeoutError(error)) {
    return createProviderError(providerErrorCategories.TIMEOUT, { cause: error });
  }

  if (isGeminiAvailabilityError(error)) {
    return createProviderError(providerErrorCategories.TEMPORARILY_UNAVAILABLE, {
      cause: error
    });
  }

  return normalizeProviderError(error);
}

export function isGeminiQuotaError(error) {
  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error);
  const message = getProviderErrorMessage(error);

  return (
    code === "RESOURCE_EXHAUSTED" ||
    code === "QUOTA_EXCEEDED" ||
    message.includes("quota")
  );
}

export function isGeminiAuthenticationError(error) {
  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error);

  return (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED"
  );
}

export function isGeminiTimeoutError(error) {
  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error);
  const message = getProviderErrorMessage(error);

  return (
    status === 408 ||
    status === 504 ||
    code === "DEADLINE_EXCEEDED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNABORTED" ||
    error?.name === "AbortError" ||
    message.includes("timeout") ||
    message.includes("timed out")
  );
}

export function isGeminiAvailabilityError(error) {
  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error);

  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    code === "INTERNAL" ||
    code === "UNAVAILABLE" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "ENOTFOUND" ||
    code === "EHOSTUNREACH" ||
    code === "ENETUNREACH" ||
    code === "EAI_AGAIN"
  );
}
