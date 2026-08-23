export const RETRY_CONFIG = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 32000,
  jitterFactor: 0.5,
  circuitBreaker: {
    failureThreshold: 5,
    cooldownMs: 60000,
  },
  retryableStatusCodes: [429, 500, 503, 529],
  permanentStatusCodes: [400, 401, 403, 404],
};
