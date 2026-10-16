/** Walkthrough posture (#20 ducking, #78 sitting): the eye height the camera moves towards. */
export const DUCK_FACTOR = 0.6;
export const DUCK_MIN_EYE = 0.8;
/** Walking speed factor while crouching or seated. */
export const DUCK_SPEED = 0.5;

/** Walking speed factor for the posture: crouched or seated walks slower. */
export function walkSpeedFactor(p: { sitting: boolean; ducking: boolean }): number {
  return p.sitting || p.ducking ? DUCK_SPEED : 1;
}

export function goalEyeHeight(p: { eye: number; sitEye: number; sitting: boolean; ducking: boolean }): number {
  // seated: ducking makes no sense and is ignored
  if (p.sitting) return p.sitEye;
  return p.ducking ? Math.max(DUCK_MIN_EYE, p.eye * DUCK_FACTOR) : p.eye;
}
