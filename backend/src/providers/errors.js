export const quotaExhaustedMessage =
  "AI service is temporarily unavailable because API quota is exhausted.";

export const authenticationFailedMessage =
  "AI service is temporarily unavailable because provider authentication failed.";

export const providerUnavailableMessage =
  "AI service is temporarily unavailable. Please try again later.";

export const providerTimeoutMessage =
  "AI service timed out. Please try again in a moment.";

export class AIProviderError extends Error {
  constructor(message, { status = 500, cause } = {}) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
    this.publicMessage = message;
    this.cause = cause;
  }
}
