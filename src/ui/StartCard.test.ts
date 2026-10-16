import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { createSampleProject } from '../model/sample';
import { isProjectEmpty, readClosedIds, writeClosed } from './StartCard';

/** Minimal in-memory Storage. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('start card (#102)', () => {
  it('counts a project as empty without walls, rooms and furniture', () => {
    expect(isProjectEmpty(createEmptyProject())).toBe(true);
    expect(isProjectEmpty(createSampleProject())).toBe(false);
    const p = createEmptyProject();
    p.furniture.push(createSampleProject().furniture[0]);
    expect(isProjectEmpty(p)).toBe(false);
  });

  it('remembers closing per project and can reopen', () => {
    const s = memoryStorage();
    expect(readClosedIds(s)).toEqual([]);
    writeClosed('a', true, s);
    writeClosed('b', true, s);
    expect(readClosedIds(s)).toEqual(['a', 'b']);
    writeClosed('a', false, s);
    expect(readClosedIds(s)).toEqual(['b']);
  });

  it('survives missing or broken storage', () => {
    expect(readClosedIds(null)).toEqual([]);
    expect(writeClosed('a', true, null)).toEqual(['a']);
    const s = memoryStorage();
    s.setItem('wohnungsplaner-startcard-closed', '{kaputt');
    expect(readClosedIds(s)).toEqual([]);
    const throwing = { ...memoryStorage(), setItem: () => { throw new Error('quota'); } } as Storage;
    expect(writeClosed('x', true, throwing)).toEqual(['x']);
  });
});
