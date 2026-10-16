import { describe, expect, it } from 'vitest';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { findNarrowPassages, passageLabel } from './passages';
import { ProjectSchema, type Project } from './schema';

const props = { thickness: 0.12, height: 2.6 };

/** 6 × 5 m room, interior x 0..6, y 0..5 */
function room() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 5, name: 'R', ...props });
  return p;
}

function box(p: Project, catalogId: string, x: number, y: number, width = 1, depth = 1, extra: Record<string, unknown> = {}) {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), x, y, width, depth, rotation: 0, ...extra };
  p.furniture.push(f);
  return f;
}

const find = (p: Project, min?: number) => findNarrowPassages(p, derivePlan(p), min);

describe('narrow passages (#68)', () => {
  it('finds a narrow gap between two pieces of furniture with both end points and references', () => {
    const p = room();
    const a = box(p, 'generic-sideboard', 2, 2.5); // x 1.5 … 2.5
    const b = box(p, 'generic-dresser', 3.6, 2.5); // x 3.1 … 4.1 → 60 cm gap
    const res = find(p);
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe('furniture');
    expect(res[0].width).toBeCloseTo(0.6, 6);
    expect(passageLabel(res[0].width)).toBe('60 cm');
    expect(res[0].a.x).toBeCloseTo(2.5, 6);
    expect(res[0].b.x).toBeCloseTo(3.1, 6);
    expect(res[0].refs.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('ignores wide gaps and furniture put together on purpose', () => {
    const p = room();
    box(p, 'generic-sideboard', 2, 2.5);
    const b = box(p, 'generic-dresser', 4.2, 2.5); // 1.2 m gap
    expect(find(p)).toEqual([]);
    b.x = 3.03; // 3 cm gap: assembled
    expect(find(p)).toEqual([]);
    b.x = 3; // touching
    expect(find(p)).toEqual([]);
  });

  it('does not treat rugs, curtains or wall-hung items as obstacles', () => {
    const p = room();
    box(p, 'generic-sideboard', 2, 2.5);
    box(p, 'generic-rug-200', 3.6, 2.5, 1, 1);
    box(p, 'generic-k-wall-60', 2, 1.6, 1, 0.35, { elevation: 1.45 });
    expect(find(p)).toEqual([]);
  });

  it('skips pairs that may overlap by design (chair at a table)', () => {
    const p = room();
    box(p, 'generic-dining-table-4', 3, 2.5, 1.2, 0.8);
    box(p, 'generic-chair', 3, 3.3, 0.45, 0.45); // 18 cm from the table edge
    expect(find(p)).toEqual([]);
  });

  it('skips sofa + coffee table and small items like a floor lamp', () => {
    const p = room();
    box(p, 'generic-sofa-3', 3, 3.5, 2.1, 0.9); // y 3.05 … 3.95
    box(p, 'generic-coffee-table', 3, 2.45, 1.1, 0.6); // 30 cm legroom
    box(p, 'generic-floor-lamp', 4.6, 3.5, 0.35, 0.35); // 32 cm next to the sofa
    expect(find(p)).toEqual([]);
  });

  it('only counts gaps no third item blocks', () => {
    const p = room();
    box(p, 'generic-sideboard', 2, 2.5);
    box(p, 'generic-dresser', 3.6, 2.5);
    box(p, 'generic-plant', 2.8, 2.5, 0.3, 0.3); // stands right in the gap
    // the gap between the two cabinets is blocked; a small plant itself forms no passage
    expect(find(p)).toEqual([]);
    p.furniture[2].x = 2.8;
    p.furniture[2].y = 4; // moved out of the gap → the cabinets' gap counts again
    expect(find(p)).toHaveLength(1);
  });

  it('wall gaps: standing at the wall is fine, a squeezed path along the wall is not', () => {
    const p = room();
    const f = box(p, 'generic-sideboard', 3, 0.6, 1.6, 0.4); // y 0.4 … 0.8 → 40 cm to the north wall
    let res = find(p);
    expect(res).toHaveLength(1);
    expect(res[0].kind).toBe('wall');
    expect(res[0].width).toBeCloseTo(0.4, 6);
    expect(res[0].refs[0]).toEqual({ type: 'furniture', id: f.id });
    expect(res[0].refs[1].type).toBe('wall');
    expect(res[0].b.y).toBeCloseTo(0, 6); // on the wall face
    f.y = 0.3; // 10 cm: placed at the wall, no path behind it (< 25 cm)
    res = find(p);
    expect(res).toEqual([]);
  });

  it('warns about doors narrower than the minimum', () => {
    const p = room();
    const north = closestWall(p, { x: 3, y: -0.06 })!;
    const doorId = addOpening(p, north.wall.id, 'door', north.s, { width: 0.8 })!;
    const res = find(p);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ kind: 'opening', refs: [{ type: 'opening', id: doorId }] });
    expect(res[0].width).toBeCloseTo(0.8, 6);
    expect(find(p, 0.8)).toEqual([]); // exactly the minimum is fine
    const win = closestWall(p, { x: 6.06, y: 2.5 })!;
    addOpening(p, win.wall.id, 'window', win.s, { width: 0.6 });
    expect(find(p, 0.8)).toEqual([]); // windows are not passages
  });

  it('uses the adjustable minimum width', () => {
    const p = room();
    box(p, 'generic-sideboard', 2, 2.5);
    box(p, 'generic-dresser', 3.6, 2.5);
    p.settings.minPassageWidth = 0.6;
    expect(find(p)).toEqual([]);
    p.settings.minPassageWidth = 0.7;
    expect(find(p)).toHaveLength(1);
  });

  it('old projects load with the default and the range is enforced', () => {
    const raw = structuredClone(createEmptyProject()) as unknown as { settings: Record<string, unknown> };
    delete raw.settings.minPassageWidth;
    delete raw.settings.showNarrowPassages;
    const s = ProjectSchema.parse(raw).settings;
    expect(s.minPassageWidth).toBe(0.9);
    expect(s.showNarrowPassages).toBe(true);
    expect(() => ProjectSchema.parse({ ...raw, settings: { ...raw.settings, minPassageWidth: 0.5 } })).toThrow();
    expect(() => ProjectSchema.parse({ ...raw, settings: { ...raw.settings, minPassageWidth: 1.6 } })).toThrow();
  });

  it('stays well below one frame for 25 furnished rooms', () => {
    const p = createEmptyProject();
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const x0 = i * 4.12;
        const y0 = j * 3.62;
        addRectRoom(p, { x: x0, y: y0, width: 4, depth: 3.5, name: `R${i}-${j}`, ...props });
        box(p, 'generic-sofa-3', x0 + 1.2, y0 + 0.5, 2.1, 0.9);
        box(p, 'generic-coffee-table', x0 + 1.2, y0 + 1.6, 1.1, 0.6);
        box(p, 'generic-sideboard', x0 + 3.4, y0 + 2.8, 1, 0.4);
        box(p, 'generic-dresser', x0 + 1.5, y0 + 3.2, 0.8, 0.5);
      }
    const d = derivePlan(p);
    findNarrowPassages(p, d); // warm-up
    // best of several runs: parallel test processes on a busy machine inflate single
    // measurements; the fastest run reflects the code, not the load
    let n = 0;
    let ms = Infinity;
    for (let k = 0; k < 7; k++) {
      const t0 = performance.now();
      n = findNarrowPassages(p, d).length;
      ms = Math.min(ms, performance.now() - t0);
    }
    console.log(`Engstellen (25 Räume, 100 Möbel): ${ms.toFixed(2)} ms, ${n} Engstellen`);
    expect(n).toBeGreaterThan(0);
    // computed once after a drag ends (not per frame): one frame is the bar; the cloud CI
    // machine measures ~8–11 ms here, a desktop well below 8 ms
    expect(ms).toBeLessThan(16);
  });
});
