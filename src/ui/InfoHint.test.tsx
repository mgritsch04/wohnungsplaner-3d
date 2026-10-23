import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HELP_TEXTS } from './helpTexts';
import { HINTS_STORAGE_KEY, loadHintsVisible, saveHintsVisible, useHintsStore } from './hintsPreference';
import { InfoHint } from './InfoHint';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

describe('info hints (#79)', () => {
  beforeEach(() => {
    useHintsStore.setState({ visible: true });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<InfoHint id="realism" />));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('shows the explanation on click and hides it on the next click', () => {
    const btn = host.querySelector('button')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(host.textContent).not.toContain(HELP_TEXTS.realism.text);
    act(() => btn.click());
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(host.querySelector('[role="note"]')!.textContent).toBe(HELP_TEXTS.realism.text);
    act(() => btn.click());
    expect(host.querySelector('[role="note"]')).toBeNull();
  });

  it('renders nothing when the symbols are switched off', () => {
    act(() => useHintsStore.setState({ visible: false }));
    expect(host.querySelector('button')).toBeNull();
  });

  it('keeps every text short', () => {
    for (const t of Object.values(HELP_TEXTS)) expect(t.text.length).toBeLessThan(220);
  });

  it('stores only the "off" choice', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
    expect(loadHintsVisible(storage)).toBe(true);
    expect(saveHintsVisible(false, storage)).toBe(true);
    expect(mem.get(HINTS_STORAGE_KEY)).toBe('off');
    expect(loadHintsVisible(storage)).toBe(false);
    saveHintsVisible(true, storage);
    expect(loadHintsVisible(storage)).toBe(true);
    expect(saveHintsVisible(false, null)).toBe(false);
  });
});
