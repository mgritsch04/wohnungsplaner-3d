import { describe, expect, it } from 'vitest';
import { applyDraft } from '../../formats/floorplan/convert';
import { createEmptyProject } from '../../model/factory';
import type { ReconstructionDraft } from '../draft';
import { detectInstallations } from './installations';
import type { FixtureSegment } from './fixtures';

type P = { x: number; y: number };
const seg = (a: P, b: P, curve = false): FixtureSegment => ({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(curve ? { curve: true } : {}) });
const loop = (pts: P[], curve = false) => pts.map((p, i) => seg(p, pts[(i + 1) % pts.length], curve));
const circle = (c: P, r: number): FixtureSegment[] => loop(Array.from({ length: 16 }, (_, n) => ({ x: c.x + r * Math.cos((n * Math.PI) / 8), y: c.y + r * Math.sin((n * Math.PI) / 8) })), true);

// symbols, drawn the way the synthetic plans of the tests are (see detectInstallations)
const socket = (c: P, r = 0.1) => [...circle(c, r), seg({ x: c.x - r, y: c.y }, { x: c.x + r, y: c.y })];
const sw = (c: P, r = 0.08) => [...circle(c, r), seg({ x: c.x + r, y: c.y }, { x: c.x + 3 * r, y: c.y + 2 * r })];
const water = (c: P, r = 0.08) => {
  const k = r / Math.SQRT2; // the arms end on the ring
  return [...circle(c, r), seg({ x: c.x - k, y: c.y - k }, { x: c.x + k, y: c.y + k }), seg({ x: c.x - k, y: c.y + k }, { x: c.x + k, y: c.y - k })];
};
const lan = (c: P, s = 0.2) => loop([{ x: c.x - s / 2, y: c.y + s / 2 }, { x: c.x + s / 2, y: c.y + s / 2 }, { x: c.x, y: c.y - s / 2 }]);
const drain = (c: P, h = 0.07) => {
  const q = [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }];
  return [...loop(q), seg(q[0], q[2]), seg(q[1], q[3])];
};
const radiator = (c: P, l = 1.0, w = 0.1) => loop([{ x: c.x - l / 2, y: c.y - w / 2 }, { x: c.x + l / 2, y: c.y - w / 2 }, { x: c.x + l / 2, y: c.y + w / 2 }, { x: c.x - l / 2, y: c.y + w / 2 }]);

const T = 0.2;
const walls = [
  { a: { x: 0, y: 0 }, b: { x: 5, y: 0 }, thickness: T },
  { a: { x: 5, y: 0 }, b: { x: 5, y: 4 }, thickness: T },
  { a: { x: 5, y: 4 }, b: { x: 0, y: 4 }, thickness: T },
  { a: { x: 0, y: 4 }, b: { x: 0, y: 0 }, thickness: T },
];
/** The two faces of the south wall as a CAD export draws them – long lines that must not count as symbols. */
const faces = [seg({ x: 0, y: 0.1 }, { x: 5, y: 0.1 }), seg({ x: 0, y: -0.1 }, { x: 5, y: -0.1 })];
const bath = { polygon: [{ x: 0.1, y: 0.1 }, { x: 4.9, y: 0.1 }, { x: 4.9, y: 3.9 }, { x: 0.1, y: 3.9 }], name: 'Bad' };
const living = { ...bath, name: 'Wohnzimmer' };

describe('installation symbols (#222)', () => {
  it('reads socket, switch, LAN, water, drain and radiator at the walls', () => {
    const segs = [
      ...faces,
      ...socket({ x: 1.0, y: 0.3 }),
      ...sw({ x: 2.0, y: 0.3 }),
      ...lan({ x: 3.0, y: 0.3 }),
      ...water({ x: 4.0, y: 0.3 }),
      ...drain({ x: 4.5, y: 0.3 }),
      ...radiator({ x: 2.5, y: 3.65 }),
    ];
    const found = detectInstallations(segs, walls, [bath]);
    const by = (s: string) => found.filter((f) => f.symbol === s);
    expect(found).toHaveLength(6);
    expect(by('socket')[0].center.x).toBeCloseTo(1.0, 2);
    expect(by('switch')[0].kind).toBe('switch');
    expect(by('lan')[0].kind).toBe('socket');
    expect(by('water')[0].kind).toBe('water');
    expect(by('drain')[0].kind).toBe('drain');
    expect(by('radiator')[0].width).toBeCloseTo(1.0, 1);
    expect(found.every((f) => f.confidence >= 0.6)).toBe(true);
  });

  it('marks a connection outside a wet room as unsure; leaves plain circles, lamps and furniture alone', () => {
    const wet = detectInstallations(water({ x: 4.0, y: 0.3 }), walls, [living]);
    expect(wet).toHaveLength(1);
    expect(wet[0].confidence).toBeLessThan(0.6);
    expect(wet[0].note).toContain('unsicher');
    const none = detectInstallations([...circle({ x: 2, y: 0.3 }, 0.1), ...radiator({ x: 2.5, y: 2 }), ...socket({ x: 2.5, y: 2 })], walls, [living]);
    // plain circle: ignored; radiator and socket in the middle of the room: too far from a wall
    expect(none).toHaveLength(0);
  });

  it('a plan without symbols gives nothing', () => {
    expect(detectInstallations(faces, walls, [bath])).toEqual([]);
    expect(detectInstallations([], [], [])).toEqual([]);
  });

  it('puts accepted installations on the right wall, rotated into the room; leaves unaccepted ones out', () => {
    const wall = (id: string, a: P, b: P) => ({ id, a, b, thickness: T, height: 2.5, status: 'confirmed' as const, accepted: true });
    const draft: ReconstructionDraft = {
      source: 'pdf-vector',
      sourceName: 'synthetic',
      scaleConfirmed: true,
      walls: [wall('w1', { x: 0, y: 0 }, { x: 5, y: 0 }), wall('w2', { x: 5, y: 0 }, { x: 5, y: 4 }), wall('w3', { x: 5, y: 4 }, { x: 0, y: 4 }), wall('w4', { x: 0, y: 4 }, { x: 0, y: 0 })],
      openings: [],
      rooms: [],
      furniture: [],
      installations: [
        { id: 'i1', kind: 'socket', center: { x: 1, y: 0.3 }, elevation: 0.3, status: 'estimated', accepted: true },
        { id: 'i2', kind: 'water', center: { x: 4.8, y: 2 }, elevation: 0.55, status: 'estimated', accepted: true },
        { id: 'i3', kind: 'socket', center: { x: 1, y: 0.3 }, fixtureNote: 'LAN / Daten', elevation: 0.3, status: 'estimated', accepted: true },
        { id: 'i4', kind: 'switch', center: { x: 2, y: 0.3 }, elevation: 1.05, status: 'uncertain', accepted: false },
        { id: 'i5', kind: 'socket', center: { x: 2.5, y: 2 }, elevation: 0.3, status: 'estimated', accepted: true },
      ],
      warnings: [],
      mode: 'replace',
    };
    const p = createEmptyProject();
    const r = applyDraft(p, draft);
    expect(r.installationsAdded).toBe(3);
    expect(r.warnings.some((w) => w.includes('liegt an keiner Wand'))).toBe(true);
    expect(p.fixtures).toHaveLength(3);
    const [s, w, l] = p.fixtures;
    expect(s.kind).toBe('socket');
    expect(s.y).toBeGreaterThan(0.1); // in front of the wall face, in the room
    expect(s.rotation).toBeCloseTo(0, 2);
    expect(w.kind).toBe('water');
    expect(w.x).toBeLessThan(4.9);
    expect(l.note).toBe('LAN / Daten');
  });
});

describe('no invented installations near openings (#371)', () => {
  it('drops a symbol-like shape inside a door opening', () => {
    const segs = [...faces, ...socket({ x: 1.0, y: 0.3 })];
    expect(detectInstallations(segs, walls, [living], [{ center: { x: 1.1, y: 0 }, width: 0.9 }])).toHaveLength(0);
    expect(detectInstallations(segs, walls, [living], [])).toHaveLength(1);
  });
  it('drops a socket that floats far from any wall face', () => {
    const segs = [...faces, ...socket({ x: 1.0, y: 0.45 })];
    expect(detectInstallations(segs, walls, [living])).toHaveLength(0);
  });
});
