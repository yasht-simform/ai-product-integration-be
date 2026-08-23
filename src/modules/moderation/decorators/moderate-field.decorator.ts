import { SetMetadata } from '@nestjs/common';

export const MODERATE_FIELD_KEY = 'moderateField';

export interface ModerateFieldMetadata {
  field: string;
  source?: string;
}

// Route-level hint for ModerationGuard: which body field to moderate, and which `source`
// to record on the moderation_logs row. Guard falls back to 'content'/'standalone' when absent.
export const ModerateField = (field: string, source?: string) =>
  SetMetadata(MODERATE_FIELD_KEY, { field, source });
