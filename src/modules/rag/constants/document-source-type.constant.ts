export const DocumentSourceType = {
  PDF: 'pdf',
  TXT: 'txt',
  MD: 'md',
  GENERATED: 'generated',
} as const;

export type DocumentSourceType = (typeof DocumentSourceType)[keyof typeof DocumentSourceType];
