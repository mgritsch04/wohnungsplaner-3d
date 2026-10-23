import { create } from 'zustand';
import type { CameraBookmark, Vec3 } from '../model/schema';
import { newId } from '../model/ids';
import { roundMm } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { usePerformanceStore } from './performanceStore';
import { motionReduced } from '../ui/motionPreference';

/**
 * Camera bookmarks (#55): saved 3D viewpoints in the project, jumped to from the
 * "Ansichten" menu or with Alt+1 … Alt+9.
 *
 * The cameras live inside the 3D canvas; they register a small "rig" here (get/set the pose),
 * the menu and the keyboard only talk to this module. The transition itself runs in
 * `CameraBookmarkDriver` (inside the canvas, per frame).
 */

/** Duration of the transition to a bookmark (ms); 0 with `prefers-reduced-motion`. */
export const JUMP_DURATION_MS = 500;
/** Number of bookmarks reachable by keyboard (Alt+1 … Alt+9). */
export const BOOKMARK_KEYS = 9;
/** Pitch limit of the walkthrough camera (same as WalkControls). */
const PITCH_LIMIT = 1.4;

/** A camera pose independent of the project (what a bookmark stores without id/name). */
export interface CameraView {
  mode: 'orbit' | 'walk';
  position: Vec3;
  target: Vec3;
  eyeHeight?: number;
}

/** Orbit camera: position + orbit target. */
export interface OrbitRig {
  get: () => { position: Vec3; target: Vec3 };
  set: (position: Vec3, target: Vec3) => void;
}

/** Walkthrough camera: plan position (x, z), eye height and viewing angles. */
export interface WalkPoseFull {
  x: number;
  z: number;
  eye: number;
  yaw: number;
  pitch: number;
}
export interface WalkRig {
  get: () => WalkPoseFull;
  set: (p: WalkPoseFull) => void;
}

interface PendingJump {
  bookmark: CameraBookmark;
  /** Pose before the jump (for a smooth transition, also across a mode switch). */
  from: CameraView | null;
}

interface CameraRigStore {
  orbit: OrbitRig | null;
  walk: WalkRig | null;
  pending: PendingJump | null;
  /** The orbit camera does not re-fit itself until then (performance.now()), see `orbitFitSuppressed`. */
  suppressFitUntil: number;
}

export const useCameraRig = create<CameraRigStore>(() => ({ orbit: null, walk: null, pending: null, suppressFitUntil: 0 }));

/** Registers the active orbit camera; returns the unregister function. */
export function registerOrbitRig(rig: OrbitRig): () => void {
  useCameraRig.setState({ orbit: rig });
  return () => {
    if (useCameraRig.getState().orbit === rig) useCameraRig.setState({ orbit: null });
  };
}

/** Registers the active walkthrough camera; returns the unregister function. */
export function registerWalkRig(rig: WalkRig): () => void {
  useCameraRig.setState({ walk: rig });
  return () => {
    if (useCameraRig.getState().walk === rig) useCameraRig.setState({ walk: null });
  };
}

/** True while a jump runs: the orbit camera must not "fit" over it (mount, delayed re-fit). */
export function orbitFitSuppressed(now = performance.now()): boolean {
  return now < useCameraRig.getState().suppressFitUntil;
}

// ---------- geometry helpers (pure) ----------

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const roundV = (v: Vec3): Vec3 => v3(roundMm(v.x), roundMm(v.y), roundMm(v.z));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpV = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t));

/** Smooth start and end of the transition. */
export function easeInOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Interpolates an angle along the shorter way round. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

/** Viewing angles of the walkthrough camera (YXZ order) looking from `position` to `target`. */
export function anglesOf(position: Vec3, target: Vec3): { yaw: number; pitch: number } {
  const dx = target.x - position.x;
  const dy = target.y - position.y;
  const dz = target.z - position.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-9 && Math.abs(dy) < 1e-9) return { yaw: 0, pitch: 0 };
  return {
    yaw: flat < 1e-9 ? 0 : Math.atan2(-dx, -dz),
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Math.atan2(dy, flat))),
  };
}

/** Point `distance` metres ahead of `position` in the direction given by yaw/pitch. */
export function pointAhead(position: Vec3, yaw: number, pitch: number, distance = 1): Vec3 {
  const c = Math.cos(pitch);
  return v3(position.x - Math.sin(yaw) * c * distance, position.y + Math.sin(pitch) * distance, position.z - Math.cos(yaw) * c * distance);
}

/** Bookmark view from a walkthrough pose (target = 1 m ahead). */
export function viewFromWalk(p: WalkPoseFull): CameraView {
  const position = v3(p.x, p.eye, p.z);
  return { mode: 'walk', position, target: pointAhead(position, p.yaw, p.pitch), eyeHeight: p.eye };
}

/** Walkthrough pose of a view (eye height: stored value, else the camera height). */
export function walkPoseOf(view: CameraView): WalkPoseFull {
  const { yaw, pitch } = anglesOf(view.position, view.target);
  return { x: view.position.x, z: view.position.z, eye: view.eyeHeight ?? view.position.y, yaw, pitch };
}

/**
 * Pose at progress `t` (0…1, already eased) of the transition `from` → `to`.
 * Walk targets are interpolated by angle (no flip through the eye point), orbit targets linearly;
 * a walk start is looked at as if its target were as far away as the orbit target.
 */
export function interpolateView(from: CameraView, to: CameraView, t: number): CameraView {
  if (to.mode === 'walk') {
    const a = walkPoseOf(from);
    const b = walkPoseOf(to);
    return viewFromWalk({
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      eye: lerp(a.eye, b.eye, t),
      yaw: lerpAngle(a.yaw, b.yaw, t),
      pitch: lerp(a.pitch, b.pitch, t),
    });
  }
  let fromTarget = from.target;
  if (from.mode === 'walk') {
    const { yaw, pitch } = anglesOf(from.position, from.target);
    const dist = Math.hypot(to.target.x - to.position.x, to.target.y - to.position.y, to.target.z - to.position.z);
    fromTarget = pointAhead(from.position, yaw, pitch, dist);
  }
  return { mode: 'orbit', position: lerpV(from.position, to.position, t), target: lerpV(fromTarget, to.target, t) };
}

export function prefersReducedMotion(): boolean {
  return motionReduced();
}

// ---------- current camera ----------

/** The current 3D view, or null when no 3D camera is active. */
export function captureCurrentView(): CameraView | null {
  const { orbit, walk } = useCameraRig.getState();
  const mode = useUiStore.getState().cameraMode;
  if (mode === 'walk' && walk) return viewFromWalk(walk.get());
  if (mode === 'orbit' && orbit) {
    const o = orbit.get();
    return { mode: 'orbit', position: o.position, target: o.target };
  }
  return null;
}

// ---------- project operations (one undo step each) ----------

export function normalizeBookmarkName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 100);
}

/** Suggested name for the next bookmark ("Ansicht 3"). */
export function suggestBookmarkName(existing: { name: string }[]): string {
  const names = new Set(existing.map((b) => b.name));
  for (let i = existing.length + 1; ; i++) if (!names.has(`Ansicht ${i}`)) return `Ansicht ${i}`;
}

/** Bookmark from a view (rounded to mm; orbit views remember the section view). */
export function bookmarkFromView(name: string, view: CameraView, cutaway?: boolean): CameraBookmark {
  const b: CameraBookmark = {
    id: newId('view'),
    name: normalizeBookmarkName(name),
    mode: view.mode,
    position: roundV(view.position),
    target: roundV(view.target),
  };
  if (view.mode === 'walk') b.eyeHeight = Math.max(0.5, Math.min(3, roundMm(view.eyeHeight ?? view.position.y)));
  if (view.mode === 'orbit' && cutaway !== undefined) b.cutaway = cutaway;
  return b;
}

/** Saves `view` under `name` (one undo step). Returns the new id, or null for an empty name. */
export function addCameraBookmark(name: string, view: CameraView, cutaway?: boolean): string | null {
  if (!normalizeBookmarkName(name)) return null;
  const b = bookmarkFromView(name, view, cutaway);
  useProjectStore.getState().apply((d) => void d.cameraBookmarks.push(b));
  return b.id;
}

/** Saves the current 3D view (one undo step). */
export function saveCurrentView(name: string): string | null {
  const view = captureCurrentView();
  if (!view) return null;
  return addCameraBookmark(name, view, view.mode === 'orbit' ? usePerformanceStore.getState().cutaway : undefined);
}

/** Renames a bookmark (one undo step; empty or unchanged names are ignored). */
export function renameCameraBookmark(id: string, name: string): boolean {
  const n = normalizeBookmarkName(name);
  const b = useProjectStore.getState().project.cameraBookmarks.find((x) => x.id === id);
  if (!b || !n || n === b.name) return false;
  useProjectStore.getState().apply((d) => {
    const t = d.cameraBookmarks.find((x) => x.id === id);
    if (t) t.name = n;
  });
  return true;
}

/** Deletes a bookmark (one undo step). */
export function deleteCameraBookmark(id: string): boolean {
  if (!useProjectStore.getState().project.cameraBookmarks.some((x) => x.id === id)) return false;
  useProjectStore.getState().apply((d) => void (d.cameraBookmarks = d.cameraBookmarks.filter((x) => x.id !== id)));
  return true;
}

// ---------- jumping ----------

/**
 * Jumps to a bookmark: switches to its camera mode (and section view, if stored) and asks the
 * driver in the canvas for a transition from the current pose.
 */
export function jumpToBookmark(b: CameraBookmark): void {
  const from = captureCurrentView();
  const ui = useUiStore.getState();
  if (ui.viewMode === '2d') ui.setViewMode('split');
  if (b.cutaway !== undefined) usePerformanceStore.getState().setCutaway(b.cutaway);
  if (ui.cameraMode !== b.mode) ui.setCameraMode(b.mode);
  useCameraRig.setState({ pending: { bookmark: b, from }, suppressFitUntil: performance.now() + JUMP_DURATION_MS + 600 });
}

/** Alt+1 … Alt+9: jumps to bookmark `index` (0-based). Returns false when there is none. */
export function jumpToBookmarkIndex(index: number): boolean {
  const b = useProjectStore.getState().project.cameraBookmarks[index];
  if (!b) return false;
  jumpToBookmark(b);
  return true;
}

/** Called by the driver once the pending jump was taken over. */
export function takePendingJump(): PendingJump | null {
  const { pending, orbit, walk } = useCameraRig.getState();
  if (!pending) return null;
  // wait until the camera of the bookmark's mode is mounted
  if (useUiStore.getState().cameraMode !== pending.bookmark.mode) return null;
  if ((pending.bookmark.mode === 'orbit' ? orbit : walk) === null) return null;
  useCameraRig.setState({ pending: null, suppressFitUntil: performance.now() + JUMP_DURATION_MS + 300 });
  return pending;
}
