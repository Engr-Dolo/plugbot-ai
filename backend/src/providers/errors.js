export const providerErrorCategories = Object.freeze({
  RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  QUOTA_EXCEEDED: "PROVIDER_QUOTA_EXCEEDED",
  TIMEOUT: "PROVIDER_TIMEOUT",
  TEMPORARILY_UNAVAILABLE: "PROVIDER_TEMPORARILY_UNAVAILABLE",
  AUTH_ERROR: "PROVIDER_AUTH_ERROR",
  INVALID_RESPONSE: "PROVIDER_INVALID_RESPONSE",
  NETWORK_ERROR: "PROVIDER_NETWORK_ERROR",
  UNKNOWN_ERROR: "PROVIDER_UNKNOWN_ERROR"
});

export const providerPublicMessages = Object.freeze({
  [providerErrorCategories.RATE_LIMITED]:
    "The assistant is receiving many requests right now. Please try again shortly.",
  [providerErrorCategories.QUOTA_EXCEEDED]:
    "The AI service is temporarily unavailable. Please try again later.",
  [providerErrorCategories.TIMEOUT]:
    "The response is taking longer than expected. Please try again.",
  [providerErrorCategories.TEMPORARILY_UNAVAILABLE]:
    "The AI service is temporarily unavailable. Please try again shortly.",
  [providerErrorCategories.AUTH_ERROR]:
    "The AI service is temporarily unavailable. Please try again later.",
  [providerErrorCategories.INVALID_RESPONSE]:
    "The AI service is temporarily unavailable. Please try again shortly.",
  [providerErrorCategories.NETWORK_ERROR]:
    "The AI service is temporarily unavailable. Please try again shortly.",
  [providerErrorCategories.UNKNOWN_ERROR]:
    "The AI service is temporarily unavailable. Please try again shortly."
});

export const quotaExhaustedMessage =
  providerPublicMessages[providerErrorCategories.QUOTA_EXCEEDED];

export const authenticationFailedMessage =
  providerPublicMessages[providerErrorCategories.AUTH_ERROR];

export const providerUnavailableMessage =
  providerPublicMessages[providerErrorCategories.TEMPORARILY_UNAVAILABLE];

export const providerTimeoutMessage =
  providerPublicMessages[providerErrorCategories.TIMEOUT];

export class AIProviderError extends Error {
  constructor(
    message,
    {
      status,
      cause,
      category = providerErrorCategories.UNKNOWN_ERROR,
      retryable,
      retryAfterMs
    } = {}
  ) {
    super(message);
    this.name = "AIProviderError";
    this.category = category;
    this.status = status || statusForCategory(category);
    this.publicMessage =
      providerPublicMessages[category] ||
      providerPublicMessages[providerErrorCategories.UNKNOWN_ERROR];
    this.retryable = retryable ?? isRetryableCategory(category);
    this.retryAfterMs = Number.isFinite(retryAfterMs) ? retryAfterMs : undefined;
    this.cause = cause;
  }
}

export function createProviderError(category, { cause, status, retryAfterMs } = {}) {
  return new AIProviderError(providerPublicMessages[category], {
    category,
    cause,
    status,
    retryAfterMs
  });
}

export function normalizeProviderError(error) {
  if (error instanceof AIProviderError) {
    return error;
  }

  const status = getProviderErrorStatus(error);
  const code = getProviderErrorCode(error);
  const message = getProviderErrorMessage(error);
  const retryAfterMs = getRetryAfterMs(error);

  if (isAuthStatus(status) || isAuthCode(code)) {
    return createProviderError(providerErrorCategories.AUTH_ERROR, {
      cause: error,
      status: 503
    });
  }

  if (isQuotaError(status, code, message)) {
    return createProviderError(providerErrorCategories.QUOTA_EXCEEDED, {
      cause: error,
      status: 503
    });
  }

  if (isRateLimitError(status, code, message)) {
    return createProviderError(providerErrorCategories.RATE_LIMITED, {
      cause: error,
      status: 429,
      retryAfterMs
    });
  }

  if (isTimeoutError(status, code, message, error)) {
    return createProviderError(providerErrorCategories.TIMEOUT, {
      cause: error,
      status: 504,
      retryAfterMs
    });
  }

  if (isInvalidRequestError(status, code, message)) {
    return createProviderError(providerErrorCategories.UNKNOWN_ERROR, {
      cause: error,
      status: 500
    });
  }

  if (isUnavailableError(status, code)) {
    return createProviderError(providerErrorCategories.TEMPORARILY_UNAVAILABLE, {
      cause: error,
      status: 503,
      retryAfterMs
    });
  }

  if (isNetworkError(code)) {
    return createProviderError(providerErrorCategories.NETWORK_ERROR, {
      cause: error,
      status: 503,
      retryAfterMs
    });
  }

  return createProviderError(providerErrorCategories.UNKNOWN_ERROR, {
    cause: error,
    status: 500
  });
}

export function isRetryableProviderError(error) {
  return Boolean(normalizeProviderError(error).retryable);
}

export function statusForCategory(category) {
  if (category === providerErrorCategories.RATE_LIMITED) {
    return 429;
  }

  if (category === providerErrorCategories.TIMEOUT) {
    return 504;
  }

  if (category === providerErrorCategories.INVALID_RESPONSE) {
    return 502;
  }

  if (
    category === providerErrorCategories.QUOTA_EXCEEDED ||
    category === providerErrorCategories.AUTH_ERROR ||
    category === providerErrorCategories.TEMPORARILY_UNAVAILABLE ||
    category === providerErrorCategories.NETWORK_ERROR
  ) {
    return 503;
  }

  return 500;
}

function isRetryableCategory(category) {
  return [
    providerErrorCategories.RATE_LIMITED,
    providerErrorCategories.TIMEOUT,
    providerErrorCategories.TEMPORARILY_UNAVAILABLE,
    providerErrorCategories.NETWORK_ERROR
  ].includes(category);
}

export function getProviderErrorStatus(error) {
  const status =
    error?.status ||
    error?.statusCode ||
    error?.code ||
    error?.error?.status ||
    error?.error?.code;

  return typeof status === "number" ? status : Number(status) || undefined;
}

export function getProviderErrorCode(error) {
  return String(
    error?.error?.status ||
      error?.error?.code ||
      error?.code ||
      error?.type ||
      error?.status ||
      ""
  ).toUpperCase();
}

export function getProviderErrorMessage(error) {
  return String(error?.message || error?.error?.message || "").toLowerCase();
}

export function getRetryAfterMs(error, maxRetryAfterMs = 2000) {
  const raw =
    error?.headers?.get?.("retry-after") ||
    error?.headers?.["retry-after"] ||
    error?.response?.headers?.get?.("retry-after") ||
    error?.response?.headers?.["retry-after"];

  if (!raw) {
    return undefined;
  }

  const seconds = Number(raw);
  const retryAfterMs = Number.isFinite(seconds)
    ? seconds * 1000
    : Date.parse(raw) - Date.now();

  if (!Number.isFinite(retryAfterMs) || retryAfterMs < 0 || retryAfterMs > maxRetryAfterMs) {
    return undefined;
  }

  return retryAfterMs;
}

function isAuthStatus(status) {
  return status === 401 || status === 403;
}

function isAuthCode(code) {
  return ["UNAUTHENTICATED", "PERMISSION_DENIED", "INVALID_API_KEY"].includes(code);
}

function isQuotaError(status, code, message) {
  return (
    code === "RESOURCE_EXHAUSTED" ||
    code === "QUOTA_EXCEEDED" ||
    code === "INSUFFICIENT_QUOTA" ||
    message.includes("insufficient quota") ||
    message.includes("quota exceeded") ||
    message.includes("quota has been exceeded") ||
    (status === 429 && message.includes("quota"))
  );
}

function isRateLimitError(status, code, message) {
  return (
    status === 429 ||
    code === "RATE_LIMIT_EXCEEDED" ||
    code === "TOO_MANY_REQUESTS" ||
    message.includes("rate limit")
  );
}

function isTimeoutError(status, code, message, error) {
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

function isUnavailableError(status, code) {
  return (
    [500, 502, 503, 504].includes(status) ||
    ["INTERNAL", "UNAVAILABLE", "SERVICE_UNAVAILABLE"].includes(code)
  );
}

function isNetworkError(code) {
  return [
    "ECONNREFUSED",
    "ECONNRESET",
    "ENOTFOUND",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "EAI_AGAIN",
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT"
  ].includes(code);
}

function isInvalidRequestError(status, code, message) {
  return (
    status === 400 ||
    code === "INVALID_ARGUMENT" ||
    code === "BAD_REQUEST" ||
    code === "UNSUPPORTED_MODEL" ||
    message.includes("unsupported model") ||
    message.includes("invalid request")
  );
}
