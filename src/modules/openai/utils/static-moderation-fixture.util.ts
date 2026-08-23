import { readFileSync } from 'fs';
import { join } from 'path';

import type OpenAI from 'openai';

interface ModerationFixtureEntry {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
  category_applied_input_types: Record<string, string[]>;
}

interface StaticModerationFixture {
  model: string;
  flaggedKeywords: string[];
  flagged: ModerationFixtureEntry;
  clean: ModerationFixtureEntry;
}

let cachedFixture: StaticModerationFixture | undefined;

function loadFixture(): StaticModerationFixture {
  cachedFixture ??= JSON.parse(
    readFileSync(join(__dirname, '../fixtures/static-moderation-responses.json'), 'utf-8'),
  ) as StaticModerationFixture;
  return cachedFixture;
}

function isFlaggedInput(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

/**
 * AI-059 static mode — builds a canned, OpenAI-shaped moderation response with no network call,
 * for exercising the moderation wiring end-to-end when no billable API quota is available
 * (`MODERATION_STATIC_MODE=true`). A simple keyword match against each input decides flagged vs
 * clean per item, so both branches of the real pipeline stay exercisable through the real HTTP
 * surface. Never consulted unless the flag is on — `OpenaiService.executeModeration()` is the only
 * caller.
 */
export function buildStaticModerationResponse(
  input: string | string[],
): OpenAI.Moderations.ModerationCreateResponse {
  const fixture = loadFixture();
  const inputs = Array.isArray(input) ? input : [input];
  const results = inputs.map((text) =>
    isFlaggedInput(text, fixture.flaggedKeywords) ? fixture.flagged : fixture.clean,
  );

  return {
    id: 'static-fixture',
    model: fixture.model,
    results,
    // The fixture's category maps are a small, curated subset — not all 13 of OpenAI's strict
    // Moderation.categories keys — so this needs the double cast, same convention used elsewhere
    // in this codebase for a narrower-than-SDK shape (e.g. PineconeService's RecordMetadata cast).
  } as unknown as OpenAI.Moderations.ModerationCreateResponse;
}
