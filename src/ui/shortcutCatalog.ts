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
      { keys: 'Umschalt+Klick', action: 'Möbel (bzw. ganze Gruppe) zur Auswahl hinzufügen / entfernen', match: [] },
      { keys: 'Strg+G', action: 'Ausgewählte Möbel gruppieren (z. B. Küchenzeile, Essgruppe)', match: ['g'] },
      { keys: 'Strg+Umschalt+G', action: 'Gruppe auflösen (Möbel bleiben stehen)', match: ['g'] },
      { keys: 'Klick / zweiter Klick', action: 'Ganze Gruppe auswählen / einzelnes Möbel der Gruppe', match: [] },
      { keys: 'Umschalt+Ziehen', action: 'Auswahlrahmen im 2D-Plan (auf dem Boden beginnen)', match: [] },
      { keys: 'Q / E', action: 'Auswahl um 15° drehen (beim Begehen öffnet E stattdessen Türen und Fenster)', match: ['q', 'e'] },
      { keys: 'Pfeiltasten', action: 'Möbel 1 cm verschieben (Umschalt: 10 cm)', match: ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'] },
      { keys: 'Alt beim Ziehen', action: 'Frei platzieren, ohne Einrasten und ohne Kollisionsstopp (2D und 3D)', match: [] },
      { keys: 'Alt halten', action: 'Abstände der Auswahl zu Wänden und Möbeln zeigen (2D; beim Ziehen immer sichtbar; Mehrfachauswahl und Gruppen als Ganzes)', match: [] },
      { keys: 'O / Doppelklick in 3D', action: 'Ausgewählte Tür / ausgewähltes Fenster öffnen oder schließen', match: ['o'] },
      { keys: 'Strg+S', action: 'Speichern', match: ['s'] },
    ],
  },
  {
    title: 'Ansicht',
    where: '2D und 3D',
    items: [
      { keys: '1 / 2 / 3', action: '2D / 2D + 3D nebeneinander / 3D (wie die Ansicht-Knöpfe oben)', match: ['1', '2', '3'] },
      { keys: 'H', action: 'Plan einpassen', match: ['h'] },
      { keys: '?', action: 'Diese Übersicht öffnen (auch Fragezeichen-Symbol oben rechts)', match: ['?'] },
      { keys: 'Mausrad', action: 'Zoomen', match: [] },
      { keys: 'Leertaste / rechte Maustaste + Ziehen', action: 'Plan verschieben (2D)', match: [] },
      { keys: 'Umschalt / Alt beim Zeichnen', action: 'Freier Winkel / ohne Fang', match: [] },
    ],
  },
  {
    title: '3D-Übersicht: Kamera',
    where: '3D, Modus „Übersicht“ (in 2D + 3D: Maus über der 3D-Ansicht)',
    items: [
      { keys: 'Linke oder mittlere Maustaste + Ziehen', action: 'Ansicht um die Mitte drehen (Möbel bleiben stehen)', match: [] },
      { keys: 'Rechte Maustaste (oder Umschalt + linke) + Ziehen', action: 'Ansicht verschieben', match: [] },
      { keys: 'Mausrad', action: 'Zum Mauszeiger hin zoomen', match: [] },
      {
        keys: 'W A S D / Pfeiltasten',
        action: 'Ansicht in der Ebene bewegen, Umschalt: schneller (Pfeiltasten verschieben stattdessen ein ausgewähltes Möbel)',
        match: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'],
      },
      { keys: 'Linke Maustaste auf Möbel + Ziehen', action: 'Möbel verschieben – die Ansicht dreht sich dabei nicht mit', match: [] },
    ],
  },
  {
    title: '3D-Ansichten',
    where: '3D (Übersicht und Begehen)',
    items: [
      {
        keys: 'Alt+1 … Alt+9',
        action: 'Gespeicherte Ansicht 1–9 anspringen (speichern im Menü „Ansichten“ oben rechts in 3D)',
        match: Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`),
      },
      { keys: 'K', action: 'Maßband an/aus: zwei Punkte anklicken (Übersicht) bzw. mit dem Fadenkreuz (Begehen); Esc löscht die Messungen', match: ['k'] },
    ],
  },
  {
    title: 'Vorher-nachher-Vergleich',
    where: '3D, nach „In 3D vergleichen“ im Dialog „Versionen“',
    items: [
      { keys: 'Leertaste', action: 'Zwischen Stand A und Stand B umschalten (gleicher Blickwinkel)', match: [' '] },
      { keys: 'A / B', action: 'Stand A bzw. Stand B zeigen', match: ['a', 'b'] },
      { keys: 'Esc', action: 'Vergleich beenden', match: ['escape'] },
    ],
  },
  {
    title: '3D-Begehung',
    where: '3D, Modus „Begehen“',
    items: [
      { keys: 'W A S D / Pfeiltasten', action: 'Gehen', match: ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'] },
      { keys: 'Maus', action: 'Umsehen (nach Klick in die Ansicht)', match: [] },
      { keys: 'Umschalt', action: 'Schneller gehen', match: ['ShiftLeft', 'ShiftRight'] },
      { keys: 'C', action: 'Ducken / wieder aufstehen umschalten (Sitzen mit X beendet das Ducken)', match: ['KeyC'] },
      { keys: 'X', action: 'Sitzen / Stehen umschalten (auch Knöpfe Stehen/Sitzen oben neben „Begehen“; Sitzhöhe im Projekt-Panel)', match: ['KeyX'] },
      { keys: 'Klick', action: 'Möbel im Fadenkreuz auswählen bzw. Tür/Fenster öffnen oder schließen', match: [] },
      { keys: 'G', action: 'Möbel tragen / absetzen', match: ['KeyG'] },
      { keys: 'E / O', action: 'Tür oder Fenster im Fadenkreuz öffnen / schließen', match: ['KeyE', 'KeyO'] },
      { keys: 'Esc', action: 'Maus freigeben', match: [] },
    ],
  },
];
