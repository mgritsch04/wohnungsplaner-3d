import { create } from 'zustand';
import type { LuxMode } from '../model/lux';

interface LuxStore {
  /** Light layer (lux estimate, #360) shown in the 2D plan. */
  on: boolean;
  mode: LuxMode;
  setOn: (on: boolean) => void;
  setMode: (mode: LuxMode) => void;
}

export const useLuxStore = create<LuxStore>((set) => ({
  on: false,
  mode: 'evening',
  setOn: (on) => set({ on }),
  setMode: (mode) => set({ mode }),
}));
