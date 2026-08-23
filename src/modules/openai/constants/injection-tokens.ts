export const OPENAI_CLIENT = 'OPENAI_CLIENT';
// AI-059 — a separate SDK instance used only by OpenaiService.executeModeration(), so ModerationModule
// never needs to know which upstream actually serves moderation. Resolves to OPENAI_CLIENT itself
// (same instance) when MODERATION_API_KEY is unset.
export const MODERATION_CLIENT = 'MODERATION_CLIENT';
