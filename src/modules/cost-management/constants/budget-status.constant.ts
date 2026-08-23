// Derived budget status for the GET /cost/budgets/:userId response (spec §6.2) — computed from
// a BudgetCheckResult, never stored.
export const BudgetStatus = {
  WITHIN_BUDGET: 'within_budget',
  APPROACHING_LIMIT: 'approaching_limit',
  EXCEEDED: 'exceeded',
} as const;

export type BudgetStatus = (typeof BudgetStatus)[keyof typeof BudgetStatus];
