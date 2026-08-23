export const DocumentCategory = {
  GUIDE: 'guide',
  FAQ: 'faq',
  DOCS: 'docs',
  TUTORIAL: 'tutorial',
  CHANGELOG: 'changelog',
} as const;

export type DocumentCategory = (typeof DocumentCategory)[keyof typeof DocumentCategory];
