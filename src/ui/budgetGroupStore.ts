import { create } from 'zustand';

/**
 * Grouping of the budget list (#206): by category, retailer or room. Kept outside the panel,
 * so it survives the panel being closed and reopened (dragging furniture switches the right
 * panel to the properties), and remembered in localStorage as a device setting (not part of
 * the project); storage errors are ignored.
 */
export type BudgetGrouping = 'category' | 'retailer' | 'room';

export const BUDGET_GROUPING_STORAGE_KEY = 'wohnungsplaner-budget-grouping';

const VALUES: BudgetGrouping[] = ['category', 'retailer', 'room'];

/** Stored choice; missing, invalid or unreadable storage yields 'category'. */
export function readStoredBudgetGrouping(): BudgetGrouping {
  try {
    const raw = localStorage.getItem(BUDGET_GROUPING_STORAGE_KEY);
    return VALUES.includes(raw as BudgetGrouping) ? (raw as BudgetGrouping) : 'category';
  } catch {
    return 'category';
  }
}

interface BudgetGroupStore {
  grouping: BudgetGrouping;
  setGrouping: (g: BudgetGrouping) => void;
}

export const useBudgetGroupStore = create<BudgetGroupStore>((set) => ({
  grouping: readStoredBudgetGrouping(),
  setGrouping: (grouping) => {
    set({ grouping });
    try {
      localStorage.setItem(BUDGET_GROUPING_STORAGE_KEY, grouping);
    } catch {
      // private mode / blocked storage: keep the choice for this session only
    }
  },
}));
