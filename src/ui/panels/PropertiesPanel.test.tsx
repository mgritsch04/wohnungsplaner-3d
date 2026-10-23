import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../../model/sample';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { PANEL_GROUPS_STORAGE_KEY, readStoredPanelGroups, usePanelGroupStore } from '../panelGroupStore';
import { PropertiesPanel } from './PropertiesPanel';

// tell React that act() is used on purpose (no warnings in jsdom)
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function select(type: 'furniture' | 'wall' | 'opening' | 'room', id: string) {
  act(() => useUiStore.getState().setSelection({ type, id }));
}

/** Toggle buttons of the groups, by visible title. */
function toggles(): Map<string, HTMLButtonElement> {
  return new Map([...host.querySelectorAll<HTMLButtonElement>('button.panel-group-toggle')].map((b) => [b.textContent!.trim(), b]));
}

function toggle(title: string): HTMLButtonElement {
  const b = toggles().get(title);
  if (!b) throw new Error(`group ${title} not found: ${[...toggles().keys()].join(', ')}`);
  return b;
}

/** Labels of all form fields currently rendered. */
function labels(): string[] {
  return [...host.querySelectorAll('.field-label, label.check span')].map((e) => e.textContent!.trim());
}

const furniture = (catalogId: string) => useProjectStore.getState().project.furniture.find((f) => f.catalogId === catalogId)!;

describe('properties panel groups (#99)', () => {
  beforeEach(() => {
    localStorage.removeItem(PANEL_GROUPS_STORAGE_KEY);
    usePanelGroupStore.getState().reset();
    useProjectStore.getState().load(createSampleProject());
    useUiStore.getState().setSelection(null);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<PropertiesPanel />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('groups the furniture fields by topic; rarely used groups start collapsed', () => {
    select('furniture', furniture('generic-wardrobe-150').id);
    expect([...toggles().keys()]).toEqual(['Objekt', 'Position', 'Maße', 'Aussehen', 'Preis', 'Innenaufteilung', '3D-Modell', 'Produkt', 'Erweitert']);
    const state = Object.fromEntries([...toggles()].map(([t, b]) => [t, b.getAttribute('aria-expanded')]));
    expect(state).toEqual({ Objekt: 'true', Position: 'true', 'Maße': 'true', Aussehen: 'true', Preis: 'true', Innenaufteilung: 'false', '3D-Modell': 'false', Produkt: 'false', Erweitert: 'false' });
    // fields of open groups are there, those of collapsed groups are not rendered
    expect(labels()).toEqual(expect.arrayContaining(['Name', 'Kategorie', 'X', 'Y', 'Drehung', 'Über Boden', 'Breite', 'Tiefe', 'Höhe', 'Farbe', 'Preis', 'Menge']));
    expect(labels()).not.toContain('Marke');
    expect(labels()).not.toContain('Gesperrt (nicht verschiebbar)');
    // aria-controls points at the (hidden) body of the group
    const body = document.getElementById(toggle('Produkt').getAttribute('aria-controls')!)!;
    expect(body.hidden).toBe(true);
    // rotate buttons stay at the bottom, outside the groups (#31)
    expect(host.querySelector('[role="group"][aria-label="Drehen"]')!.closest('.panel-group')).toBeNull();
  });

  it('rotation slider: one drag is one undo step and the number field follows', () => {
    const f = furniture('generic-wardrobe-150');
    select('furniture', f.id);
    const slider = host.querySelector<HTMLInputElement>('[data-testid="furniture-rotation-slider"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const drag = (v: string) =>
      act(() => {
        setValue.call(slider, v);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const past = useProjectStore.getState().past.length;
    act(() => useProjectStore.getState().beginTransaction());
    drag('30');
    drag('60');
    act(() => useProjectStore.getState().commitTransaction());
    expect(useProjectStore.getState().past.length).toBe(past + 1);
    expect(furniture('generic-wardrobe-150').rotation).toBeCloseTo((60 * Math.PI) / 180, 5);
    expect(slider.value).toBe('60');
  });

  it('opens and closes a group via its heading button and updates aria-expanded', () => {
    select('furniture', furniture('generic-wardrobe-150').id);
    act(() => toggle('Produkt').click());
    expect(toggle('Produkt').getAttribute('aria-expanded')).toBe('true');
    expect(labels()).toEqual(expect.arrayContaining(['Marke', 'Händler', 'Produkt-URL']));
    expect(document.getElementById(toggle('Produkt').getAttribute('aria-controls')!)!.hidden).toBe(false);
    act(() => toggle('Erweitert').click());
    expect(labels()).toEqual(expect.arrayContaining(['Hindernis beim Begehen', 'Gesperrt (nicht verschiebbar)']));
    act(() => toggle('Maße').click());
    expect(toggle('Maße').getAttribute('aria-expanded')).toBe('false');
    expect(labels()).not.toContain('Breite');
    // the heading is a real button (keyboard: Enter/Space via the browser)
    expect(toggle('Maße').tagName).toBe('BUTTON');
    expect(toggle('Maße').type).toBe('button');
  });

  it('keeps the open state per kind of group when another object is selected', () => {
    select('furniture', furniture('generic-wardrobe-150').id);
    act(() => toggle('Produkt').click());
    act(() => toggle('Preis').click());
    select('furniture', furniture('generic-sofa-3').id);
    expect(toggle('Produkt').getAttribute('aria-expanded')).toBe('true');
    expect(toggle('Preis').getAttribute('aria-expanded')).toBe('false');
    expect(labels()).toContain('Marke');
    // a wall in between does not reset the furniture groups
    select('wall', useProjectStore.getState().project.walls[0].id);
    expect(toggle('Position').getAttribute('aria-expanded')).toBe('false'); // wall coordinates: collapsed by default
    select('furniture', furniture('generic-wardrobe-150').id);
    expect(toggle('Produkt').getAttribute('aria-expanded')).toBe('true');
    // remembered on this device
    expect(JSON.parse(localStorage.getItem(PANEL_GROUPS_STORAGE_KEY)!)).toMatchObject({ 'furniture.product': true, 'furniture.price': false });
  });

  it('shows the door state, hinge and sizes without expanding anything (#107, #31)', () => {
    const door = useProjectStore.getState().project.openings.find((o) => o.kind === 'door')!;
    select('opening', door.id);
    expect([...toggles().keys()]).toEqual(['Tür', 'Maße und Lage', 'Flügel']);
    expect([...toggles().values()].every((b) => b.getAttribute('aria-expanded') === 'true')).toBe(true);
    expect(labels()).toEqual(expect.arrayContaining(['Typ', 'Breite', 'Höhe', 'Brüstung', 'Abstand Wandanfang', 'Anschlag', 'Öffnet nach', 'Tür geöffnet']));
  });

  it('groups walls and rooms; room sizes stay open', () => {
    select('wall', useProjectStore.getState().project.walls[0].id);
    expect([...toggles().keys()]).toEqual(['Wand', 'Position', 'Aufbau und Schallschutz', 'Oberflächen', expect.stringMatching(/^Öffnungen \(\d+\)$/)]);
    expect(labels()).toEqual(expect.arrayContaining(['Länge (Achse)', 'Dicke', 'Höhe', 'Winkel']));
    expect(labels()).not.toContain('Start X');
    const room = useProjectStore.getState().project.rooms[0];
    select('room', room.id);
    expect([...toggles().keys()]).toEqual(['Raum', 'Innenmaße (lichte Weite)', 'Oberflächen']);
    expect(labels()).toEqual(expect.arrayContaining(['Name', 'Breite', 'Tiefe', 'Boden', 'Wände', 'Decke']));
  });

  it('reads stored choices and ignores broken storage content', () => {
    localStorage.setItem(PANEL_GROUPS_STORAGE_KEY, JSON.stringify({ 'furniture.product': true, 'wall.position': 'ja', x: 1 }));
    expect(readStoredPanelGroups()).toEqual({ 'furniture.product': true });
    localStorage.setItem(PANEL_GROUPS_STORAGE_KEY, '{kaputt');
    expect(readStoredPanelGroups()).toEqual({});
    localStorage.setItem(PANEL_GROUPS_STORAGE_KEY, '[true]');
    expect(readStoredPanelGroups()).toEqual({});
  });
});
