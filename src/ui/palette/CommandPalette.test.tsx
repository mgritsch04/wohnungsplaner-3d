import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useUiStore } from '../../store/uiStore';
import { useDialogStore } from '../dialogStore';
import { CommandPalette } from './CommandPalette';
import { buildCommands } from './commands';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const input = () => host.querySelector<HTMLInputElement>('input.palette-input')!;
const options = () => [...host.querySelectorAll('[role="option"]')].map((o) => o.querySelector('.palette-label')!.textContent);
function type(v: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), v);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const key = (k: string) => act(() => void input().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

describe('Befehlspalette', () => {
  beforeEach(() => {
    localStorage.clear();
    useDialogStore.setState({ paletteOpen: true });
    useUiStore.setState({ tool: 'select', viewMode: 'split' });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root.render(<CommandPalette />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('Befehle haben eindeutige IDs', () => {
    const ids = buildCommands().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findet Funktionen per Stichwort und führt sie mit Enter aus', async () => {
    type('mauer');
    expect(options()[0]).toBe('Wand zeichnen');
    key('Enter');
    await new Promise((r) => setTimeout(r, 5));
    expect(useUiStore.getState().tool).toBe('wall');
    expect(useDialogStore.getState().paletteOpen).toBe(false);
  });

  it('Pfeiltasten wählen, Esc schließt', () => {
    type('ansicht');
    key('ArrowDown');
    expect(host.querySelector('[aria-selected="true"]')!.id).toBe(host.querySelectorAll('[role="option"]')[1].id);
    key('Escape');
    expect(useDialogStore.getState().paletteOpen).toBe(false);
  });

  it('zeigt eine Hilfe, wenn nichts passt', () => {
    type('xyzxyz');
    expect(host.textContent).toContain('Nichts gefunden');
  });

  it('nicht verfügbare Befehle bleiben sichtbar, aber grau und am Ende', () => {
    type('schnitt');
    useUiStore.setState({ viewMode: '2d' });
    type('schnitt ');
    const opt = host.querySelector('[role="option"]')!;
    expect(opt.getAttribute('aria-disabled')).toBe('true');
    expect(opt.textContent).toContain('Nur in der 3D-Ansicht');
  });
});
