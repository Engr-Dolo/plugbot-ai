import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import {
  AIProviderError,
  createAIProvider,
  isOpenAIQuotaExhaustedError,
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

app.locals.aiProvider = createAIProvider();

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
  try {
    const parsed = chatRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid request body.",
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message
        }))
      });
    }

    const { botId, message, history = [] } = parsed.data;
    const reply = await req.app.locals.aiProvider.generateReply({
      botId,
      message,
      history
    });

    res.json({ reply, botId });
  } catch (error) {
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
    console.error("AI provider error", {
      status: error.status,
      name: error.name,
      causeName: error.cause?.name,
      causeStatus: error.cause?.status || error.cause?.statusCode,
      causeCode: error.cause?.code || error.cause?.error?.code
    });

    return res
      .status(error.status)
      .json({ error: error.publicMessage || "Something went wrong." });
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

class CorsOriginError extends Error {
  constructor(origin) {
    super("Origin is not allowed.");
    this.name = "CorsOriginError";
    this.origin = origin;
  }
}

export { isOpenAIQuotaExhaustedError, quotaExhaustedMessage };
export default app;
