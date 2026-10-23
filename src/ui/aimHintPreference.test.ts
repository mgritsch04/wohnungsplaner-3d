import { describe, expect, it } from 'vitest';
import { AIM_HINT_STORAGE_KEY, loadAimHintVisible, saveAimHintVisible } from './aimHintPreference';

function memoryStorage(): Storage {
  const mem = new Map<string, string>();
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) } as unknown as Storage;
}

describe('aim hint preference', () => {
  it('is hidden by default and stores only the "on" choice', () => {
    const storage = memoryStorage();
    expect(loadAimHintVisible(storage)).toBe(false);
    expect(saveAimHintVisible(true, storage)).toBe(true);
    expect(storage.getItem(AIM_HINT_STORAGE_KEY)).toBe('on');
    expect(loadAimHintVisible(storage)).toBe(true);
    expect(saveAimHintVisible(false, storage)).toBe(true);
    expect(storage.getItem(AIM_HINT_STORAGE_KEY)).toBeNull();
    expect(loadAimHintVisible(storage)).toBe(false);
  });

  it('reports a failed save when no storage is available', () => {
    expect(saveAimHintVisible(true, null)).toBe(false);
  });

  it('stays hidden when reading the storage throws', () => {
    const broken = { getItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(loadAimHintVisible(broken)).toBe(false);
  });
});
