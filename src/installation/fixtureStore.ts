import { create } from 'zustand';
import type { FixtureKind } from '../model/schema';

/** Installation point waiting to be placed by a click next to a wall in the 2D plan (#64, #81). */
interface FixtureStore {
  placing: FixtureKind | null;
  setPlacing: (k: FixtureKind | null) => void;
}

export const useFixtureStore = create<FixtureStore>((set) => ({
  placing: null,
  setPlacing: (placing) => set({ placing }),
}));
