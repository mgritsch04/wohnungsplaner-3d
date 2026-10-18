/**
 * Gentle head bob while walking (#263): the eyes dip a little with every step, which helps the
 * sense of depth. Fades in when walking starts and out when standing still.
 */
/** Depth of the dip per step (m). */
export const BOB_DEPTH = 0.012;
/** Length of one step (m): one dip per step. */
export const STEP_LENGTH = 0.7;

export interface BobState {
  phase: number;
  /** 0 = standing, 1 = walking. */
  amount: number;
}

export const createBob = (): BobState => ({ phase: 0, amount: 0 });

/** Advance by the distance walked in this frame; returns the height offset (m, ≤ 0). */
export function stepBob(s: BobState, moved: number, dt: number): number {
  const goal = moved > 1e-5 ? 1 : 0;
  s.amount += (goal - s.amount) * (1 - Math.exp(-dt / 0.15));
  if (s.amount < 1e-3 && goal === 0) {
    s.amount = 0;
    s.phase = 0;
  }
  s.phase = (s.phase + (2 * Math.PI * moved) / STEP_LENGTH) % (2 * Math.PI);
  return (-BOB_DEPTH * s.amount * (1 - Math.cos(s.phase))) / 2;
}
