export const EmbeddingStatus = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type EmbeddingStatus = (typeof EmbeddingStatus)[keyof typeof EmbeddingStatus];
