import { create } from 'zustand';

/**
 * Hinweistext unter dem Fadenkreuz beim „Gefühlt echt“-Begehen (Entfernung und Höhe, #263).
 * Standard: aus. Geräte-Einstellung wie die Info-Symbole, nicht im Projekt.
 */
export const AIM_HINT_STORAGE_KEY = 'wohnungsplaner-aim-hint';

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Default: hidden. Only an explicit "on" shows the text. */
export function loadAimHintVisible(storage: Storage | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(AIM_HINT_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

/** Returns false if the browser does not allow storing (the choice then only lasts until reload). */
export function saveAimHintVisible(visible: boolean, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (visible) storage.setItem(AIM_HINT_STORAGE_KEY, 'on');
    else storage.removeItem(AIM_HINT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

interface AimHintState {
  visible: boolean;
  setVisible: (v: boolean) => boolean;
}

export const useAimHintStore = create<AimHintState>((set) => ({
  visible: loadAimHintVisible(),
  setVisible: (v) => {
    set({ visible: v });
    return saveAimHintVisible(v);
  },
}));
