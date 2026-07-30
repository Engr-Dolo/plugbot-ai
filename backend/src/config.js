const supportedProviders = new Set(["mock", "openai", "gemini"]);

export function loadRuntimeConfig(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "development").trim().toLowerCase();
  const aiProvider = String(env.AI_PROVIDER || "mock").trim().toLowerCase();
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS || env.CORS_ORIGIN || "");

  if (!supportedProviders.has(aiProvider)) {
    throw new Error(
      `Unsupported AI_PROVIDER "${aiProvider}". Use "mock", "openai", or "gemini".`
    );
  }

  if (nodeEnv === "production") {
    validateProductionConfig({ env, aiProvider, allowedOrigins });
  }

  return Object.freeze({
    nodeEnv,
    aiProvider,
    port: readInteger(env.PORT, 3000, 1, 65_535, "PORT"),
    allowedOrigins:
      allowedOrigins.length > 0 ? Object.freeze(allowedOrigins) : defaultDevelopmentOrigins(nodeEnv),
    trustProxyHops: readInteger(
      env.TRUST_PROXY_HOPS,
      nodeEnv === "production" ? 1 : 0,
      0,
      10,
      "TRUST_PROXY_HOPS"
    ),
    rateLimitWindowMs: readInteger(
      env.RATE_LIMIT_WINDOW_MS,
      60_000,
      1000,
      86_400_000,
      "RATE_LIMIT_WINDOW_MS"
    ),
    rateLimitMax: readInteger(env.RATE_LIMIT_MAX, 30, 1, 10_000, "RATE_LIMIT_MAX"),
    providerMaxRetries: readInteger(
      env.PROVIDER_MAX_RETRIES,
      1,
      0,
      2,
      "PROVIDER_MAX_RETRIES"
    ),
    providerAttemptTimeoutMs: readInteger(
      env.PROVIDER_ATTEMPT_TIMEOUT_MS,
      20_000,
      1000,
      30_000,
      "PROVIDER_ATTEMPT_TIMEOUT_MS"
    ),
    providerTotalDeadlineMs: readInteger(
      env.PROVIDER_TOTAL_DEADLINE_MS,
      28_000,
      2000,
      35_000,
      "PROVIDER_TOTAL_DEADLINE_MS"
    ),
    providerBaseBackoffMs: readInteger(
      env.PROVIDER_RETRY_BASE_DELAY_MS,
      250,
      50,
      1000,
      "PROVIDER_RETRY_BASE_DELAY_MS"
    ),
    shutdownTimeoutMs: readInteger(
      env.SHUTDOWN_TIMEOUT_MS,
      10_000,
      1000,
      30_000,
      "SHUTDOWN_TIMEOUT_MS"
    )
  });
}

export function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      if (origin === "*") {
        return origin;
      }

      let parsed;
      try {
        parsed = new URL(origin);
      } catch {
        throw new Error(`ALLOWED_ORIGINS contains an invalid origin: "${origin}".`);
      }

      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.origin !== origin ||
        parsed.username ||
        parsed.password
      ) {
        throw new Error(
          `ALLOWED_ORIGINS entries must be exact HTTP(S) origins without paths: "${origin}".`
        );
      }

      return parsed.origin;
    });
}

function validateProductionConfig({ env, aiProvider, allowedOrigins }) {
  if (aiProvider === "mock") {
    throw new Error("AI_PROVIDER=mock is not allowed when NODE_ENV=production.");
  }

  if (aiProvider === "gemini" && !String(env.GEMINI_API_KEY || "").trim()) {
    throw new Error("GEMINI_API_KEY is required for the Gemini production provider.");
  }

  if (aiProvider === "openai" && !String(env.OPENAI_API_KEY || "").trim()) {
    throw new Error("OPENAI_API_KEY is required for the OpenAI production provider.");
  }

  if (allowedOrigins.length === 0) {
    throw new Error("ALLOWED_ORIGINS must contain at least one production website origin.");
  }

  if (allowedOrigins.includes("*")) {
    throw new Error('ALLOWED_ORIGINS cannot contain "*" when NODE_ENV=production.');
  }
}

function readInteger(value, fallback, minimum, maximum, name) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }

  return parsed;
}

function defaultDevelopmentOrigins(nodeEnv) {
  if (nodeEnv === "production") {
    return Object.freeze([]);
  }

  return Object.freeze([
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:61328",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:61328"
  ]);
}
