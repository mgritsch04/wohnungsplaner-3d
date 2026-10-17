import { beforeEach, describe, expect, it } from 'vitest';
import { BUDGET_GROUPING_STORAGE_KEY, readStoredBudgetGrouping, useBudgetGroupStore } from './budgetGroupStore';

describe('Budget-Gruppierung als Geräte-Einstellung (#206)', () => {
  beforeEach(() => {
    localStorage.clear();
    useBudgetGroupStore.setState({ grouping: 'category' });
  });

  it('ohne gespeicherte Wahl: nach Kategorie; ungültige Werte werden ignoriert', () => {
    expect(readStoredBudgetGrouping()).toBe('category');
    localStorage.setItem(BUDGET_GROUPING_STORAGE_KEY, 'quatsch');
    expect(readStoredBudgetGrouping()).toBe('category');
  });

  it('merkt sich die Wahl im Store und im localStorage', () => {
    useBudgetGroupStore.getState().setGrouping('room');
    expect(useBudgetGroupStore.getState().grouping).toBe('room');
    expect(localStorage.getItem(BUDGET_GROUPING_STORAGE_KEY)).toBe('room');
    expect(readStoredBudgetGrouping()).toBe('room');
  });
});
