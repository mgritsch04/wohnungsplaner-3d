import { create } from 'zustand';
import type { Vec2 } from '../model/vec';

/**
 * Sight lines (#89) – display state only, not part of the project (no schema change).
 * `point` null = default viewpoint (the entrance).
 */
interface SightStore {
  show: boolean;
  point: Vec2 | null;
  /** Visible share of the floor area, reported by the overlay for the panel. */
  share: number | null;
  setShow: (show: boolean) => void;
  setPoint: (point: Vec2 | null) => void;
  setShare: (share: number | null) => void;
}

export const useSightStore = create<SightStore>((set) => ({
  show: false,
  point: null,
  share: null,
  setShow: (show) => set({ show }),
  setPoint: (point) => set({ point }),
  setShare: (share) => set({ share }),
}));
