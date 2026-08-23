export const ModerationAction = {
  ALLOWED: 'allowed',
  BLOCKED: 'blocked',
  REPLACED: 'replaced',
} as const;

export type ModerationAction = (typeof ModerationAction)[keyof typeof ModerationAction];
