import { create } from 'zustand';

/** UI-only state of notes and task lists (not saved in the project). */
interface PlanningState {
  /** Pin whose note is open in the plan. */
  openNoteId: string | null;
  hideDone: boolean;
  setOpenNote: (id: string | null) => void;
  setHideDone: (v: boolean) => void;
}

export const usePlanningStore = create<PlanningState>((set) => ({
  openNoteId: null,
  hideDone: false,
  setOpenNote: (openNoteId) => set({ openNoteId }),
  setHideDone: (hideDone) => set({ hideDone }),
}));
