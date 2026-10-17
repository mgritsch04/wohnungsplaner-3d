/**
 * Touch input for the walkthrough on phones (#164). The on-screen stick (TouchWalkPad) writes
 * the walking direction here; WalkControls reads it every frame. x = right, z = forward,
 * both in [-1, 1] – the distance from the stick centre sets the speed.
 */
export const touchWalk = { x: 0, z: 0 };

export function setTouchWalk(x: number, z: number) {
  touchWalk.x = x;
  touchWalk.z = z;
}

/** Look speed for a finger drag relative to the mouse (a finger travels fewer pixels). */
export const TOUCH_LOOK_FACTOR = 1.6;

/** Stick vector from a thumb offset (px) and the stick radius: clamped to the circle, small dead zone. */
export function stickVector(dx: number, dy: number, radius: number): { x: number; z: number } {
  const len = Math.hypot(dx, dy);
  if (len < radius * 0.12) return { x: 0, z: 0 };
  const k = len > radius ? radius / len : 1;
  return { x: (dx * k) / radius, z: (-dy * k) / radius };
}

/** Walk actions without a keyboard (#164); WalkControls fills them while walking. */
export const walkCommands: { toggleCarry: (() => void) | null } = { toggleCarry: null };
