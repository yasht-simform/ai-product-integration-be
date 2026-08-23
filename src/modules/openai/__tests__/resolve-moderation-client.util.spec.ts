import OpenAI from 'openai';

import { resolveModerationClient } from '../utils/resolve-moderation-client.util';

describe('resolveModerationClient() (AI-059)', () => {
  it('returns the primary client unchanged when no MODERATION_API_KEY is configured', () => {
    const primaryClient = new OpenAI({ apiKey: 'sk-primary' });

    const result = resolveModerationClient({
      moderationApiKey: undefined,
      moderationApiBaseUrl: undefined,
      timeoutMs: 30000,
      primaryClient,
    });

    expect(result).toBe(primaryClient);
  });

  it('constructs a separate client when MODERATION_API_KEY is configured', () => {
    const primaryClient = new OpenAI({
      apiKey: 'sk-primary',
      baseURL: 'https://openrouter.ai/api/v1',
    });

    const result = resolveModerationClient({
      moderationApiKey: 'sk-moderation-only',
      moderationApiBaseUrl: undefined,
      timeoutMs: 30000,
      primaryClient,
    });

    expect(result).not.toBe(primaryClient);
    expect(result.apiKey).toBe('sk-moderation-only');
    // No moderationApiBaseUrl override → falls through to the OpenAI SDK's own default base URL,
    // never inheriting the primary client's (e.g. OpenRouter) baseURL.
    expect(result.baseURL).not.toBe('https://openrouter.ai/api/v1');
  });

  it('applies moderationApiBaseUrl when both fallback values are configured', () => {
    const primaryClient = new OpenAI({ apiKey: 'sk-primary' });

    const result = resolveModerationClient({
      moderationApiKey: 'sk-moderation-only',
      moderationApiBaseUrl: 'https://api.openai.com/v1',
      timeoutMs: 15000,
      primaryClient,
    });

    expect(result.baseURL).toBe('https://api.openai.com/v1');
  });
});
