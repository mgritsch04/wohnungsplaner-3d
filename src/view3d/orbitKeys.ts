import * as THREE from 'three';
import type { ViewMode } from '../store/uiStore';

/**
 * Keyboard navigation of the 3D overview (#132): W A S D / arrow keys move the camera
 * (and its pivot) in the floor plane, relative to the viewing direction. Matched by
 * `e.code`, so the keys sit in the same place on every keyboard layout.
 * Value = [right, forward].
 */
export const ORBIT_MOVE_KEYS: Record<string, readonly [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

/** Shift held: move this much faster. */
export const ORBIT_FAST_FACTOR = 2.5;

let pointerOver3d = false;
/** The scene reports whether the mouse is over the 3D view (decides the keys in the split view). */
export function setPointerOver3d(over: boolean) {
  pointerOver3d = over;
}

export interface OrbitKeyContext {
  viewMode: ViewMode;
  cameraMode: 'orbit' | 'walk';
  /** A furniture item is selected: the arrow keys nudge it instead (as before). */
  furnitureSelected: boolean;
  /** Before/after comparison is shown: A / B switch the side there. */
  comparing: boolean;
  /** Mouse over the 3D view (only relevant for the split view). */
  pointerOver?: boolean;
}

/**
 * Whether a key press moves the overview camera. In the 3D-only view always, in the split
 * view only while the mouse is over the 3D side – otherwise W stays the wall tool of the plan.
 */
export function orbitKeyMoves(code: string, ctx: OrbitKeyContext): boolean {
  if (!(code in ORBIT_MOVE_KEYS)) return false;
  if (ctx.cameraMode !== 'orbit' || ctx.viewMode === '2d') return false;
  if (ctx.viewMode !== '3d' && !(ctx.pointerOver ?? pointerOver3d)) return false;
  const arrow = code.startsWith('Arrow');
  if (arrow && ctx.furnitureSelected) return false;
  if (!arrow && ctx.comparing) return false;
  return true;
}

/** Sum of the held keys as [right, forward], each clamped to -1 … 1. */
export function orbitKeyInput(held: Iterable<string>): [number, number] {
  let x = 0;
  let y = 0;
  for (const code of held) {
    const v = ORBIT_MOVE_KEYS[code];
    if (!v) continue;
    x += v[0];
    y += v[1];
  }
  return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, y))];
}

/**
 * Speed in m/s: proportional to the camera distance, so moving feels the same close up
 * and from far away.
 */
export function orbitKeySpeed(distance: number, fast: boolean): number {
  return Math.max(1.5, distance * 0.6) * (fast ? ORBIT_FAST_FACTOR : 1);
}

/**
 * World offset in the floor plane for an input [right, forward] and a step length: forward is
 * the viewing direction projected onto the floor (straight down falls back to the camera's up).
 */
export function orbitPlaneStep(camera: THREE.Camera, input: readonly [number, number], step: number): THREE.Vector3 {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 1, 0).applyQuaternion(camera.quaternion).setY(0);
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
  forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const out = right.multiplyScalar(input[0]).addScaledVector(forward, input[1]);
  if (out.lengthSq() > 1) out.normalize();
  return out.multiplyScalar(step);
}
