import { describe, expect, it } from 'vitest';
import { createEmptyProject as emptyProject } from './factory';
import { addOpening, addRectRoom, closestWall, freeOpeningStation, resolveOpeningSpan } from './operations';

function room() {
  const p = emptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'T', thickness: 0.12, height: 2.6 });
  const hit = closestWall(p, { x: 2, y: -0.06 })!;
  return { p, wallId: hit.wall.id, L: hit.length };
}

describe('freeOpeningStation', () => {
  it('keeps a free spot as it is', () => {
    const { p, wallId } = room();
    expect(freeOpeningStation(p, wallId, 0.9, 2)).toBeCloseTo(2, 2);
  });
  it('pushes an opening next to an existing door instead of on top of it', () => {
    const { p, wallId } = room();
    addOpening(p, wallId, 'door', 2);
    const s = freeOpeningStation(p, wallId, 0.9, 2.1)!;
    expect(Math.abs(s - 2)).toBeGreaterThanOrEqual(0.9 + 0.02 - 0.002);
  });
  it('ignores the opening that is being moved', () => {
    const { p, wallId } = room();
    const id = addOpening(p, wallId, 'door', 2)!;
    expect(freeOpeningStation(p, wallId, 0.9, 2.05, id)).toBeCloseTo(2.05, 2);
  });
  it('returns null when the wall has no gap that wide', () => {
    const { p, wallId, L } = room();
    addOpening(p, wallId, 'door', L / 2, { width: L - 0.3 });
    expect(freeOpeningStation(p, wallId, 0.9, L / 2)).toBeNull();
  });
});

describe('resolveOpeningSpan', () => {
  it('keeps a widened opening on the wall', () => {
    const { p, wallId, L } = room();
    const id = addOpening(p, wallId, 'window', 0.7)!;
    const r = resolveOpeningSpan(p, id, { width: 2 })!;
    expect(r.offset - r.width / 2).toBeGreaterThanOrEqual(-1e-6);
    expect(r.offset + r.width / 2).toBeLessThanOrEqual(L + 1e-6);
  });
  it('rejects a widening that would swallow the neighbour', () => {
    const { p, wallId } = room();
    addOpening(p, wallId, 'door', 1);
    const id = addOpening(p, wallId, 'window', 3)!;
    expect(resolveOpeningSpan(p, id, { width: 3.9 })).toBeNull();
  });
  it('moves clear of a neighbour', () => {
    const { p, wallId } = room();
    addOpening(p, wallId, 'door', 1);
    const id = addOpening(p, wallId, 'window', 3)!;
    const r = resolveOpeningSpan(p, id, { offset: 1.2 })!;
    expect(r.offset - 1).toBeGreaterThanOrEqual(0.9 / 2 + 1.2 / 2);
  });
});
