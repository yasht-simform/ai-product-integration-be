import type { Request } from 'express';

// Shared Phase 4 identity convention (spec §14: real auth is out of scope for this phase) —
// `x-user-id` header first, falling back to `body.userId`. Used by both ModerationGuard (AI-061)
// and CostBudgetGuard (AI-066) so the two guards resolve identity identically.
export function resolveUserId(request: Request): string | undefined {
  const header = request.headers['x-user-id'];
  if (typeof header === 'string') return header;
  if (Array.isArray(header)) return header[0];

  const body = request.body as Record<string, unknown> | undefined;
  const bodyUserId = body?.['userId'];
  return typeof bodyUserId === 'string' ? bodyUserId : undefined;
}
