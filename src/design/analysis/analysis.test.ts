import { describe, expect, it } from 'vitest';
import { derivePlan, type DerivedPlan } from '../../model/derived';
import type { Project } from '../../model/schema';
import { add, cross, dist, dot, pointInPolygon, polygonCentroid, scale, signedArea, sub } from '../../model/vec';
import { roomEdges } from '../../suggest/roomGeometry';
import { FLAT_KEYS, TEST_FLATS } from '../fixtures/flats';
import type { FlatAnalysis, RoomAnalysis } from '../types';
import { analyzeFlat, WAY_WIDTH } from './flat';
import { checkWalkways, walkGrid, walkRoute } from './walk';

/** Room on the far side of an opening, read straight from the model walls (independent of the analysis). */
function otherSide(p: Project, d: DerivedPlan, openingId: string, roomId: string): string | null {
  const o = p.openings.find((x) => x.id === openingId)!;
  const fp = d.footprints.get(o.wallId)!;
  const r = d.openings.get(o.wallId)!.find((x) => x.opening.id === openingId)!;
  const c = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
  const sides = [1, -1].map((s) => {
    const probe = add(c, scale(fp.normal, s * (fp.thickness / 2 + 0.2)));
    return p.rooms.find((room) => pointInPolygon(probe, d.rooms.get(room.id)!.interior))?.id ?? null;
  });
  expect(sides).toContain(roomId);
  return sides[0] === roomId ? sides[1] : sides[0];
}

const room = (flat: FlatAnalysis, name: string): RoomAnalysis => flat.rooms.find((r) => r.name === name)!;
const openings = (r: RoomAnalysis) => r.walls.flatMap((w) => w.openings);

describe.each(FLAT_KEYS)('Raum lesen, Testwohnung %s', (key) => {
  const t = TEST_FLATS[key];
  const p = t.build();
  const d = derivePlan(p);
  const flat = analyzeFlat(p, d);

  it('reads every room, with the entrance where the plan has it', () => {
    expect(flat.rooms.map((r) => r.name).sort()).toEqual(Object.keys(t.rooms).sort());
    expect(flat.entranceRoomId).toBe(p.rooms.find((r) => r.name === t.entrance)!.id);
    expect(flat.rooms.filter((r) => r.entrance).map((r) => r.name)).toEqual([t.entrance]);
  });

  it.each(Object.keys(t.rooms))('%s: doors, windows, corners and pass-through as in the plan', (name) => {
    const truth = t.rooms[name];
    const r = room(flat, name);
    expect({
      doors: openings(r).filter((o) => o.kind !== 'window').length,
      windows: openings(r).filter((o) => o.kind === 'window').length,
      corners: r.corners.length,
      reflex: r.corners.filter((c) => c.reflex).length,
      passThrough: r.passThrough,
    }).toEqual({ doors: truth.doors, windows: truth.windows, corners: truth.corners, reflex: truth.reflex ?? 0, passThrough: !!truth.passThrough });
  });

  it('numbers the walls clockwise from the north-west corner, one per straight side', () => {
    for (const r of flat.rooms) {
      expect(signedArea(r.polygon), r.name).toBeGreaterThan(0);
      expect(r.walls.map((w) => w.id)).toEqual(r.walls.map((_, i) => `W${i + 1}`));
      expect(r.corners.length).toBe(r.walls.length);
      r.walls.forEach((w, i) => {
        const next = r.walls[(i + 1) % r.walls.length];
        expect(dist(w.b, next.a), `${r.name} ${w.id}`).toBeLessThan(1e-9);
        // no straight-through corner: neighbouring walls are never collinear
        expect(Math.abs(cross(w.dir, next.dir)), `${r.name} ${w.id}`).toBeGreaterThan(0.01);
        expect(pointInPolygon(add(scale(add(w.a, w.b), 0.5), scale(w.inward, 0.05)), r.polygon), `${r.name} ${w.id}`).toBe(true);
      });
      // W1 starts at the corner closest to the north-west corner of the bounding box
      const nw = (q: { x: number; y: number }) => Math.hypot(q.x - r.origin.x, q.y - r.origin.y);
      expect(Math.min(...r.polygon.map(nw))).toBeCloseTo(nw(r.walls[0].a), 9);
    }
  });

  it('labels openings in wall order and finds where each door leads', () => {
    for (const r of flat.rooms) {
      const all = openings(r);
      expect(all.filter((o) => o.kind !== 'window').map((o) => o.id)).toEqual(all.filter((o) => o.kind !== 'window').map((_, i) => `T${i + 1}`));
      expect(all.filter((o) => o.kind === 'window').map((o) => o.id)).toEqual(all.filter((o) => o.kind === 'window').map((_, i) => `F${i + 1}`));
      for (const o of all) {
        expect(o.toRoomId, `${r.name} ${o.id}`).toBe(otherSide(p, d, o.openingId, r.roomId));
        if (o.kind === 'window') expect(o.sill! < o.top!).toBe(true);
        if (o.swingsIn) expect(pointInPolygon(polygonCentroid(o.swing!), r.polygon), `${r.name} ${o.id}`).toBe(true);
      }
      for (const w of r.walls)
        for (const s of w.free) {
          expect(s.t1 - s.t0).toBeGreaterThanOrEqual(0.6 - 1e-9);
          expect(w.openings.some((o) => o.t0 < s.t1 - 1e-6 && o.t1 > s.t0 + 1e-6)).toBe(false);
        }
    }
  });

  it('links the rooms through their doors, the same opening on both sides', () => {
    for (const l of flat.links) {
      const a = openings(flat.rooms.find((r) => r.roomId === l.a)!).find((o) => o.id === l.openingA)!;
      const b = openings(flat.rooms.find((r) => r.roomId === l.b)!).find((o) => o.id === l.openingB)!;
      expect(a.openingId).toBe(b.openingId);
      expect([a.toRoomId, b.toRoomId]).toEqual([l.b, l.a]);
    }
    const passable = flat.rooms.flatMap((r) => openings(r).filter((o) => o.passable && o.toRoomId).map((o) => o.openingId));
    expect(new Set(passable).size).toBe(flat.links.length);
  });

  it('keeps ways between the doors, wide enough and inside the room', () => {
    for (const r of flat.rooms) {
      const doors = openings(r).filter((o) => o.passable);
      const pairs = (doors.length * (doors.length - 1)) / 2;
      expect(r.walkways.length, r.name).toBe(doors.length <= 4 ? pairs : doors.length - 1);
      expect(r.notes, r.name).toEqual([]);
      const width = r.typeFromName === 'hall' || r.passThrough ? WAY_WIDTH.main : WAY_WIDTH.other;
      const g = walkGrid(r.polygon);
      for (const w of r.walkways) {
        expect(w.width, `${r.name} ${w.from}–${w.to}`).toBe(width);
        expect(w.path.length).toBeGreaterThanOrEqual(2);
        // the inner points keep half the width to the walls
        for (const q of w.path.slice(1, -1)) expect(pointInPolygon(q, r.polygon)).toBe(true);
        expect(walkRoute(g, w.path[1], w.path[w.path.length - 2], width - 0.06)).not.toBeNull();
      }
      if (r.mainDoor) expect(doors.map((o) => o.id)).toContain(r.mainDoor);
    }
  });

  it('reads a room in well under 50 ms', () => {
    analyzeFlat(p, d);
    const t0 = performance.now();
    analyzeFlat(p, d);
    expect((performance.now() - t0) / flat.rooms.length).toBeLessThan(50);
  });
});

describe('Raum lesen, besondere Fälle', () => {
  it('A: the long hall has four walls, not the nine pieces of its T-junctions', () => {
    const p = TEST_FLATS.A.build();
    const d = derivePlan(p);
    const hall = room(analyzeFlat(p, d), 'Gang');
    expect(roomEdges(d.rooms.get(hall.roomId)!.interior, d).length).toBe(9);
    expect(hall.walls.map((w) => w.side)).toEqual(['N', 'O', 'S', 'W']);
    expect(hall.corners.every((c) => !c.reflex)).toBe(true);
    // eight doors: one way from the entrance door to each of the seven others
    expect(hall.walkways).toHaveLength(7);
    expect(hall.walkways.every((w) => w.main && [w.from, w.to].includes(hall.mainDoor!))).toBe(true);
  });

  it('B: the Wohnküche is a pass-through room with three free ways of 90 cm', () => {
    const flat = analyzeFlat(TEST_FLATS.B.build());
    const r = room(flat, 'Wohnküche');
    expect(r.passThrough).toBe(true);
    expect(r.walkways.map((w) => [w.from, w.to, w.width, w.main])).toEqual([
      ['T1', 'T2', 0.9, false],
      ['T1', 'T3', 0.9, true],
      ['T2', 'T3', 0.9, true],
    ]);
    // one comes in from the hall in the west and looks east at the window
    expect(r.mainDoor).toBe('T3');
    expect(r.entryView).toMatchObject({ door: 'T3', wall: 'W2' });
    expect(openings(r).find((o) => o.id === 'T1')!.toRoomId).toBe(room(flat, 'Balkon').roomId);
    expect(room(flat, 'Schlafzimmer').passThrough).toBe(false);
  });

  it('E: the bay has two slanted walls with windows, and its shoulders stick into the room', () => {
    const r = room(analyzeFlat(TEST_FLATS.E.build()), 'Wohnzimmer');
    const slanted = r.walls.filter((w) => w.side === null);
    expect(slanted).toHaveLength(2);
    expect(slanted.every((w) => w.openings.length === 1 && w.openings[0].kind === 'window')).toBe(true);
    expect(r.corners.filter((c) => c.reflex).map((c) => c.walls)).toEqual([
      ['W1', 'W2'],
      ['W4', 'W5'],
    ]);
    expect(r.height).toBeCloseTo(3.3, 6);
    expect(r.walls.find((w) => w.side === 'W')!.thickness).toBeCloseTo(0.15, 6);
    expect(r.walls[0].thickness).toBeCloseTo(0.45, 6);
  });

  it('E: the study is reached only through the living room', () => {
    const flat = analyzeFlat(TEST_FLATS.E.build());
    const study = room(flat, 'Arbeitszimmer');
    const living = room(flat, 'Wohnzimmer');
    expect(flat.links.filter((l) => l.a === study.roomId || l.b === study.roomId).map((l) => (l.a === study.roomId ? l.b : l.a))).toEqual([living.roomId]);
    const main = living.walkways.filter((w) => w.main);
    expect(main.map((w) => [w.from, w.to])).toEqual([['T1', living.mainDoor]]);
  });

  it('F: existing kitchen, marked areas and the glazed element next to the loggia door', () => {
    const p = TEST_FLATS.F.build();
    const flat = analyzeFlat(p);
    const r = room(flat, 'Wohnküche');
    expect(r.existing.length).toBeGreaterThanOrEqual(8);
    expect(r.userZones.map((z) => [z.id, z.keepFree])).toEqual([['Z1', true]]);
    expect(room(flat, 'Schlafzimmer').userZones.map((z) => [z.id, z.purpose, z.keepFree])).toEqual([['Z2', 'Leseplatz', false]]);
    const glass = openings(r).find((o) => o.kind === 'window' && o.sill! < 0.05)!;
    expect(glass.toRoomId).toBe(room(flat, 'Loggia').roomId);
    expect(glass.passable).toBe(false);
    expect(room(flat, 'Schlafzimmer').passThrough).toBe(true);
  });

  it('F without the loggia door: the glazed element becomes the way onto the loggia', () => {
    const p = TEST_FLATS.F.build();
    const d0 = derivePlan(p);
    const loggia = p.rooms.find((x) => x.name === 'Loggia')!;
    // the loggia door lies in the wall along y = 8.6, the loggia south of it
    const door = p.openings.find((o) => o.kind === 'door' && pointInPolygon(add(openingCentre(p, d0, o.id), { x: 0, y: 0.25 }), d0.rooms.get(loggia.id)!.interior))!;
    p.openings = p.openings.filter((o) => o !== door);
    const flat = analyzeFlat(p);
    const r = room(flat, 'Wohnküche');
    const glass = openings(r).find((o) => o.kind === 'window' && o.sill! < 0.05)!;
    expect(glass.passable).toBe(true);
    expect(flat.links.some((l) => [l.a, l.b].includes(loggia.id))).toBe(true);
    expect(r.walkways.some((w) => [w.from, w.to].includes(glass.id))).toBe(true);
  });

  it('C: the L-shaped hall has six walls and one corner sticking into it', () => {
    const r = room(analyzeFlat(TEST_FLATS.C.build()), 'Vorraum');
    expect(r.walls).toHaveLength(6);
    expect(r.corners.filter((c) => c.reflex)).toHaveLength(1);
    expect(r.entrance && r.passThrough).toBe(true);
  });

  it('places a radiator on the wall under its window', () => {
    const p = TEST_FLATS.B.build();
    const flat0 = analyzeFlat(p);
    const r0 = room(flat0, 'Schlafzimmer');
    const w = r0.walls.find((x) => x.openings.some((o) => o.kind === 'window'))!;
    const win = w.openings.find((o) => o.kind === 'window')!;
    const at = add(add(w.a, scale(w.dir, (win.t0 + win.t1) / 2)), scale(w.inward, 0.05));
    p.fixtures.push({ id: 'fx_radiator', kind: 'radiator', x: at.x, y: at.y, rotation: 0, elevation: 0.15, width: 1.0, height: 0.6, count: 1 });
    const r = room(analyzeFlat(p), 'Schlafzimmer');
    expect(r.fixtures).toHaveLength(1);
    expect(r.fixtures[0]).toMatchObject({ kind: 'radiator', wall: w.id, width: 1.0 });
    expect(r.fixtures[0].t).toBeCloseTo((win.t0 + win.t1) / 2, 6);
  });
});

describe('Wege im eingerichteten Raum', () => {
  const flat = analyzeFlat(TEST_FLATS.B.build());
  const r = room(flat, 'Wohnküche');
  const box = (x0: number, y0: number, x1: number, y1: number) => [
    { x: r.origin.x + x0, y: r.origin.y + y0 },
    { x: r.origin.x + x1, y: r.origin.y + y0 },
    { x: r.origin.x + x1, y: r.origin.y + y1 },
    { x: r.origin.x + x0, y: r.origin.y + y1 },
  ];

  it('still finds every way when the furniture leaves room', () => {
    // dining table in the south-east quarter, far from all three doors
    const res = checkWalkways(r, [box(3.6, 2.6, 5.2, 3.6)]);
    expect(res.map((x) => x.fits)).toEqual(r.walkways.map((w) => w.width));
    for (const x of res) expect(x.length).toBeLessThan(x.emptyLength * 1.25 + 0.5);
  });

  it('reports a narrowed and a blocked way', () => {
    // a sideboard 80 cm from the west wall leaves only a narrow gap to the bedroom door, a wall of shelves blocks it completely
    const narrow = checkWalkways(r, [box(0.8, 2.6, 3.0, 4.28)]).find((x) => x.to === 'T3' && x.from === 'T2')!;
    expect(narrow.fits).toBeGreaterThan(0);
    expect(narrow.fits).toBeLessThan(0.9);
    const blocked = checkWalkways(r, [box(0, 2.5, 5.88, 2.9)]).find((x) => x.from === 'T2' && x.to === 'T3')!;
    expect(blocked.fits).toBe(0);
    expect(blocked.path).toEqual([]);
  });

  it('keeps clear of the walls by half the width', () => {
    const g = walkGrid(r.polygon);
    const route = walkRoute(g, add(r.origin, { x: 0.6, y: 0.6 }), add(r.origin, { x: 5.2, y: 3.6 }), 0.9)!;
    for (const q of route.path) {
      const toWall = Math.min(...r.walls.map((w) => Math.abs(dot(sub(q, w.a), w.inward))));
      expect(toWall).toBeGreaterThanOrEqual(0.45 - 0.05);
    }
  });
});

function openingCentre(p: Project, d: DerivedPlan, id: string) {
  const o = p.openings.find((x) => x.id === id)!;
  const fp = d.footprints.get(o.wallId)!;
  const r = d.openings.get(o.wallId)!.find((x) => x.opening.id === id)!;
  return add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
}
