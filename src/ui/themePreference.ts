/**
 * Farbschema der Bedienoberfläche (#73): hell, dunkel oder wie das System.
 *
 * Eine Geräte-Einstellung, kein Teil des Projekts: sie liegt in localStorage und
 * steht als `data-theme` auf <html>; die Farben dazu definiert src/theme.css.
 * Das Inline-Skript in index.html setzt das Attribut schon vor dem ersten Rendern
 * (gleicher Schlüssel, gleiche Regeln – geprüft in themePreference.test.ts).
 */
export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_STORAGE_KEY = 'wohnungsplaner-theme';

export const THEME_OPTIONS: readonly { value: ThemePreference; label: string; title: string }[] = [
  { value: 'light', label: 'Hell', title: 'Helle Oberfläche' },
  { value: 'dark', label: 'Dunkel', title: 'Dunkle Oberfläche' },
  { value: 'system', label: 'System', title: 'Wie das Betriebssystem bzw. der Browser' },
];

/** Unknown or missing values fall back to „System“. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** localStorage may be missing or throw (privacy mode, blocked site data). */
function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function loadThemePreference(storage: Storage | null = defaultStorage()): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

/** Stores the preference; returns false if the browser does not allow it (the choice then only lasts until reload). */
export function saveThemePreference(pref: ThemePreference, storage: Storage | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    if (pref === 'system') storage.removeItem(THEME_STORAGE_KEY);
    else storage.setItem(THEME_STORAGE_KEY, pref);
    return true;
  } catch {
    return false;
  }
}

export function applyThemePreference(pref: ThemePreference, root: HTMLElement = document.documentElement): void {
  root.setAttribute('data-theme', pref);
}
