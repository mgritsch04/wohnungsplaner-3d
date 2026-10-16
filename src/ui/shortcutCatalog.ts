import type { Tool } from '../store/uiStore';

/**
 * Single source for the keyboard shortcuts shown in the help dialog (#59). The handlers live
 * in `useShortcuts.ts` (editor) and `WalkControls.tsx` (walkthrough); `shortcutCatalog.test.ts`
 * reads those files and fails when a handled key is missing here, so the help cannot go stale.
 */

/** Tool keys in the 2D editor (used by the handler, too). */
export const TOOL_KEYS: Record<string, Tool> = { v: 'select', w: 'wall', r: 'room', t: 'door', f: 'window', g: 'passage', m: 'measure', l: 'walkpath' };

const TOOL_LABEL: Partial<Record<Tool, string>> = {
  select: 'Auswählen / Verschieben',
  wall: 'Wand zeichnen (Länge in cm tippen + Enter)',
  room: 'Raum (Rechteck aufziehen oder Fläche anklicken)',
  door: 'Tür setzen',
  window: 'Fenster setzen',
  passage: 'Durchgang setzen',
  measure: 'Messen',
  walkpath: 'Laufweg messen (Start und Ziel anklicken)',
};

export interface Shortcut {
  /** Keys as shown, e.g. "Strg+Z". */
  keys: string;
  action: string;
  /**
   * The key values the handlers compare against (lower-case `e.key`, or `e.code` for the
   * walkthrough) – checked by the test, not shown.
   */
  match: string[];
}

export interface ShortcutGroup {
  title: string;
  /** Where the keys work. */
  where: string;
  items: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Werkzeuge',
    where: '2D-Plan',
    items: [
      ...Object.entries(TOOL_KEYS).map(([k, tool]) => ({ keys: k.toUpperCase(), action: TOOL_LABEL[tool] ?? tool, match: [k] })),
      { keys: 'Esc', action: 'Werkzeug abbrechen / Auswahl aufheben', match: ['escape'] },
    ],
  },
  {
    title: 'Bearbeiten',
    where: '2D und 3D',
    items: [
      { keys: 'Strg+Z / Strg+Y', action: 'Rückgängig / Wiederholen (auch Strg+Umschalt+Z)', match: ['z', 'y'] },
      { keys: 'Entf', action: 'Auswahl löschen', match: ['delete', 'backspace'] },
      { keys: 'Strg+D', action: 'Auswahl duplizieren', match: ['d'] },
      { keys: 'Strg+C / Strg+V', action: 'Möbel kopieren / einfügen', match: ['c', 'v'] },
      { keys: 'Strg+A', action: 'Alle Möbel auswählen (2D)', match: ['a'] },
      { keys: 'Umschalt+Klick', action: 'Möbel zur Auswahl hinzufügen / entfernen', match: [] },
      { keys: 'Umschalt+Ziehen', action: 'Auswahlrahmen im 2D-Plan (auf dem Boden beginnen)', match: [] },
      { keys: 'Q / E', action: 'Auswahl um 15° drehen', match: ['q', 'e'] },
      { keys: 'Pfeiltasten', action: 'Möbel 1 cm verschieben (Umschalt: 10 cm)', match: ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'] },
      { keys: 'Alt beim Ziehen', action: 'Frei platzieren, ohne Einrasten (2D)', match: [] },
      { keys: 'Alt halten', action: 'Abstände des ausgewählten Möbels zu Wänden und Möbeln zeigen (2D; beim Ziehen immer sichtbar)', match: [] },
      { keys: 'O / Doppelklick in 3D', action: 'Ausgewählte Tür / ausgewähltes Fenster öffnen oder schließen', match: ['o'] },
      { keys: 'Strg+S', action: 'Speichern', match: ['s'] },
    ],
  },
  {
    title: 'Ansicht',
    where: '2D und 3D',
    items: [
      { keys: '1 / 2 / 3', action: '2D / Geteilt / 3D', match: ['1', '2', '3'] },
      { keys: 'H', action: 'Plan einpassen', match: ['h'] },
      { keys: '?', action: 'Diese Übersicht öffnen', match: ['?'] },
      { keys: 'Mausrad', action: 'Zoomen', match: [] },
      { keys: 'Leertaste / rechte Maustaste + Ziehen', action: 'Plan verschieben (2D)', match: [] },
      { keys: 'Umschalt / Alt beim Zeichnen', action: 'Freier Winkel / ohne Fang', match: [] },
    ],
  },
  {
    title: '3D-Begehung',
    where: '3D, Modus „Begehen“',
    items: [
      { keys: 'W A S D / Pfeiltasten', action: 'Gehen', match: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] },
      { keys: 'Maus', action: 'Umsehen (nach Klick in die Ansicht)', match: [] },
      { keys: 'Umschalt', action: 'Schneller gehen', match: ['ShiftLeft', 'ShiftRight'] },
      { keys: 'C (halten)', action: 'Ducken', match: ['KeyC'] },
      { keys: 'Klick', action: 'Möbel im Fadenkreuz auswählen bzw. Tür/Fenster öffnen oder schließen', match: [] },
      { keys: 'G', action: 'Möbel tragen / absetzen', match: ['KeyG'] },
      { keys: 'O', action: 'Tür oder Fenster im Fadenkreuz öffnen / schließen', match: ['KeyO'] },
      { keys: 'Esc', action: 'Maus freigeben', match: [] },
    ],
  },
];
