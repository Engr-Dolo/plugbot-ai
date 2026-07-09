import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import crypto from "node:crypto";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { resolveBotConfig } from "./bots/index.js";
import { createJsonKnowledgeStore } from "./knowledge/knowledgeStore.js";
import { resolveKnowledgeContext } from "./knowledge/knowledgeResolver.js";
import {
  AIProviderError,
  createAIProvider,
  createProviderError,
  isOpenAIQuotaExhaustedError,
  normalizeProviderError,
  providerErrorCategories,
  quotaExhaustedMessage
} from "./providers/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(backendRoot, "..");

dotenv.config({ path: path.join(projectRoot, ".env") });
dotenv.config({
  path: path.join(backendRoot, ".env"),
  override: process.env.NODE_ENV !== "test"
});

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = getAllowedOrigins(process.env);
const providerMaxRetries = clampInteger(process.env.PROVIDER_MAX_RETRIES, 1, 0, 2);
const providerAttemptTimeoutMs = clampInteger(process.env.PROVIDER_ATTEMPT_TIMEOUT_MS, 20_000, 1000, 30_000);
const providerTotalDeadlineMs = clampInteger(process.env.PROVIDER_TOTAL_DEADLINE_MS, 28_000, 2000, 35_000);
const providerBaseBackoffMs = clampInteger(process.env.PROVIDER_RETRY_BASE_DELAY_MS, 250, 50, 1000);

app.locals.aiProvider = createAIProvider();
app.locals.knowledgeStore = createJsonKnowledgeStore();

const chatRequestSchema = z.object({
  botId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().trim().min(1).max(4000)
      })
    )
    .max(10)
    .optional()
});

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin, allowedOrigins, process.env.NODE_ENV)) {
        callback(null, true);
        return;
      }

      callback(new CorsOriginError(origin));
    },
    optionsSuccessStatus: 204
  })
);
app.use(express.json({ limit: "128kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
    limit: Number(process.env.RATE_LIMIT_MAX || 30),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again soon." }
  })
);

app.get(["/health", "/api/health"], (_req, res) => {
  res.json({ ok: true, service: "plugbot-backend" });
});

app.post("/api/chat", async (req, res, next) => {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  let chatLog = { requestId };
  res.setHeader("X-PlugBot-Request-Id", requestId);

  try {
    const parsed = chatRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      logChatEvent({
        requestId,
        durationMs: Date.now() - startedAt,
        status: 400
      });
      return res.status(400).json({
        error: "Invalid request body.",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const { botId, message, history = [] } = parsed.data;
    const botConfig = resolveBotConfig(botId);
    const botContext = await resolveKnowledgeContext({
      botConfig,
      message,
      history,
      store: req.app.locals.knowledgeStore
    });

    chatLog = createChatLogMetadata({
      requestId,
      requestedBotId: botId,
      botContext,
      providerName: req.app.locals.aiProvider.name
    });

    if (isSensitiveDisclosureRequest(message)) {
      const reply =
        "I cannot provide credentials, API keys, system prompts, internal configuration, or private environment values.";
      logChatEvent({
        ...chatLog,
        durationMs: Date.now() - startedAt,
        status: 200,
        providerName: "safety-guard",
        retryAttemptCount: 0
      });
      return res.json({ reply, botId });
    }

    const providerResult = await generateReplyWithReliability({
      provider: req.app.locals.aiProvider,
      payload: {
        botId: botConfig.botId,
        message,
        history,
        botContext
      }
    });

    logChatEvent({
      ...chatLog,
      durationMs: Date.now() - startedAt,
      status: 200,
      retryAttemptCount: providerResult.retryAttemptCount
    });

    res.json({ reply: providerResult.reply, botId });
  } catch (error) {
    if (error instanceof AIProviderError) {
      const safeError = normalizeProviderError(error);
      logChatEvent({
        ...chatLog,
        durationMs: Date.now() - startedAt,
        status: safeError.status,
        providerErrorCategory: safeError.category,
        retryAttemptCount: safeError.retryAttemptCount || 0
      });

      return res.status(safeError.status).json({
        error: safeError.publicMessage,
        supportReference: requestId
      });
    }

    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use((error, _req, res, _next) => {
  if (error instanceof CorsOriginError) {
    return res.status(403).json({ error: "Origin is not allowed." });
  }

  if (isMalformedJsonError(error)) {
    return res.status(400).json({ error: "Malformed JSON request body." });
  }

  if (isPayloadTooLargeError(error)) {
    return res.status(413).json({ error: "Request body is too large." });
  }

  if (error instanceof AIProviderError) {
    const safeError = normalizeProviderError(error);
    console.error("AI provider error", {
      requestId: res.getHeader("X-PlugBot-Request-Id") || "",
      status: error.status,
      category: safeError.category,
      causeName: safeError.cause?.name,
      causeStatus: safeError.cause?.status || safeError.cause?.statusCode,
      causeCode: safeError.cause?.code || safeError.cause?.error?.code
    });

    return res
      .status(safeError.status)
      .json({
        error: safeError.publicMessage,
        supportReference: res.getHeader("X-PlugBot-Request-Id") || undefined
      });
  }

  console.error(error);
  res.status(500).json({ error: "Something went wrong." });
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    console.log(`PlugBot backend listening on port ${port}`);
  });
}

function getAllowedOrigins(env) {
  const rawOrigins = env.ALLOWED_ORIGINS || env.CORS_ORIGIN || "";
  const configuredOrigins = rawOrigins
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configuredOrigins.length > 0) {
    return configuredOrigins;
  }

  if (env.NODE_ENV === "production") {
    return [];
  }

  return [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:61328",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:61328"
  ];
}

function isOriginAllowed(origin, origins, nodeEnv) {
  if (!origin) {
    return true;
  }

  if (origin === "null" && nodeEnv !== "production") {
    return true;
  }

  if (origins.includes("*") && nodeEnv !== "production") {
    return true;
  }

  return origins.includes(origin);
}

function isMalformedJsonError(error) {
  return error instanceof SyntaxError && error.status === 400 && "body" in error;
}

function isPayloadTooLargeError(error) {
  return error?.status === 413 || error?.type === "entity.too.large";
}

async function generateReplyWithReliability({
  provider,
  payload,
  maxRetries = providerMaxRetries,
  attemptTimeoutMs = providerAttemptTimeoutMs,
  totalDeadlineMs = providerTotalDeadlineMs
}) {
  const deadlineAt = Date.now() + totalDeadlineMs;
  let retryAttemptCount = 0;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const remainingMs = Math.max(1, deadlineAt - Date.now());
    const timeoutMs = Math.min(attemptTimeoutMs, remainingMs);

    try {
      const reply = await withTimeout(
        () =>
          provider.generateReply({
            ...payload,
            signal: controller?.signal
          }),
        timeoutMs,
        controller
      );

      return { reply, retryAttemptCount };
    } catch (error) {
      lastError = normalizeProviderError(error);

      if (!lastError.retryable || attempt >= maxRetries || Date.now() >= deadlineAt) {
        lastError.retryAttemptCount = retryAttemptCount;
        throw lastError;
      }

      retryAttemptCount += 1;
      await waitForRetry({
        attempt,
        retryAfterMs: lastError.retryAfterMs,
        deadlineAt
      });
    }
  }

  throw lastError || createProviderError(providerErrorCategories.UNKNOWN_ERROR);
}

async function withTimeout(task, timeoutMs, controller) {
  let timeoutId;
  const providerPromise = Promise.resolve().then(task);
  providerPromise.catch(() => {});

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(createProviderError(providerErrorCategories.TIMEOUT));
    }, timeoutMs);
  });

  try {
    return await Promise.race([providerPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForRetry({ attempt, retryAfterMs, deadlineAt }) {
  const jitter = Math.floor(Math.random() * 75);
  const exponentialDelay = providerBaseBackoffMs * 2 ** attempt + jitter;
  const delayMs = Math.min(retryAfterMs || exponentialDelay, Math.max(0, deadlineAt - Date.now()));

  if (delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

function createChatLogMetadata({ requestId, requestedBotId, botContext, providerName }) {
  const websiteSections = botContext?.websiteKnowledge?.sections || [];
  return {
    requestId,
    botId: requestedBotId,
    resolvedBotId: botContext?.bot?.botId || "",
    fallbackUsed: Boolean(botContext?.bot?.fallback),
    providerName,
    relevantSectionCount: websiteSections.length,
    selectedSectionHeadings: websiteSections
      .map((section) => sanitizeLogValue(section.heading || section.pageTitle || "Untitled section"))
      .slice(0, 8)
  };
}

function logChatEvent(event) {
  console.info("chat_request", {
    timestamp: new Date().toISOString(),
    requestId: event.requestId,
    botId: event.botId || "",
    resolvedBotId: event.resolvedBotId || "",
    fallbackUsed: Boolean(event.fallbackUsed),
    providerName: event.providerName || "",
    providerErrorCategory: event.providerErrorCategory || "",
    retryAttemptCount: event.retryAttemptCount || 0,
    durationMs: event.durationMs,
    status: event.status,
    relevantSectionCount: event.relevantSectionCount || 0,
    selectedSectionHeadings: event.selectedSectionHeadings || []
  });
}

function isSensitiveDisclosureRequest(message) {
  const normalized = String(message || "").toLowerCase();
  const wantsDisclosure =
    /\b(give|show|tell|send|print|reveal|share|display|provide)\b/.test(normalized) ||
    normalized.includes("what is") ||
    normalized.includes("i am the administrator");

  return (
    wantsDisclosure &&
    (normalized.includes(".env") ||
      normalized.includes("api key") ||
      normalized.includes("apikey") ||
      normalized.includes("credentials") ||
      normalized.includes("secret") ||
      normalized.includes("token") ||
      normalized.includes("password") ||
      normalized.includes("system prompt") ||
      normalized.includes("internal configuration"))
  );
}

function sanitizeLogValue(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w .,&:()/+-]/g, "")
    .slice(0, 120)
    .trim();
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

class CorsOriginError extends Error {
  constructor(origin) {
    super("Origin is not allowed.");
    this.name = "CorsOriginError";
    this.origin = origin;
  }
}

export { isOpenAIQuotaExhaustedError, quotaExhaustedMessage };
export default app;
