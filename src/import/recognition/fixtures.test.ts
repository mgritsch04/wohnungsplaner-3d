import { describe, expect, it } from 'vitest';
import { applyDraft } from '../../formats/floorplan/convert';
import { createEmptyProject } from '../../model/factory';
import { computeBudget } from '../../budget/budget';
import { detectFixtures, type FixtureSegment } from './fixtures';
import type { ReconstructionDraft } from '../draft';

type P = { x: number; y: number };
const poly = (pts: P[], curve = false, close = true): FixtureSegment[] =>
  pts.slice(0, close ? undefined : -1).map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return { x1: p.x, y1: p.y, x2: q.x, y2: q.y, ...(curve ? { curve: true } : {}) };
  });
/** Rounded rectangle (centre c, size w × h, corner radius r) rotated by `rot`. */
function roundedRect(c: P, w: number, h: number, r: number, rot = 0): FixtureSegment[] {
  const out: FixtureSegment[] = [];
  const pts: P[] = [];
  const corners = [
    { x: w / 2 - r, y: h / 2 - r, a: 0 },
    { x: -w / 2 + r, y: h / 2 - r, a: Math.PI / 2 },
    { x: -w / 2 + r, y: -h / 2 + r, a: Math.PI },
    { x: w / 2 - r, y: -h / 2 + r, a: 1.5 * Math.PI },
  ];
  for (const k of corners) for (let n = 0; n <= 4; n++) pts.push({ x: k.x + r * Math.cos(k.a + (n * Math.PI) / 8), y: k.y + r * Math.sin(k.a + (n * Math.PI) / 8) });
  const T = (p: P) => ({ x: c.x + p.x * Math.cos(rot) - p.y * Math.sin(rot), y: c.y + p.x * Math.sin(rot) + p.y * Math.cos(rot) });
  const world = pts.map(T);
  world.forEach((p, i) => {
    const q = world[(i + 1) % world.length];
    // the four straight edges join corner arcs: an arc piece is short, an edge piece is long
    out.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, curve: Math.hypot(q.x - p.x, q.y - p.y) < r });
  });
  return out;
}
const oval = (c: P, l: number, w: number, rot = 0): FixtureSegment[] => {
  const pts: P[] = [];
  for (let n = 0; n < 24; n++) pts.push({ x: c.x + ((l / 2) * Math.cos((n * Math.PI) / 12)) * Math.cos(rot) - ((w / 2) * Math.sin((n * Math.PI) / 12)) * Math.sin(rot), y: c.y + ((l / 2) * Math.cos((n * Math.PI) / 12)) * Math.sin(rot) + ((w / 2) * Math.sin((n * Math.PI) / 12)) * Math.cos(rot) });
  return poly(pts, true);
};
const room: { polygon: P[]; name: string } = { polygon: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 3 }, { x: 0, y: 3 }], name: 'Bad' };
const walls = [
  { a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.12 },
  { a: { x: 4, y: 0 }, b: { x: 4, y: 3 }, thickness: 0.12 },
  { a: { x: 4, y: 3 }, b: { x: 0, y: 3 }, thickness: 0.12 },
  { a: { x: 0, y: 3 }, b: { x: 0, y: 0 }, thickness: 0.12 },
];

describe('sanitary fixtures from plan symbols (#255)', () => {
  it('finds a bathtub in the corner, facing away from the wall, with the drawn size', () => {
    const f = detectFixtures(roundedRect({ x: 1.0, y: 0.5 }, 1.6, 0.7, 0.1), walls, [room]);
    expect(f).toHaveLength(1);
    expect(f[0].catalogId).toBe('generic-bathtub');
    expect(f[0].center.x).toBeCloseTo(1.0, 1);
    expect(f[0].width).toBeCloseTo(1.6, 1);
    expect(f[0].depth).toBeCloseTo(0.7, 1);
    // back (local -y) points to the wall at y = 0: rotation 0 has the back at -y
    expect(Math.abs(f[0].rotation)).toBeLessThan(0.1);
  });

  it('turns a tub on the opposite wall and a rotated one', () => {
    const f = detectFixtures(roundedRect({ x: 1.0, y: 2.5 }, 1.6, 0.7, 0.1), walls, [room]);
    expect(Math.abs(Math.abs(f[0].rotation) - Math.PI)).toBeLessThan(0.1);
    const g = detectFixtures(roundedRect({ x: 0.5, y: 1.5 }, 1.6, 0.7, 0.1, Math.PI / 2), walls, [room]);
    expect(g[0].catalogId).toBe('generic-bathtub');
    // back to the wall at x = 0: local -y = (sinθ, -cosθ) must point to -x
    expect(Math.sin(g[0].rotation)).toBeLessThan(-0.9);
  });

  it('finds a washbasin (oval) and a WC (long oval)', () => {
    const basin = detectFixtures(oval({ x: 2, y: 0.3 }, 0.5, 0.4), walls, [room]);
    expect(basin.map((x) => x.catalogId)).toEqual(['generic-washbasin']);
    const wc = detectFixtures(oval({ x: 3, y: 0.4 }, 0.7, 0.36), walls, [room]);
    expect(wc.map((x) => x.catalogId)).toEqual(['generic-toilet']);
    // WC back to the wall at y = 0
    expect(wc[0].center.y).toBeCloseTo(0.4, 1);
  });

  it('ignores plain rectangles (furniture), wall lines, open shapes and shapes outside rooms', () => {
    expect(detectFixtures(poly([{ x: 1, y: 1 }, { x: 2.7, y: 1 }, { x: 2.7, y: 1.75 }, { x: 1, y: 1.75 }]), walls, [room])).toHaveLength(0);
    expect(detectFixtures(roundedRect({ x: 1, y: 1 }, 1.6, 0.7, 0.1).slice(0, 12), walls, [room])).toHaveLength(0);
    expect(detectFixtures(roundedRect({ x: 9, y: 9 }, 1.6, 0.7, 0.1), walls, [room])).toHaveLength(0);
  });

  it('lowers the confidence outside a bathroom', () => {
    const bad = detectFixtures(oval({ x: 2, y: 0.3 }, 0.5, 0.4), walls, [room])[0];
    const living = detectFixtures(oval({ x: 2, y: 0.3 }, 0.5, 0.4), walls, [{ ...room, name: 'Wohnzimmer' }])[0];
    expect(living.confidence).toBeLessThan(bad.confidence);
  });
});

/** Square outline of half-size h, dashed (dash 5 cm, gap 4 cm), plus a drum circle. */
function washerSymbol(c: P, side: number): FixtureSegment[] {
  const out: FixtureSegment[] = [];
  const h = side / 2;
  const edge = (x1: number, y1: number, x2: number, y2: number) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    for (let t = 0; t < len; t += 0.09) {
      const e = Math.min(t + 0.05, len);
      out.push({ x1: x1 + ((x2 - x1) * t) / len, y1: y1 + ((y2 - y1) * t) / len, x2: x1 + ((x2 - x1) * e) / len, y2: y1 + ((y2 - y1) * e) / len });
    }
  };
  edge(c.x - h, c.y - h, c.x + h, c.y - h);
  edge(c.x + h, c.y - h, c.x + h, c.y + h);
  edge(c.x + h, c.y + h, c.x - h, c.y + h);
  edge(c.x - h, c.y + h, c.x - h, c.y - h);
  return [...out, ...oval(c, side * 0.6, side * 0.6)];
}

describe('flush and washer symbols', () => {
  it('finds a 1.8 m tub whose back edge lies on the wall face', () => {
    const f = detectFixtures(roundedRect({ x: 1.2, y: 0.06 + 0.375 }, 1.8, 0.75, 0.1), walls, [room]);
    expect(f.map((x) => x.catalogId)).toEqual(['generic-bathtub']);
  });

  it('finds a washing machine (dashed square with circle)', () => {
    const f = detectFixtures(washerSymbol({ x: 3.5, y: 2.6 }, 0.6), walls, [{ ...room, name: 'Bad' }]);
    expect(f).toHaveLength(1);
    expect(f[0].catalogId).toBe('generic-washer');
    expect(f[0].center.x).toBeCloseTo(3.5, 1);
    expect(f[0].width).toBeCloseTo(0.6, 1);
  });

  it('calls the same symbol in a kitchen a dishwasher, and ignores a bare circle', () => {
    expect(detectFixtures(washerSymbol({ x: 3.5, y: 2.6 }, 0.6), walls, [{ ...room, name: 'Küche' }])[0].catalogId).toBe('generic-k-dishwasher');
    expect(detectFixtures(oval({ x: 2, y: 1.5 }, 0.36, 0.36), walls, [room])).toHaveLength(0);
  });
});

describe('fixtures as existing furniture (#255)', () => {
  const draft = (): ReconstructionDraft => ({
    source: 'pdf-vector', sourceName: 'x', scaleConfirmed: true, walls: [], openings: [], rooms: [], furniture: [], warnings: [], mode: 'merge',
    fixtures: [
      { id: 'a', catalogId: 'generic-bathtub', name: 'Badewanne', center: { x: 1, y: 1 }, rotation: 0, width: 1.6, depth: 0.7, status: 'uncertain', accepted: true },
      { id: 'b', catalogId: 'generic-toilet', name: 'WC', center: { x: 2, y: 1 }, rotation: 0, width: 0.37, depth: 0.54, status: 'uncertain', accepted: false },
    ],
  });

  it('applies only accepted fixtures, marked as existing and without price', () => {
    const p = createEmptyProject();
    const r = applyDraft(p, draft());
    expect(r.fixturesAdded).toBe(1);
    expect(p.furniture).toHaveLength(1);
    expect(p.furniture[0]).toMatchObject({ catalogId: 'generic-bathtub', existing: true, width: 1.6, depth: 0.7 });
    expect(p.furniture[0].price).toBeUndefined();
  });

  it('keeps existing items out of the budget', () => {
    const p = createEmptyProject();
    applyDraft(p, draft());
    expect(computeBudget(p.furniture).lines).toHaveLength(0);
  });
});
