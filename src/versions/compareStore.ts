import { create } from 'zustand';
import type { Project } from '../model/schema';
import { useUiStore, type CameraMode } from '../store/uiStore';
import { diffFurniture, type FurnitureDiff } from './diff';

/**
 * Before/after comparison in 3D (#76)
 * ----------------------------------
 * The comparison shows two saved states as a READ-ONLY preview. The states live here,
 * next to the project store, as separate project objects – the project store (and with
 * it the undo history and autosave) is never touched. The 3D view renders the preview
 * project instead of the store project while a comparison runs; the camera stays the
 * same, so A and B are seen from exactly the same viewpoint.
 *
 * Only UI state changes while comparing (selection cleared, walkthrough switched to the
 * overview); the camera mode is restored when the comparison ends.
 */

export type CompareSide = 'a' | 'b';

export interface CompareStand {
  /** Shown name, e.g. the name of the saved state or „Aktueller Stand“. */
  label: string;
  /** Read-only snapshot (never handed to the project store). */
  project: Project;
}

export interface CompareSession {
  a: CompareStand;
  b: CompareStand;
  diff: FurnitureDiff;
  /** Camera mode before the comparison (restored afterwards). */
  restoreCameraMode: CameraMode;
}

interface CompareStore {
  session: CompareSession | null;
  showing: CompareSide;
}

export const useCompareStore = create<CompareStore>(() => ({ session: null, showing: 'a' }));

export const isComparing = () => useCompareStore.getState().session !== null;

/** Start comparing state A (before) with state B (after). Shows A first. */
export function startCompare(a: CompareStand, b: CompareStand): void {
  const ui = useUiStore.getState();
  const prev = useCompareStore.getState().session;
  const restoreCameraMode = prev ? prev.restoreCameraMode : ui.cameraMode;
  // editing is locked: nothing may stay selected or carried
  ui.setSelection(null);
  ui.setHover(null);
  // both states are compared from the same orbit view
  if (ui.cameraMode !== 'orbit') ui.setCameraMode('orbit');
  const snap = (s: CompareStand): CompareStand => ({ label: s.label, project: structuredClone(s.project) });
  const sa = snap(a);
  const sb = snap(b);
  useCompareStore.setState({
    session: { a: sa, b: sb, diff: diffFurniture(sa.project.furniture, sb.project.furniture), restoreCameraMode },
    showing: 'a',
  });
}

export function showCompareSide(side: CompareSide): void {
  if (isComparing()) useCompareStore.setState({ showing: side });
}

export function toggleCompareSide(): void {
  const { session, showing } = useCompareStore.getState();
  if (session) useCompareStore.setState({ showing: showing === 'a' ? 'b' : 'a' });
}

/** End the comparison: the 3D view shows the (unchanged) project again. */
export function stopCompare(): void {
  const { session } = useCompareStore.getState();
  if (!session) return;
  useCompareStore.setState({ session: null, showing: 'a' });
  const ui = useUiStore.getState();
  if (ui.cameraMode !== session.restoreCameraMode) ui.setCameraMode(session.restoreCameraMode);
}

let lastLockHint = 0;
/** Tell the user (at most every 2 s) why an editing key does nothing. */
export function notifyCompareLocked(now = Date.now()): void {
  if (now - lastLockHint < 2000) return;
  lastLockHint = now;
  useUiStore.getState().toast('Im Vergleichsmodus ist Bearbeiten gesperrt. „Vergleich beenden“ (Esc), um weiterzuarbeiten.', 'info');
}
