import type { StreamEvent } from '../types/ai-chat.types';

// Spec §6.3's exact frame shape: `event: <type>\ndata: <json>\n\n`. Pulled out of the controller
// so it's testable as a pure function, independent of the SSE transport/transport-disconnect
// concerns (per AI-033's testing notes).
export function formatSseFrame(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
