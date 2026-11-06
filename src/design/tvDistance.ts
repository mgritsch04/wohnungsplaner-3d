/**
 * How far a sofa stands from its television (W5, C3), one rule for the solver and the walk-through.
 * The eyes of someone sitting are 1.2–1.6 times the screen diagonal away, up to 1.8 times still
 * good (55″: 1.7–2.2 m, up to 2.5 m). Measured, like the walk-through does, from the middle of the
 * screen to the front edge of the sofa: the eyes sit about 35 cm behind that edge.
 *
 * The walk-through used to allow 1.5–2.5 times the diagonal from the sofa's edge (55″: up to
 * 3.5 m to the eyes), so a sofa 3 m off the TV at the far wall passed while the image review
 * called it too far (test flat A, 6.11.).
 */
export const TV_EYE = { lo: 1.2, hi: 1.8 };
/** Eyes behind the front edge of the seat (m). */
export const EYE_BEHIND_FRONT = 0.35;

/** Screen diagonal (m) of a television `width` m wide (16:9). */
export const tvDiagonal = (width: number) => width / 0.872;

/** Comfortable distance (m) from the middle of the screen to the sofa's front edge. */
export function tvRange(width: number): { lo: number; hi: number } {
  const diag = tvDiagonal(width);
  return { lo: TV_EYE.lo * diag - EYE_BEHIND_FRONT, hi: TV_EYE.hi * diag - EYE_BEHIND_FRONT };
}
