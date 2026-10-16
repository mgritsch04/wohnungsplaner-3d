import { create } from 'zustand';
import type { V3 } from './tapeMeasure';

/** 3D tape measure (#88): display state only – never stored in the project. */
interface TapeStore {
  active: boolean;
  /** First point of a measurement in progress. */
  pending: V3 | null;
  items: { id: number; a: V3; b: V3 }[];
  toggle: () => void;
  setActive: (active: boolean) => void;
  addPoint: (p: V3) => void;
  clear: () => void;
}

let nextId = 1;

export const useTapeStore = create<TapeStore>((set, get) => ({
  active: false,
  pending: null,
  items: [],
  toggle: () => get().setActive(!get().active),
  setActive: (active) => set(active ? { active } : { active, pending: null }),
  addPoint: (p) => {
    const { pending, items } = get();
    if (!pending) set({ pending: p });
    else set({ pending: null, items: [...items, { id: nextId++, a: pending, b: p }] });
  },
  clear: () => set({ pending: null, items: [] }),
}));
