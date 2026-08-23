export const QaComplexity = {
  SIMPLE: 'simple',
  MULTI_STEP: 'multi-step',
  EDGE_CASE: 'edge-case',
} as const;

export type QaComplexity = (typeof QaComplexity)[keyof typeof QaComplexity];
