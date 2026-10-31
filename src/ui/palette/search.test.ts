import { describe, expect, it } from 'vitest';
import { normalize, searchCommands } from './search';

const cmds = [
  { label: 'Wand zeichnen', group: 'Werkzeuge', keywords: 'mauer' },
  { label: 'Rückgängig', group: 'Bearbeiten', keywords: 'undo zurück' },
  { label: 'Schnitt in 1,20 m Höhe', group: 'Ansicht', keywords: 'querschnitt' },
  { label: 'Einkaufsliste (CSV)', group: 'Export', keywords: 'budget tabelle' },
];

describe('Befehlssuche', () => {
  it('ignoriert Umlaute und Groß-/Kleinschreibung', () => {
    expect(normalize('Rückgängig')).toBe('rueckgaengig');
    expect(searchCommands('RUCKGANGIG', cmds)).toHaveLength(0);
    expect(searchCommands('rueckgaengig', cmds)[0].label).toBe('Rückgängig');
    expect(searchCommands('hohe', cmds)).toHaveLength(0);
    expect(searchCommands('höhe', cmds)[0].label).toContain('Schnitt');
  });
  it('findet über Stichwörter und Gruppe', () => {
    expect(searchCommands('undo', cmds)[0].label).toBe('Rückgängig');
    expect(searchCommands('mauer', cmds)[0].label).toBe('Wand zeichnen');
    expect(searchCommands('export', cmds)[0].label).toContain('Einkaufsliste');
  });
  it('alle Wörter müssen passen, Reihenfolge egal', () => {
    expect(searchCommands('zeichnen wand', cmds)).toHaveLength(1);
    expect(searchCommands('wand csv', cmds)).toHaveLength(0);
  });
  it('leere Suche zeigt alles in Originalreihenfolge', () => {
    expect(searchCommands('  ', cmds)).toEqual(cmds);
  });
  it('Treffer im Namen stehen vor Treffern in Stichwörtern', () => {
    const r = searchCommands('budget', [{ label: 'Einkaufsliste', group: 'Export', keywords: 'budget' }, { label: 'Budget öffnen', group: 'Panels' }]);
    expect(r[0].label).toBe('Budget öffnen');
  });
});
