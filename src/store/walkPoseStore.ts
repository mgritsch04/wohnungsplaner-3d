import { create } from 'zustand';

/**
 * Position and viewing direction of the first-person camera (#19), published by the
 * walkthrough so the 2D plan can show "you are here". Updated only on noticeable
 * changes (≥ 1 cm or ≈ 1°) to keep re-renders cheap.
 */
export interface WalkPose {
  x: number;
  y: number;
  /** camera yaw (radians); looking direction in plan coordinates = (−sin yaw, −cos yaw) */
  yaw: number;
}

export const useWalkPose = create<{ pose: WalkPose | null; setPose: (p: WalkPose | null) => void }>((set, get) => ({
  pose: null,
  setPose: (p) => {
    const c = get().pose;
    if (p && c && Math.hypot(p.x - c.x, p.y - c.y) < 0.01 && Math.abs(p.yaw - c.yaw) < 0.017) return;
    set({ pose: p });
  },
}));
