import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom } from './operations';
import { derivePlan } from './derived';
import { alignFurniture, distributeFurniture, footprintBox, type AlignEdge } from './arrange';
import { buildPlacementObstacles, collidingObstacles, furnitureObstacles, placementIssues } from './placement';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import type { Furniture, Project } from './schema';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { arrangeMessage, arrangeSelection } from '../ui/arrangeActions';

const T = 0.12;
/** Room with a clear interior 0..4 × 0..3. */
function roomProject(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
  return p;
}

function add(p: Project, x: number, y: number, o: Partial<Furniture> = {}, catalogId = 'generic-sideboard'): Furniture {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), ...o };
  p.furniture.push(f);
  return f;
}

const get = (p: Project, id: string) => p.furniture.find((f) => f.id === id)!;
const box = (p: Project, id: string) => footprintBox(get(p, id));

/** No item collides with walls/door leaves or (not allowed) other furniture. */
function expectNoOverlaps(p: Project) {
  const obstacles = buildPlacementObstacles(derivePlan(p));
  for (const f of p.furniture) {
    const rug = f.category === 'textile' && f.height < 0.05;
    const all = rug ? obstacles.filter((o) => o.kind === 'wall') : [...obstacles, ...furnitureObstacles(p, f)];
    const pose = rug ? { ...f, elevation: 0, height: 1 } : f;
    expect(collidingObstacles(pose, all).map((o) => `${f.name} ↔ ${o.kind} ${o.refId}`)).toEqual([]);
  }
}

/** Three rotated items on a diagonal (their x and y ranges do not overlap). */
function diagonal() {
  const p = roomProject();
  const a = add(p, 0.8, 0.7, { width: 1, depth: 0.6, rotation: Math.PI / 2 }); // x .5..1.1, y .2..1.2
  const b = add(p, 2, 1.5, { width: 0.8, depth: 0.4, rotation: 0 }); // x 1.6..2.4, y 1.3..1.7
  const c = add(p, 3.2, 2.4, { width: 0.6, depth: 0.6, rotation: Math.PI / 4 }); // x 2.776..3.624, y 1.976..2.824
  return { p, ids: [a.id, b.id, c.id] };
}

describe('alignFurniture (#51)', () => {
  const cases: [AlignEdge, (b: ReturnType<typeof footprintBox>) => number, 'x' | 'y', number][] = [
    ['left', (b) => b.minX, 'x', 0.5],
    ['right', (b) => b.maxX, 'x', 3.2 + 0.3 * Math.SQRT2],
    ['top', (b) => b.minY, 'y', 0.2],
    ['bottom', (b) => b.maxY, 'y', 2.4 + 0.3 * Math.SQRT2],
    ['centerX', (b) => (b.minX + b.maxX) / 2, 'x', (0.5 + 3.2 + 0.3 * Math.SQRT2) / 2],
    ['centerY', (b) => (b.minY + b.maxY) / 2, 'y', (0.2 + 2.4 + 0.3 * Math.SQRT2) / 2],
  ];
  for (const [edge, measure, axis, expected] of cases) {
    it(`aligns rotated items: ${edge} (measured on the rotated footprint)`, () => {
      const { p, ids } = diagonal();
      const before = structuredClone(p);
      const r = alignFurniture(p, derivePlan(p), ids, edge);
      expect(r.blocked).toEqual([]);
      for (const id of ids) {
        expect(Math.abs(measure(box(p, id)) - expected)).toBeLessThan(0.0011);
        // only the alignment axis changes, rotation stays
        const o = get(before, id);
        const f = get(p, id);
        expect(f.rotation).toBe(o.rotation);
        if (axis === 'x') expect(f.y).toBe(o.y);
        else expect(f.x).toBe(o.x);
      }
      expectNoOverlaps(p);
    });
  }

  it('stops in front of a wall it cannot pass and reports it', () => {
    const p = roomProject();
    // second room to the right, behind the shared wall at x = 4.06
    addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'B', thickness: T, height: 2.6 });
    const a = add(p, 1, 0.5, { width: 0.8, depth: 0.4 });
    const b = add(p, 5.5, 2, { width: 0.8, depth: 0.4 });
    const r = alignFurniture(p, derivePlan(p), [a.id, b.id], 'left');
    expect(r.blocked).toEqual([b.id]);
    expect(r.moved).toEqual([b.id]);
    // flush (within mm) in front of the wall face at x = 4 + T
    expect(box(p, b.id).minX).toBeGreaterThanOrEqual(4 + T - 1e-6);
    expect(box(p, b.id).minX).toBeLessThan(4 + T + 0.003);
    expect(get(p, b.id).y).toBe(2);
    expectNoOverlaps(p);
    expect(arrangeMessage({ kind: 'align', edge: 'left' }, r).text).toContain('1 von 2 Möbeln konnten wegen Hindernissen nicht ganz ausgerichtet werden');
  });

  it('stops in front of other furniture (also not selected) – no overlap', () => {
    const p = roomProject();
    const a = add(p, 0.6, 1.5, { width: 0.6, depth: 0.4 });
    const block = add(p, 1.6, 1.5, { width: 0.6, depth: 0.6 }); // x 1.3..1.9
    const b = add(p, 3, 1.5, { width: 0.6, depth: 0.4 });
    const c = add(p, 3, 0.5, { width: 0.6, depth: 0.4 });
    const r = alignFurniture(p, derivePlan(p), [a.id, b.id, c.id], 'left');
    expect(r.blocked).toEqual([b.id]);
    expect(box(p, b.id).minX).toBeGreaterThanOrEqual(1.9 - 1e-6);
    expect(box(p, b.id).minX).toBeLessThan(1.9 + 0.003);
    expect(box(p, c.id).minX).toBeCloseTo(0.3, 3);
    expect(get(p, block.id).x).toBe(1.6);
    expect(placementIssues(p, derivePlan(p), get(p, b.id)).filter((i) => i.kind === 'overlap')).toEqual([]);
    expectNoOverlaps(p);
    expect(arrangeMessage({ kind: 'align', edge: 'left' }, r).text).toContain('1 von 3 Möbeln');
  });

  it('a chair may move under a table, a rug under other furniture', () => {
    const p = roomProject();
    const table = add(p, 2, 1, {}, 'generic-dining-table-4'); // y .575..1.425
    const chair = add(p, 2, 2.4, {}, 'generic-chair');
    const r1 = alignFurniture(p, derivePlan(p), [table.id, chair.id], 'top');
    expect(r1.blocked).toEqual([]);
    expect(box(p, chair.id).minY).toBeCloseTo(box(p, table.id).minY, 3);

    const q = roomProject();
    const side = add(q, 1, 0.5, { width: 1.6, depth: 0.45 });
    const rug = add(q, 1.6, 2, { rotation: Math.PI / 2 }, 'generic-rug-160'); // x .45..2.75, y 1.2..2.8
    const other = add(q, 3, 1.5, { width: 0.5, depth: 0.5 });
    const r2 = alignFurniture(q, derivePlan(q), [side.id, rug.id], 'top');
    expect(r2.blocked).toEqual([]);
    expect(box(q, rug.id).minY).toBeCloseTo(box(q, side.id).minY, 3);
    expect(get(q, other.id).x).toBe(3);
    expectNoOverlaps(q);
  });

  it('keeps locked items in place and still aligns the others to them', () => {
    const p = roomProject();
    const a = add(p, 0.8, 0.5, { width: 0.6, depth: 0.4, locked: true });
    const b = add(p, 2.5, 1.5, { width: 0.6, depth: 0.4 });
    const r = alignFurniture(p, derivePlan(p), [a.id, b.id], 'left');
    expect(r.locked).toEqual([a.id]);
    expect(get(p, a.id).x).toBe(0.8);
    expect(box(p, b.id).minX).toBeCloseTo(0.5, 3);
  });
});

describe('distributeFurniture (#51)', () => {
  it('gives equal gaps between the edges for different widths (outer items stay)', () => {
    const p = roomProject();
    const ids = [
      add(p, 0.4, 1.5, { width: 0.4, depth: 0.4 }).id,
      add(p, 1.2, 0.8, { width: 1.0, depth: 0.4, rotation: Math.PI / 2 }).id, // rotated: 0.4 wide in x
      add(p, 2.0, 2.2, { width: 1.0, depth: 0.4 }).id,
      add(p, 3.5, 1.5, { width: 0.6, depth: 0.4 }).id,
    ];
    const before = structuredClone(p);
    const r = distributeFurniture(p, derivePlan(p), ids, 'x');
    expect(r.blocked).toEqual([]);
    const boxes = ids.map((id) => box(p, id)).sort((a, b) => a.minX - b.minX);
    const gaps = boxes.slice(1).map((b, i) => b.minX - boxes[i].maxX);
    // span 0.2..3.8 = 3.6, sizes 0.4 + 0.4 + 1.0 + 0.6 = 2.4 → gap 0.4
    for (const g of gaps) expect(g).toBeCloseTo(0.4, 3);
    expect(get(p, ids[0]).x).toBe(get(before, ids[0]).x);
    expect(get(p, ids[3]).x).toBe(get(before, ids[3]).x);
    for (const id of ids) expect(get(p, id).y).toBe(get(before, id).y);
    expectNoOverlaps(p);
  });

  it('distributes vertically', () => {
    const p = roomProject();
    const ids = [add(p, 1, 0.3, { width: 0.6, depth: 0.4 }).id, add(p, 2, 0.9, { width: 0.6, depth: 0.8 }).id, add(p, 3, 2.6, { width: 0.6, depth: 0.4 }).id];
    distributeFurniture(p, derivePlan(p), ids, 'y');
    const boxes = ids.map((id) => box(p, id));
    expect(boxes[1].minY - boxes[0].maxY).toBeCloseTo(boxes[2].minY - boxes[1].maxY, 3);
  });

  it('changes nothing with fewer than 3 items', () => {
    const p = roomProject();
    const ids = [add(p, 0.5, 1.5, { width: 0.4, depth: 0.4 }).id, add(p, 3, 1.5, { width: 0.4, depth: 0.4 }).id];
    const before = structuredClone(p);
    const r = distributeFurniture(p, derivePlan(p), ids, 'x');
    expect(r.moved).toEqual([]);
    expect(p.furniture).toEqual(before.furniture);
  });

  it('a middle item blocked by a non-selected item stops in front of it', () => {
    const p = roomProject();
    const a = add(p, 0.4, 1.5, { width: 0.4, depth: 0.4 });
    const b = add(p, 3.0, 1.5, { width: 0.4, depth: 0.4 });
    const c = add(p, 3.6, 1.5, { width: 0.4, depth: 0.4 });
    add(p, 2.0, 1.5, { width: 0.4, depth: 0.4 }); // x 1.8..2.2, in b's way
    const r = distributeFurniture(p, derivePlan(p), [a.id, b.id, c.id], 'x');
    expect(r.blocked).toEqual([b.id]);
    expect(box(p, b.id).minX).toBeGreaterThanOrEqual(2.2 - 1e-6);
    expect(box(p, b.id).minX).toBeLessThan(2.2 + 0.003);
    expectNoOverlaps(p);
    expect(arrangeMessage({ kind: 'distribute', axis: 'x' }, r).text).toContain('1 von 3 Möbeln konnten wegen Hindernissen nicht ganz verteilt werden');
  });
});

describe('arrangeSelection (store)', () => {
  beforeEach(() => useUiStore.getState().setSelection(null));

  it('is exactly one undo step; undo restores all positions', () => {
    const { p, ids } = diagonal();
    const s = useProjectStore.getState;
    s().load(p);
    useUiStore.getState().selectFurniture(ids);
    const r = arrangeSelection({ kind: 'align', edge: 'top' });
    expect(r?.moved.length).toBe(2);
    expect(s().past.length).toBe(1);
    for (const id of ids) expect(footprintBox(get(s().project, id)).minY).toBeCloseTo(0.2, 2);
    s().undo();
    expect(s().project.furniture).toEqual(p.furniture);
    // again, but nothing to do → no extra history step
    s().redo();
    const n = s().past.length;
    arrangeSelection({ kind: 'align', edge: 'top' });
    expect(s().past.length).toBe(n);
  });

  it('distribute needs 3 selected items', () => {
    const { p, ids } = diagonal();
    useProjectStore.getState().load(p);
    useUiStore.getState().selectFurniture(ids.slice(0, 2));
    expect(arrangeSelection({ kind: 'distribute', axis: 'x' })).toBeNull();
    expect(useProjectStore.getState().past.length).toBe(0);
  });
});
