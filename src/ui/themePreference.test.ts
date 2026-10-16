/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY, applyThemePreference, loadThemePreference, parseThemePreference, saveThemePreference } from './themePreference';

/** Minimal in-memory Storage. */
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

/** Storage whose every access throws (privacy mode, blocked site data, quota). */
function brokenStorage(): Storage {
  const fail = () => {
    throw new DOMException('blocked', 'SecurityError');
  };
  return { length: 0, clear: fail, getItem: fail, setItem: fail, removeItem: fail, key: fail };
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.restoreAllMocks();
});

describe('theme preference (#73)', () => {
  it('accepts only light / dark / system and falls back to system', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
    for (const v of [null, undefined, '', 'Dark', 'blue', 42, {}]) expect(parseThemePreference(v)).toBe('system');
  });

  it('defaults to system when nothing is stored', () => {
    expect(loadThemePreference(memoryStorage())).toBe('system');
    expect(loadThemePreference(null)).toBe('system');
  });

  it('saves and loads the choice', () => {
    const s = memoryStorage();
    expect(saveThemePreference('dark', s)).toBe(true);
    expect(s.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(loadThemePreference(s)).toBe('dark');
    expect(saveThemePreference('light', s)).toBe(true);
    expect(loadThemePreference(s)).toBe('light');
    // „System“ is the default → nothing left behind in storage
    expect(saveThemePreference('system', s)).toBe(true);
    expect(s.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(loadThemePreference(s)).toBe('system');
  });

  it('ignores garbage in storage', () => {
    expect(loadThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: '{"x":1}' }))).toBe('system');
  });

  it('survives a broken localStorage (load → system, save → false, no exception)', () => {
    expect(loadThemePreference(brokenStorage())).toBe('system');
    expect(saveThemePreference('dark', brokenStorage())).toBe(false);
    expect(saveThemePreference('dark', null)).toBe(false);
  });

  it('uses the real localStorage by default and survives it throwing', () => {
    expect(saveThemePreference('dark')).toBe(true);
    expect(loadThemePreference()).toBe('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(loadThemePreference()).toBe('system');
    expect(saveThemePreference('light')).toBe(false);
  });

  it('applies the choice as data-theme on <html>', () => {
    applyThemePreference('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyThemePreference('system');
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });
});

describe('boot script in index.html (applies the theme before the first render)', () => {
  // via a variable: Vite would otherwise turn `new URL('…html', import.meta.url)` into an asset URL
  const here = import.meta.url;
  const html = readFileSync(new URL('../../index.html', here), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const boot = inline.find((s) => s.includes('data-theme')) ?? '';
  const run = () => new Function(boot)();

  it('runs before the app module and uses the same storage key', () => {
    expect(boot).toContain(`'${THEME_STORAGE_KEY}'`);
    expect(html.indexOf(boot)).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
    expect(html.indexOf(boot)).toBeLessThan(html.indexOf('</head>'));
  });

  it('sets the stored theme, otherwise system', () => {
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    localStorage.setItem(THEME_STORAGE_KEY, 'nonsense');
    run();
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });

  it('falls back to system when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(run).not.toThrow();
    expect(document.documentElement.getAttribute('data-theme')).toBe('system');
  });
});
