// `@Type(() => Boolean)` alone is unsafe for a query-string boolean: the `Boolean` constructor
// coerces ANY non-empty string — including the literal 'false' — to `true`, silently inverting
// the filter. Because main.ts's global pipe sets `enableImplicitConversion: true`, that naive
// `Boolean(value)` coercion runs on a boolean-typed field BEFORE any `@Transform` callback sees
// it (class-transformer's PLAIN_TO_CLASS order: implicit primitive conversion first, custom
// @Transform second) — so a `@Transform` that reads its own `value` parameter receives the
// already-wrong result. Reading `obj[key]` instead (the original, untransformed source value)
// bypasses that pre-coercion and parses the real raw string. Discovered live in AI-071
// (`?isFlagged=false` matched flagged rows); use this with `@Transform(transformQueryBoolean)`
// on every query-string boolean DTO field.
export function transformQueryBoolean({
  value,
  obj,
  key,
}: {
  value: unknown;
  obj: Record<string, unknown>;
  key: string;
}): unknown {
  const raw = obj[key];
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return value;
}
