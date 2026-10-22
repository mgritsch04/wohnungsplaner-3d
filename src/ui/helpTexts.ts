/**
 * Kurze Erklärungen für Begriffe der Oberfläche (#79), in einfachem Deutsch. Eine Quelle für die
 * Info-Symbole (`InfoHint`) und den Abschnitt „Begriffe“ im Hilfedialog.
 */
export interface HelpText {
  term: string;
  text: string;
}

export const HELP_TEXTS = {
  realism: {
    term: 'Realismus',
    text: 'Zeigt die 3D-Ansicht schöner: mit Texturen, weichen Schatten und Umgebungslicht. Das braucht mehr Rechenleistung. „Planung“ ist schneller und einfacher.',
  },
  timeOfDay: {
    term: 'Tageszeit',
    text: 'Stellt ein, wie spät es in der Wohnung ist. Davon hängen Sonnenstand, Licht und Schatten ab. Wirkt nur im Realismusmodus.',
  },
  lamps: {
    term: 'Lampen: automatisch',
    text: 'Stehlampen, Tischlampen und andere Lichtquellen gehen ab der Dämmerung von selbst an. Du kannst sie auch immer an- oder ausschalten.',
  },
  exposure: {
    term: 'Belichtung',
    text: 'Macht das ganze 3D-Bild heller oder dunkler, wie die Blende bei einer Kamera. Ändert nichts an der Wohnung selbst.',
  },
  graphics: {
    term: 'Grafikqualität',
    text: '„Hoch“ zeigt feinere Spiegelungen und Schatten, braucht aber eine starke Grafikkarte. „Automatisch“ wählt „Hoch“ nur am PC mit Grafikkarte.',
  },
  levels: {
    term: 'Etagen',
    text: 'Für Häuser mit mehreren Geschossen. Jede Etage hat ihren eigenen Plan; du bearbeitest immer eine. Die anderen zeigt die 3D-Ansicht mit. Wechseln: Etagen-Knöpfe am Plan oder Bild auf / Bild ab.',
  },
} as const satisfies Record<string, HelpText>;

export type HelpId = keyof typeof HELP_TEXTS;
