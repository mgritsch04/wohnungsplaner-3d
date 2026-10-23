import { describe, expect, it } from 'vitest';
import { derivePlan, type DerivedPlan } from '../../model/derived';
import { ProjectSchema, type Project } from '../../model/schema';
import { add, cross, dot, normalize, pointInPolygon, scale, signedArea, sub, type Vec2 } from '../../model/vec';
import { polygonsOverlap, zoneRoomId } from '../../model/zones';
import { FLAT_KEYS, TEST_FLATS } from './flats';

/** Room on each side of an opening; null = outside the flat. */
function openingSides(p: Project, d: DerivedPlan, openingId: string): (string | null)[] {
  const o = p.openings.find((x) => x.id === openingId)!;
  const fp = d.footprints.get(o.wallId)!;
  const r = d.openings.get(o.wallId)!.find((x) => x.opening.id === openingId)!;
  const c = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
  return [1, -1].map((s) => {
    const probe = add(c, scale(fp.normal, s * (fp.thickness / 2 + 0.2)));
    return p.rooms.find((room) => pointInPolygon(probe, d.rooms.get(room.id)!.interior))?.name ?? null;
  });
}

/** Corners of an outline without the straight-through points a T-junction adds, and how many point into the room. */
function corners(poly: Vec2[]): { corners: number; reflex: number } {
  const orient = Math.sign(signedArea(poly));
  let n = 0;
  let reflex = 0;
  poly.forEach((p, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const turn = cross(normalize(sub(p, prev)), normalize(sub(next, p)));
    if (Math.abs(turn) < Math.sin((1 * Math.PI) / 180) && dot(sub(p, prev), sub(next, p)) > 0) return;
    n++;
    if (Math.sign(turn) !== orient) reflex++;
  });
  return { corners: n, reflex };
}

/** Footprint corners of a piece, pulled in by 1 cm. */
function footprint(f: Project['furniture'][number]): Vec2[] {
  const ax = { x: Math.cos(f.rotation), y: Math.sin(f.rotation) };
  const ay = { x: -Math.sin(f.rotation), y: Math.cos(f.rotation) };
  const hw = f.width / 2 - 0.01;
  const hd = f.depth / 2 - 0.01;
  return [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ].map(([u, w]) => add({ x: f.x, y: f.y }, add(scale(ax, u), scale(ay, w))));
}

describe.each(FLAT_KEYS)('Testwohnung %s', (key) => {
  const flat = TEST_FLATS[key];
  const p = flat.build();
  const d = derivePlan(p);
  const nameOf = (id: string) => p.rooms.find((r) => r.id === id)!.name;
  const sides = new Map(p.openings.map((o) => [o.id, openingSides(p, d, o.id)]));

  it('is a valid project and always the same', () => {
    expect(ProjectSchema.safeParse(p).success).toBe(true);
    expect(JSON.stringify(flat.build())).toBe(JSON.stringify(p));
  });

  it('has the rooms of the description, closed and without overlaps', () => {
    expect(p.rooms.map((r) => r.name).sort()).toEqual(Object.keys(flat.rooms).sort());
    const geo = p.rooms.map((r) => d.rooms.get(r.id)!);
    for (const g of geo) {
      expect(g.closed, nameOf(g.roomId)).toBe(true);
      expect(g.area, nameOf(g.roomId)).toBeGreaterThan(1.5);
    }
    for (let i = 0; i < geo.length; i++) for (let k = i + 1; k < geo.length; k++) expect(polygonsOverlap(geo[i].interior, geo[k].interior), `${nameOf(geo[i].roomId)} / ${nameOf(geo[k].roomId)}`).toBe(false);
  });

  it('every opening sits in a wall between a room and a room or the outside', () => {
    for (const o of p.openings) {
      const [a, b] = sides.get(o.id)!;
      expect(a !== null || b !== null, o.id).toBe(true);
      expect(a, o.id).not.toBe(b);
      // windows lead outside or onto the balcony, never into another room
      if (o.kind === 'window') expect([a, b].some((s) => s === null || flat.rooms[s].types.includes('balcony')), o.id).toBe(true);
    }
  });

  it('has one entrance door, and every room is reachable from it', () => {
    const outside = p.openings.filter((o) => o.kind !== 'window' && sides.get(o.id)!.includes(null));
    expect(outside).toHaveLength(1);
    expect(sides.get(outside[0].id)!.find((s) => s !== null)).toBe(flat.entrance);
    const links = p.openings.filter((o) => o.kind !== 'window' && !sides.get(o.id)!.includes(null)).map((o) => sides.get(o.id) as string[]);
    const parent = new Map<string, string | null>([[flat.entrance, null]]);
    const queue = [flat.entrance];
    while (queue.length) {
      const r = queue.shift()!;
      for (const [a, b] of links) {
        const next = a === r ? b : b === r ? a : null;
        if (next && !parent.has(next)) {
          parent.set(next, r);
          queue.push(next);
        }
      }
    }
    expect([...parent.keys()].sort()).toEqual(Object.keys(flat.rooms).sort());
    // rooms on a shortest route from the entrance to another room
    const through = new Set<string>();
    for (const r of parent.keys()) for (let up = parent.get(r); up; up = parent.get(up)) through.add(up);
    const expected = Object.entries(flat.rooms).filter(([, t]) => t.passThrough).map(([n]) => n);
    expect([...through].sort()).toEqual(expected.sort());
  });

  it.each(Object.keys(flat.rooms))('%s: doors, windows and corners as described', (name) => {
    const truth = flat.rooms[name];
    const room = p.rooms.find((r) => r.name === name)!;
    const count = (window: boolean) => p.openings.filter((o) => (o.kind === 'window') === window && sides.get(o.id)!.includes(name)).length;
    expect({ doors: count(false), windows: count(true), ...corners(d.rooms.get(room.id)!.interior) }).toEqual({
      doors: truth.doors,
      windows: truth.windows,
      corners: truth.corners,
      reflex: truth.reflex ?? 0,
    });
  });

  it('existing pieces stand inside a room', () => {
    for (const f of p.furniture.filter((x) => x.existing)) {
      const pts = footprint(f);
      const inside = p.rooms.some((r) => pts.every((q) => pointInPolygon(q, d.rooms.get(r.id)!.interior)));
      expect(inside, `${f.name} bei ${f.x.toFixed(2)}/${f.y.toFixed(2)}`).toBe(true);
    }
  });

  it('marked zones lie in a room, and the residents have wishes', () => {
    for (const z of p.zones) expect(zoneRoomId(p, d, z), z.purpose).not.toBeNull();
    expect(flat.wishes.interests.trim()).not.toBe('');
    expect(flat.wishes.needs.trim()).not.toBe('');
    expect(flat.wishes.searchReal).toBe(false);
  });
});

describe('Testwohnung F', () => {
  const p = TEST_FLATS.F.build();
  const d = derivePlan(p);
  const roomName = (pt: Vec2) => p.rooms.find((r) => pointInPolygon(pt, d.rooms.get(r.id)!.interior))?.name;

  it('has a fitted kitchen in the Wohnküche, marked as existing', () => {
    const kitchen = p.furniture.filter((f) => f.kitchen);
    expect(kitchen.length).toBeGreaterThanOrEqual(8);
    expect(kitchen.every((f) => f.existing && roomName(f) === 'Wohnküche')).toBe(true);
    expect(kitchen.some((f) => f.kitchen!.type === 'sink')).toBe(true);
    expect(kitchen.some((f) => f.kitchen!.type === 'countertop')).toBe(true);
  });

  it('keeps the yoga area free and the reading place in the bedroom', () => {
    const where = p.zones.map((z) => ({ purpose: z.purpose, room: nameOf(zoneRoomId(p, d, z)) }));
    expect(where).toEqual([
      { purpose: 'frei lassen (Yogamatte)', room: 'Wohnküche' },
      { purpose: 'Leseplatz', room: 'Schlafzimmer' },
    ]);
    function nameOf(id: string | null) {
      return p.rooms.find((r) => r.id === id)?.name;
    }
  });
});
