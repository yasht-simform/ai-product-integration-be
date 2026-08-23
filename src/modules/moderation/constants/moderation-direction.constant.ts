export const ModerationDirection = {
  INPUT: 'input',
  OUTPUT: 'output',
} as const;

export type ModerationDirection = (typeof ModerationDirection)[keyof typeof ModerationDirection];
