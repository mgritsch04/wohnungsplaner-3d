import { create } from 'zustand';

/** Info-Symbole (ⓘ) ein- oder ausblenden (#79). Geräte-Einstellung wie das Farbschema, nicht im Projekt. */
export const HINTS_STORAGE_KEY = 'wohnungsplaner-hints';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Default: shown. Only an explicit "off" hides them. */
export function loadHintsVisible(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(HINTS_STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

/** Returns false if the browser does not allow storing (the choice then only lasts until reload). */
export function saveHintsVisible(visible: boolean, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (visible) storage.removeItem(HINTS_STORAGE_KEY);
    else storage.setItem(HINTS_STORAGE_KEY, 'off');
    return true;
  } catch {
    return false;
  }
}

interface HintsState {
  visible: boolean;
  setVisible: (v: boolean) => boolean;
}

export const useHintsStore = create<HintsState>((set) => ({
  visible: loadHintsVisible(),
  setVisible: (v) => {
    set({ visible: v });
    return saveHintsVisible(v);
  },
}));
