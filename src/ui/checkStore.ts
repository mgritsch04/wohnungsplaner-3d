import { create } from 'zustand';
import type { PlanCheckResult } from '../model/planCheck';
import type { Vec2 } from '../model/vec';

interface CheckStore {
  /** Result of the last Wohnungs-Check run (#357); null until the first run. */
  result: PlanCheckResult | null;
  setResult: (r: PlanCheckResult | null) => void;
  /** Ring in the 2D plan around the finding the user jumped to. */
  focus: { id: string; at: Vec2 } | null;
  setFocus: (f: { id: string; at: Vec2 } | null) => void;
}

export const useCheckStore = create<CheckStore>((set) => ({
  result: null,
  setResult: (result) => set({ result, focus: null }),
  focus: null,
  setFocus: (focus) => set({ focus }),
}));
