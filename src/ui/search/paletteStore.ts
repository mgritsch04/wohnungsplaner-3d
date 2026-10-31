import { create } from 'zustand';

/** Open state of the feature search (#461) and how a side panel is shown on the phone (sheet). */
export const usePaletteStore = create<{
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Set by the app on the phone: opens the sheet of the left/right panel. */
  onShowPanel: ((side: 'left' | 'right') => void) | null;
}>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  onShowPanel: null,
}));
