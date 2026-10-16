import { create } from 'zustand';

interface PerformanceStore {
  /** Upper bound for the device pixel ratio, lowered on sustained low frame rates. */
  dprCap: number;
  /** Count of sustained declines since the last quality change. */
  declines: number;
  /** Suggest switching to planning mode (set after repeated declines). */
  suggestPlanning: boolean;
  cutaway: boolean;
  cameraReset: number;
  decline: () => void;
  incline: () => void;
  dismissSuggestion: () => void;
  setCutaway: (v: boolean) => void;
  resetCamera: () => void;
}

export const usePerformanceStore = create<PerformanceStore>((set, get) => ({
  dprCap: 2,
  declines: 0,
  suggestPlanning: false,
  cutaway: false,
  cameraReset: 0,
  decline: () => {
    const { dprCap, declines } = get();
    const next = Math.max(0.75, dprCap - 0.5);
    set({ dprCap: next, declines: declines + 1, suggestPlanning: declines + 1 >= 2 && next <= 1 });
  },
  incline: () => {
    const { dprCap } = get();
    set({ dprCap: Math.min(2, dprCap + 0.25) });
  },
  dismissSuggestion: () => set({ suggestPlanning: false, declines: 0 }),
  setCutaway: (cutaway) => set({ cutaway }),
  resetCamera: () => set({ cameraReset: get().cameraReset + 1 }),
}));
