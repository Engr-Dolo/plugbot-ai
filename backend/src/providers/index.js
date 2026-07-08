import { createGeminiProvider } from "./geminiProvider.js";
import { createMockProvider } from "./mockProvider.js";
import { createOpenAIProvider } from "./openaiProvider.js";

export function createAIProvider(env = process.env) {
  const providerName = (env.AI_PROVIDER || "mock").trim().toLowerCase();

  if (providerName === "mock") {
    return createMockProvider();
  }

  if (providerName === "openai") {
    return createOpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL
    });
  }

  if (providerName === "gemini") {
    return createGeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL
    });
  }

  throw new Error(
    `Unsupported AI_PROVIDER "${providerName}". Use "mock", "openai", or "gemini".`
  );
}

export { AIProviderError, quotaExhaustedMessage } from "./errors.js";
export { isOpenAIQuotaExhaustedError } from "./openaiProvider.js";
export {
  isGeminiAuthenticationError,
  isGeminiAvailabilityError,
  isGeminiQuotaError,
  isGeminiTimeoutError
} from "./geminiProvider.js";
