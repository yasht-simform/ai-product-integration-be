export const BudgetPeriod = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
} as const;

export type BudgetPeriod = (typeof BudgetPeriod)[keyof typeof BudgetPeriod];
