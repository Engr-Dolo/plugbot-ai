import { GoogleGenAI } from "@google/genai";
import {
  AIProviderError,
  authenticationFailedMessage,
  providerTimeoutMessage,
  providerUnavailableMessage,
  quotaExhaustedMessage
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
    async generateReply({ botId, message, history = [] }) {
      if (!client) {
        throw new AIProviderError(
          "Gemini is not configured. Set GEMINI_API_KEY before using chat."
        );
      }

      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            ...history.map(toGeminiContent),
            { role: "user", parts: [{ text: message }] }
          ],
          config: {
            systemInstruction:
              "You are PlugBot AI, a helpful embedded website chatbot. " +
              `Answer concisely for bot ID "${botId}". If you do not know, say so.`
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

  return text || "I could not generate a response.";
}

function normalizeGeminiError(error) {
  if (isGeminiQuotaError(error)) {
    return new AIProviderError(quotaExhaustedMessage, {
      status: 503,
      cause: error
    });
  }

  if (isGeminiAuthenticationError(error)) {
    return new AIProviderError(authenticationFailedMessage, {
      status: 503,
      cause: error
    });
  }

  if (isGeminiTimeoutError(error)) {
    return new AIProviderError(providerTimeoutMessage, {
      status: 504,
      cause: error
    });
  }

  if (isGeminiAvailabilityError(error)) {
    return new AIProviderError(providerUnavailableMessage, {
      status: 503,
      cause: error
    });
  }

  return new AIProviderError("Something went wrong.", { cause: error });
}

export function isGeminiQuotaError(error) {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  return (
    status === 429 ||
    code === "RESOURCE_EXHAUSTED" ||
    code === "QUOTA_EXCEEDED"
  );
}

export function isGeminiAuthenticationError(error) {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

  return (
    status === 401 ||
    status === 403 ||
    code === "UNAUTHENTICATED" ||
    code === "PERMISSION_DENIED"
  );
}

export function isGeminiTimeoutError(error) {
  const status = getErrorStatus(error);
  const code = getErrorCode(error);
  const message = getErrorMessage(error);

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
  const status = getErrorStatus(error);
  const code = getErrorCode(error);

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

function getErrorStatus(error) {
  const status =
    error?.status ||
    error?.statusCode ||
    error?.code ||
    error?.error?.status ||
    error?.error?.code;

  return typeof status === "number" ? status : Number(status) || undefined;
}

function getErrorCode(error) {
  return String(
    error?.error?.status ||
      error?.error?.code ||
      error?.status ||
      error?.code ||
      ""
  ).toUpperCase();
}

function getErrorMessage(error) {
  return String(error?.message || error?.error?.message || "").toLowerCase();
}
