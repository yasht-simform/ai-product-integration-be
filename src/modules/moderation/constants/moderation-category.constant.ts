export const ModerationCategory = {
  HATE: 'hate',
  HATE_THREATENING: 'hate/threatening',
  HARASSMENT: 'harassment',
  HARASSMENT_THREATENING: 'harassment/threatening',
  SELF_HARM: 'self-harm',
  SELF_HARM_INTENT: 'self-harm/intent',
  SELF_HARM_INSTRUCTIONS: 'self-harm/instructions',
  SEXUAL: 'sexual',
  SEXUAL_MINORS: 'sexual/minors',
  VIOLENCE: 'violence',
  VIOLENCE_GRAPHIC: 'violence/graphic',
} as const;

export type ModerationCategory = (typeof ModerationCategory)[keyof typeof ModerationCategory];
