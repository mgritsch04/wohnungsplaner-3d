import { describe, expect, it } from 'vitest';
import { clampSplit, loadSplit, parseSplit, saveSplit, SPLIT_DEFAULT, SPLIT_STORAGE_KEY } from './splitPreference';

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  } as Storage;
}

describe('splitPreference', () => {
  it('keeps both sides at least the minimum width', () => {
    expect(clampSplit(0.01, 1000)).toBeCloseTo(0.24);
    expect(clampSplit(0.99, 1000)).toBeCloseTo(0.76);
    expect(clampSplit(0.4, 1000)).toBe(0.4);
  });
  it('centres when there is no room for two minimum widths', () => {
    expect(clampSplit(0.1, 300)).toBe(SPLIT_DEFAULT);
    expect(clampSplit(NaN, 1000)).toBe(SPLIT_DEFAULT);
  });
  it('ignores invalid stored values', () => {
    expect(parseSplit('abc')).toBe(SPLIT_DEFAULT);
    expect(parseSplit('0.99')).toBe(SPLIT_DEFAULT);
    expect(parseSplit(null)).toBe(SPLIT_DEFAULT);
    expect(parseSplit('0.3')).toBe(0.3);
  });
  it('round-trips and resets', () => {
    const s = memoryStorage();
    saveSplit(0.3, s);
    expect(loadSplit(s)).toBeCloseTo(0.3);
    saveSplit(SPLIT_DEFAULT, s);
    expect(s.getItem(SPLIT_STORAGE_KEY)).toBeNull();
  });
});
