// This enum only covers native OpenAI models. When OPENAI_BASE_URL points at an
// OpenAI-compatible provider (OpenRouter, Groq, Together AI, etc.), request DTOs accept
// arbitrary provider-specific model strings (e.g. `nvidia/nemotron-3-ultra-550b-a55b:free`)
// directly in the `model` field — they don't need to be added here.
export enum OpenAIModel {
  GPT_4 = 'gpt-4',
  GPT_4O = 'gpt-4o',
  GPT_4O_MINI = 'gpt-4o-mini',
}
