import { computeBudget } from '../budget/budget';
import type { Furniture } from '../model/schema';

/** Total of the budget for these pieces (test helper). */
export const budgetOf = (furniture: Furniture[]): number => computeBudget(furniture).total;
