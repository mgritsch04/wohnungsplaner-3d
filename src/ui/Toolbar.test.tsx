import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { createSampleProject } from '../model/sample';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { SHORTCUT_GROUPS } from './shortcutCatalog';
import { readClosedIds, writeClosed } from './StartCard';
import { Toolbar } from './Toolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const header = () => host.querySelector('header.toolbar')!;
/** Accessible name of a button: aria-label, else its text. */
const nameOf = (b: Element) => b.getAttribute('aria-label') ?? b.textContent!.trim();
function button(name: string): HTMLButtonElement {
  const b = [...host.querySelectorAll('button')].find((x) => nameOf(x) === name || nameOf(x).startsWith(`${name} `));
  if (!b) throw new Error(`button ${name} not found: ${[...host.querySelectorAll('button')].map(nameOf).join(' | ')}`);
  return b;
}
const click = (name: string) => act(() => button(name).click());
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const menuEntries = (id: string) => [...document.getElementById(id)!.querySelectorAll('button')].map(nameOf);

describe('toolbar (#100, #103)', () => {
  beforeEach(() => {
    useProjectStore.getState().load(createSampleProject());
    useUiStore.getState().setViewMode('split');
    useUiStore.getState().setCameraMode('orbit');
    useUiStore.getState().setWalkSit(false);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Toolbar saveState="saved" />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('labels every icon button with a name and a tooltip and hides the drawing from screen readers', () => {
    const icons = [...header().querySelectorAll('button.icon-btn')];
    expect(icons.map(nameOf)).toEqual(['Rückgängig', 'Wiederholen', '2D + 3D', 'Übersicht', 'Begehen', 'Schnitt', 'Außen', 'Kamera zurücksetzen', 'Hilfe & Tastenkürzel', 'Mehr']);
    for (const b of icons) {
      const label = b.getAttribute('aria-label')!;
      expect(label.length).toBeGreaterThan(1);
      expect(b.getAttribute('title')).toContain(label.split(' ')[0]);
      expect(b.getAttribute('data-tip')).toBe(b.getAttribute('title'));
      // icon only, or icon with its name as visible caption (#122)
      expect(['', label]).toContain(b.textContent!.trim());
      expect(b.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    }
    // toggles announce their state
    expect(button('2D + 3D').getAttribute('aria-pressed')).toBe('true');
    expect(button('Übersicht').getAttribute('aria-pressed')).toBe('true');
    expect(button('Begehen').getAttribute('aria-pressed')).toBe('false');
  });

  it('tooltips name the same keys as the keyboard overview', () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.map((i) => i.keys)).join(' ');
    for (const [name, k] of [
      ['Rückgängig', 'Strg+Z'],
      ['Wiederholen', 'Strg+Y'],
      ['Hilfe & Tastenkürzel', '?'],
    ]) {
      expect(button(name).title).toContain(k);
      expect(keys).toContain(k);
    }
    expect(button('2D + 3D').title).toContain('Taste 2');
  });

  it('the "Mehr" menu holds the exports; light presets only in 3D realism', () => {
    expect(header().textContent).not.toContain('Export ▾');
    click('Mehr');
    expect(button('Mehr').getAttribute('aria-expanded')).toBe('true');
    expect(menuEntries('toolbar-menu-more')).toEqual([
      'Projektpaket (.wohnplan.json)',
      'Grundriss (apartment-plan.json)',
      'Einkaufsliste (CSV)',
      'Plan drucken / PDF / PNG…',
      '3D-Modell als GLB …',
    ]);
    expect(host.querySelector('[aria-label="Lampen"]')).toBeNull();
    act(() => useProjectStore.getState().apply((d) => void (d.settings.quality = 'realism')));
    expect(host.querySelector('#toolbar-menu-more [aria-label="Lampen"]')).not.toBeNull();
    expect(host.querySelector('#toolbar-menu-more [aria-label="Tageszeit-Voreinstellung"]')).not.toBeNull();
    // the slider itself stays in the toolbar, its selects are not duplicated there
    expect(host.querySelector('.time-control [aria-label="Tageszeit"]')).not.toBeNull();
    expect(host.querySelectorAll('[aria-label="Lampen"]')).toHaveLength(1);
  });

  it('menus work with the keyboard: focus on the first entry, arrows move, Esc closes and returns', () => {
    click('Projekt ▾');
    const menu = document.getElementById('toolbar-menu-project')!;
    expect(document.activeElement?.textContent).toBe('Neues leeres Projekt');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Neues Beispielprojekt');
    key(document.activeElement!, 'ArrowDown'); // "Erste Schritte" is disabled for the sample → skipped
    expect(document.activeElement?.textContent).toBe('Projekte öffnen…');
    key(document.activeElement!, 'End');
    expect(document.activeElement?.textContent).toBe('Plan als PDF/Bild importieren…');
    key(document.activeElement!, 'ArrowDown');
    expect(document.activeElement?.textContent).toBe('Neues leeres Projekt');
    key(menu, 'Escape');
    expect(document.getElementById('toolbar-menu-project')).toBeNull();
    expect(document.activeElement).toBe(button('Projekt ▾'));
    // only one menu at a time
    click('Projekt ▾');
    click('Mehr');
    expect(document.getElementById('toolbar-menu-project')).toBeNull();
    expect(document.getElementById('toolbar-menu-more')).not.toBeNull();
    // a click outside closes
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(document.getElementById('toolbar-menu-more')).toBeNull();
  });

  it('"Erste Schritte" reopens the start card, only for an empty project', () => {
    click('Projekt ▾');
    expect(button('Erste Schritte').disabled).toBe(true);
    expect(button('Erste Schritte').textContent).toContain('nur bei leerem Projekt');
    key(document.activeElement!, 'Escape');

    const empty = createEmptyProject();
    act(() => useProjectStore.getState().load(empty));
    writeClosed(empty.id, true);
    expect(readClosedIds()).toContain(empty.id);
    click('Projekt ▾');
    expect(button('Erste Schritte').disabled).toBe(false);
    click('Erste Schritte');
    expect(readClosedIds()).not.toContain(empty.id);
    expect(document.getElementById('toolbar-menu-project')).toBeNull();
  });

  it('walkthrough: stand / sit toggle next to "Begehen" (same state as key X)', () => {
    expect(host.querySelector('[aria-label="Haltung beim Begehen"]')).toBeNull();
    act(() => useUiStore.getState().setCameraMode('walk'));
    expect(host.querySelector('[aria-label="Haltung beim Begehen"]')).not.toBeNull();
    expect(host.querySelector('[aria-label="Schnitt"]')).toBeNull(); // orbit-only tools hidden while walking
    expect(button('Stehen').getAttribute('aria-pressed')).toBe('true');
    click('Sitzen');
    expect(useUiStore.getState().walkSit).toBe(true);
    expect(button('Sitzen').getAttribute('aria-pressed')).toBe('true');
    expect(button('Sitzen').getAttribute('aria-keyshortcuts')).toBe('X');
    click('Stehen');
    expect(useUiStore.getState().walkSit).toBe(false);
  });
});
