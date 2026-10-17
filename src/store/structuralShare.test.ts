import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../model/sample';
import { useProjectStore } from './projectStore';
import { shareUnchanged } from './structuralShare';

describe('shareUnchanged (#231)', () => {
  it('keeps everything that did not change as the old object', () => {
    const base = { a: [{ id: 'x', v: 1 }, { id: 'y', v: 2 }], s: { k: 1 }, n: 3 };
    const next = structuredClone(base);
    next.a[1].v = 5;
    const out = shareUnchanged(base, next);
    expect(out).not.toBe(base);
    expect(out.a).not.toBe(base.a);
    expect(out.a[0]).toBe(base.a[0]);
    expect(out.a[1]).toEqual({ id: 'y', v: 5 });
    expect(out.s).toBe(base.s);
  });

  it('returns the old value when nothing changed', () => {
    const base = { a: [1, 2, { b: [3] }], c: null };
    expect(shareUnchanged(base, structuredClone(base))).toBe(base);
  });

  it('matches array items by id, so removing one keeps the others', () => {
    const base = { a: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] };
    const next = structuredClone(base);
    next.a.splice(0, 1);
    const out = shareUnchanged(base, next);
    expect(out.a).toHaveLength(2);
    expect(out.a[0]).toBe(base.a[1]);
    expect(out.a[1]).toBe(base.a[2]);
  });

  it('notices added and removed keys', () => {
    const base: Record<string, unknown> = { a: 1, b: 2 };
    const added = shareUnchanged(base, { ...base, c: 3 });
    expect(added).toEqual({ a: 1, b: 2, c: 3 });
    expect(shareUnchanged(base, { a: 1, c: 2 })).toEqual({ a: 1, c: 2 });
    expect(shareUnchanged(base, { a: 1 })).toEqual({ a: 1 });
  });

  it('moving one piece of furniture leaves walls, rooms and the other furniture untouched', () => {
    useProjectStore.getState().load(createSampleProject());
    const before = useProjectStore.getState().project;
    const id = before.furniture[0].id;
    useProjectStore.getState().apply((d) => {
      d.furniture[0].x += 0.5;
    });
    const after = useProjectStore.getState().project;
    expect(after).not.toBe(before);
    expect(after.walls).toBe(before.walls);
    expect(after.rooms).toBe(before.rooms);
    expect(after.settings).toBe(before.settings);
    expect(after.furniture).not.toBe(before.furniture);
    expect(after.furniture.find((f) => f.id === id)!.x).toBeCloseTo(before.furniture[0].x + 0.5);
    expect(after.furniture.slice(1).every((f, i) => f === before.furniture[i + 1])).toBe(true);
    // the old state stays as it was (undo)
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project).toBe(before);
  });
});
