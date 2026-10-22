import { create } from 'zustand';

interface PerformanceStore {
  /** Upper bound for the device pixel ratio, lowered on sustained low frame rates. */
  dprCap: number;
  /** Count of sustained declines since the last quality change. */
  declines: number;
  /** Suggest switching to planning mode (set after repeated declines). */
  suggestPlanning: boolean;
  cutaway: boolean;
  /** Outside view of the building (#92), a sub-mode of the overview camera. */
  exterior: boolean;
  cameraReset: number;
  decline: () => void;
  incline: () => void;
  dismissSuggestion: () => void;
  setCutaway: (v: boolean) => void;
  setExterior: (v: boolean) => void;
  resetCamera: () => void;
}

export const usePerformanceStore = create<PerformanceStore>((set, get) => ({
  dprCap: 2,
  declines: 0,
  suggestPlanning: false,
  cutaway: false,
  exterior: false,
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
  setCutaway: (cutaway) => set(cutaway && get().exterior ? { cutaway, exterior: false, cameraReset: get().cameraReset + 1 } : { cutaway }),
  // the section cut and the outside view exclude each other; re-fit the camera for the new view
  setExterior: (exterior) => set({ exterior, cutaway: exterior ? false : get().cutaway, cameraReset: get().cameraReset + 1 }),
  resetCamera: () => set({ cameraReset: get().cameraReset + 1 }),
}));
