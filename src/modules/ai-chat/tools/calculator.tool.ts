import { evaluate } from 'mathjs';

// Pathological input insurance (e.g. deeply nested expressions) — mathjs's evaluate() already
// avoids arbitrary code execution, this just caps how much work a single call can demand.
const MAX_EXPRESSION_LENGTH = 200;

export interface CalculatorArgs {
  expression: string;
}

export interface CalculatorResult {
  result: number;
}

export function executeCalculator(args: CalculatorArgs): CalculatorResult {
  const { expression } = args;

  if (typeof expression !== 'string' || expression.trim().length === 0) {
    throw new Error('expression is required');
  }
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new Error(`Expression exceeds maximum length of ${MAX_EXPRESSION_LENGTH} characters`);
  }

  let value: unknown;
  try {
    value = evaluate(expression);
  } catch {
    throw new Error(`Invalid expression: ${expression}`);
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expression did not evaluate to a finite number: ${expression}`);
  }

  return { result: value };
}
