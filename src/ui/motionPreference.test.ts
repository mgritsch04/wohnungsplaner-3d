/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MOTION_STORAGE_KEY, applyMotionPreference, loadMotionPreference, motionReduced, parseMotionPreference, saveMotionPreference } from './motionPreference';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, String(v)),
    removeItem: (k) => void data.delete(k),
    key: (i) => [...data.keys()][i] ?? null,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('motionPreference (#101)', () => {
  it('parses unknown values as „System“', () => {
    expect(parseMotionPreference('on')).toBe('on');
    expect(parseMotionPreference('off')).toBe('off');
    expect(parseMotionPreference('x')).toBe('system');
    expect(parseMotionPreference(null)).toBe('system');
  });

  it('stores on/off and removes the key for „System“', () => {
    const st = memoryStorage();
    expect(saveMotionPreference('off', st)).toBe(true);
    expect(st.getItem(MOTION_STORAGE_KEY)).toBe('off');
    expect(loadMotionPreference(st)).toBe('off');
    saveMotionPreference('system', st);
    expect(st.getItem(MOTION_STORAGE_KEY)).toBeNull();
    expect(saveMotionPreference('on', null)).toBe(false);
  });

  it('sets data-motion on the root element', () => {
    applyMotionPreference('off');
    expect(document.documentElement.getAttribute('data-motion')).toBe('off');
  });

  it('„Aus“ and „An“ override the system; „System“ follows prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(motionReduced('system')).toBe(true);
    expect(motionReduced('on')).toBe(false);
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(motionReduced('system')).toBe(false);
    expect(motionReduced('off')).toBe(true);
  });

  it('styles.css turns the duration to 0 for reduced motion and „Aus“', () => {
    const here = import.meta.url;
    const theme = readFileSync(new URL('../theme.css', here), 'utf8');
    const css = readFileSync(new URL('../styles.css', here), 'utf8');
    expect(theme).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{\s*--motion-dur: 0s/);
    expect(theme).toMatch(/:root\[data-motion='off'\]\s*\{\s*--motion-dur: 0s/);
    expect(css).toMatch(/\.modal\s*\{\s*animation: ui-pop-in var\(--motion-dur\)/);
  });
});
