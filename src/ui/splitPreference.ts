/*
 * Aufteilung 2D | 3D (#368): Anteil der 2D-Ansicht an der Breite des Arbeitsbereichs.
 * Eine Geräte-Einstellung, kein Teil des Projekts: sie liegt in localStorage.
 */
export const SPLIT_STORAGE_KEY = 'wohnungsplaner-split';
export const SPLIT_DEFAULT = 0.5;
/** Mindestbreite je Seite in Pixeln, damit keine Ansicht ganz verschwindet. */
export const SPLIT_MIN_PX = 240;
export const SPLIT_KEY_STEP = 0.05;

/** Anteil 0..1 so begrenzen, dass beide Seiten mindestens SPLIT_MIN_PX breit bleiben. */
export function clampSplit(ratio: number, totalPx: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_DEFAULT;
  // too narrow for two minimum widths: keep it centred
  if (totalPx <= 0 || totalPx < SPLIT_MIN_PX * 2) return SPLIT_DEFAULT;
  const min = SPLIT_MIN_PX / totalPx;
  return Math.min(1 - min, Math.max(min, ratio));
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function parseSplit(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0.05 && n < 0.95 ? n : SPLIT_DEFAULT;
}

export function loadSplit(storage: Storage | null = defaultStorage()): number {
  try {
    return parseSplit(storage?.getItem(SPLIT_STORAGE_KEY));
  } catch {
    return SPLIT_DEFAULT;
  }
}

export function saveSplit(ratio: number, storage: Storage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (ratio === SPLIT_DEFAULT) storage.removeItem(SPLIT_STORAGE_KEY);
    else storage.setItem(SPLIT_STORAGE_KEY, ratio.toFixed(4));
  } catch {
    /* blocked storage: the split then only lasts until reload */
  }
}
