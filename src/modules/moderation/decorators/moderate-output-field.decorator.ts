import { SetMetadata } from '@nestjs/common';

export const MODERATE_OUTPUT_FIELD_KEY = 'moderateOutputField';

export interface ModerateOutputFieldMetadata {
  field: string;
  source?: string;
}

// Route-level hint for OutputModerationInterceptor: which response field carries the AI's
// text, and which `source` to record on the moderation_logs row. Interceptor falls back to
// 'content'/'standalone' when absent.
export const ModerateOutputField = (field: string, source?: string) =>
  SetMetadata(MODERATE_OUTPUT_FIELD_KEY, { field, source });
