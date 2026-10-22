/**
 * Animationen der Bedienoberfläche (#101): wie das System, immer an oder aus.
 *
 * Eine Geräte-Einstellung wie das Farbschema: localStorage, als `data-motion` auf <html>.
 * „System“ folgt `prefers-reduced-motion`; src/styles.css leitet daraus `--motion-dur` ab.
 * Die Kamerafahrt (cameraBookmarks) fragt dieselbe Regel über `motionReduced()`.
 */
export type MotionPreference = 'system' | 'on' | 'off';

export const MOTION_STORAGE_KEY = 'wohnungsplaner-motion';

export const MOTION_OPTIONS: readonly { value: MotionPreference; label: string; title: string }[] = [
  { value: 'system', label: 'System', title: 'Wie das Betriebssystem bzw. der Browser (Einstellung „Bewegung reduzieren“)' },
  { value: 'on', label: 'An', title: 'Sanfte Übergänge immer zeigen' },
  { value: 'off', label: 'Aus', title: 'Keine Animationen; Panels, Dialoge und Kamerawechsel springen direkt' },
];

/** Unknown or missing values fall back to „System“. */
export function parseMotionPreference(value: unknown): MotionPreference {
  return value === 'on' || value === 'off' ? value : 'system';
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadMotionPreference(storage: Storage | null = defaultStorage()): MotionPreference {
  try {
    return parseMotionPreference(storage?.getItem(MOTION_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Returns false if the browser does not allow storing (the choice then only lasts until reload). */
export function saveMotionPreference(pref: MotionPreference, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (pref === 'system') storage.removeItem(MOTION_STORAGE_KEY);
    else storage.setItem(MOTION_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

export function applyMotionPreference(pref: MotionPreference, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-motion', pref);
}

/** True if animations should be skipped: explicit „Aus“, or „System“ with reduced motion requested. */
export function motionReduced(pref: MotionPreference = loadMotionPreference()): boolean {
  if (pref === 'off') return true;
  if (pref === 'on') return false;
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
