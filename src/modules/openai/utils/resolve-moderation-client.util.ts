import OpenAI from 'openai';

/**
 * AI-059 — OpenRouter (this app's default OPENAI_BASE_URL) does not proxy `POST /moderations`
 * (live-verified: 404 with a text/html Next.js 404 page, not a JSON API error). When
 * `MODERATION_API_KEY` is configured, moderation calls should go to a separate client instance
 * pointed at a provider that does support the endpoint (typically real OpenAI); otherwise the
 * primary client is reused unchanged.
 */
export function resolveModerationClient(params: {
  moderationApiKey: string | undefined;
  moderationApiBaseUrl: string | undefined;
  timeoutMs: number | undefined;
  primaryClient: OpenAI;
}): OpenAI {
  if (!params.moderationApiKey) {
    return params.primaryClient;
  }

  return new OpenAI({
    apiKey: params.moderationApiKey,
    baseURL: params.moderationApiBaseUrl || undefined,
    timeout: params.timeoutMs,
  });
}
