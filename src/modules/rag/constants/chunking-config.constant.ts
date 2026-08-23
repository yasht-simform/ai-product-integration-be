export const CHUNKING_CONFIG = {
  chunkSize: 500,
  chunkOverlap: 50,
  minChunkSize: 100,
  separators: ['\n\n', '\n', '. ', ' ', ''],
} as const;
