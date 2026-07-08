process.env.NODE_ENV = "test";
process.env.AI_PROVIDER = "mock";
process.env.ALLOWED_ORIGINS =
  "http://localhost:3000, http://localhost:5173, https://plugbot-ai.test";

const { default: app } = await import("../src/server.js");
const {
  AIProviderError,
  createAIProvider,
  isGeminiAuthenticationError,
  isGeminiAvailabilityError,
  isGeminiQuotaError,
  isGeminiTimeoutError,
  isOpenAIQuotaExhaustedError,
  quotaExhaustedMessage
} = await import("../src/providers/index.js");
const { createGeminiProvider } = await import("../src/providers/geminiProvider.js");
const { createOpenAIProvider } = await import("../src/providers/openaiProvider.js");

app.locals.aiProvider = createAIProvider({ AI_PROVIDER: "mock" });

const server = app.listen(0);

try {
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const healthResponse = await fetch(`${baseUrl}/health`);
  if (!healthResponse.ok) {
    throw new Error(`Health check failed with status ${healthResponse.status}`);
  }

  const health = await healthResponse.json();
  if (health.ok !== true) {
    throw new Error("Health check returned an unexpected payload");
  }

  const apiHealthResponse = await fetch(`${baseUrl}/api/health`);
  if (!apiHealthResponse.ok) {
    throw new Error(
      `API health check failed with status ${apiHealthResponse.status}`
    );
  }

  const allowedCorsResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://plugbot-ai.test" }
  });
  if (
    allowedCorsResponse.status !== 200 ||
    allowedCorsResponse.headers.get("access-control-allow-origin") !==
      "https://plugbot-ai.test"
  ) {
    throw new Error("Allowed CORS origin was not accepted");
  }

  const preflightResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "OPTIONS",
    headers: {
      origin: "https://plugbot-ai.test",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  if (
    preflightResponse.status !== 204 ||
    preflightResponse.headers.get("access-control-allow-origin") !==
      "https://plugbot-ai.test"
  ) {
    throw new Error("Allowed CORS preflight was not handled correctly");
  }

  const rejectedCorsResponse = await fetch(`${baseUrl}/api/health`, {
    headers: { origin: "https://evil.example" }
  });
  if (rejectedCorsResponse.status !== 403) {
    throw new Error("Rejected CORS origin was not blocked");
  }

  const noOriginResponse = await fetch(`${baseUrl}/api/health`);
  if (!noOriginResponse.ok) {
    throw new Error("No-Origin request should be allowed");
  }

  const invalidChatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ botId: "demo-bot", message: "" })
  });

  if (invalidChatResponse.status !== 400) {
    throw new Error(
      `Validation check failed with status ${invalidChatResponse.status}`
    );
  }

  const malformedJsonResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  if (malformedJsonResponse.status !== 400) {
    throw new Error(
      `Malformed JSON check failed with status ${malformedJsonResponse.status}`
    );
  }

  const oversizedPayloadResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      botId: "demo-bot",
      message: "a".repeat(140_000)
    })
  });
  if (oversizedPayloadResponse.status !== 413) {
    throw new Error(
      `Oversized payload check failed with status ${oversizedPayloadResponse.status}`
    );
  }

  const longMessage = "a".repeat(4000);
  const mockChatResponse = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      botId: "demo-bot",
      message: longMessage,
      history: Array.from({ length: 10 }, (_, index) => ({
        role: index % 2 === 0 ? "user" : "assistant",
        content: longMessage
      }))
    })
  });

  const mockChatPayload = await mockChatResponse.json();
  if (
    mockChatResponse.status !== 200 ||
    mockChatPayload.botId !== "demo-bot" ||
    !mockChatPayload.reply?.includes("free local mock mode")
  ) {
    throw new Error("Mock provider chat payload did not reach the route handler");
  }

  if (
    !isOpenAIQuotaExhaustedError({
      status: 429,
      error: { code: "insufficient_quota" }
    })
  ) {
    throw new Error("OpenAI quota exhaustion detection failed");
  }

  if (
    isOpenAIQuotaExhaustedError({
      status: 429,
      error: { code: "rate_limit_exceeded" }
    })
  ) {
    throw new Error("OpenAI rate limit errors should not be treated as quota exhaustion");
  }

  const openAIProvider = createOpenAIProvider({
    client: {
      chat: {
        completions: {
          create: async () => {
            throw { status: 429, error: { code: "insufficient_quota" } };
          }
        }
      }
    }
  });

  try {
    await openAIProvider.generateReply({
      botId: "demo-bot",
      message: "Hello",
      history: []
    });
    throw new Error("OpenAI quota exhaustion was not converted to a provider error");
  } catch (error) {
    if (
      !(error instanceof AIProviderError) ||
      error.status !== 503 ||
      error.publicMessage !== quotaExhaustedMessage
    ) {
      throw new Error("OpenAI quota exhaustion was not sanitized correctly");
    }
  }

  if (
    quotaExhaustedMessage !==
    "AI service is temporarily unavailable because API quota is exhausted."
  ) {
    throw new Error("OpenAI quota exhaustion message changed unexpectedly");
  }

  if (
    !isGeminiQuotaError({ status: 429 }) ||
    !isGeminiAuthenticationError({ status: 401 }) ||
    !isGeminiTimeoutError({ code: "ETIMEDOUT" }) ||
    !isGeminiAvailabilityError({ status: 503 }) ||
    !isGeminiAvailabilityError({ code: "ECONNREFUSED" })
  ) {
    throw new Error("Gemini provider error classification failed");
  }

  const geminiProvider = createGeminiProvider({
    client: {
      models: {
        generateContent: async () => ({
          text: "  Gemini test reply  "
        })
      }
    }
  });

  const geminiReply = await geminiProvider.generateReply({
    botId: "demo-bot",
    message: "Hello",
    history: [{ role: "assistant", content: "Hi. How can I help?" }]
  });

  if (geminiReply !== "Gemini test reply") {
    throw new Error("Gemini provider did not normalize response text");
  }

  const failingGeminiProvider = createGeminiProvider({
    client: {
      models: {
        generateContent: async () => {
          throw { status: 403, message: "raw provider auth failure" };
        }
      }
    }
  });

  try {
    await failingGeminiProvider.generateReply({
      botId: "demo-bot",
      message: "Hello",
      history: []
    });
    throw new Error("Gemini provider error was not converted");
  } catch (error) {
    if (
      !(error instanceof AIProviderError) ||
      error.status !== 503 ||
      error.publicMessage.includes("raw provider")
    ) {
      throw new Error("Gemini provider error was not sanitized correctly");
    }
  }

  console.log("Smoke checks passed");
} finally {
  server.close();
}
