import { derivePlan } from '../model/derived';
import { FIXTURE_ELEVATION, snapFixtureToWall } from '../model/fixtures';
import { newId } from '../model/ids';
import type { Fixture, Project } from '../model/schema';
import { add, cross, dist, normalize, perp, pointInPolygon, scale, sub, type Vec2 } from '../model/vec';

/**
 * „Steckdosen raten“ (#374): a rule-of-thumb proposal for where sockets will be, derived from
 * the walls and openings of each room. Never part of an import; the user triggers it and every
 * socket carries the note „geraten“. Sockets stand on wall faces only, keep a clearance to
 * openings and corners and are at most ~3.5 m apart along a wall.
 *
 * Exterior walls (nothing behind them) are used only when a room has no socket on an interior
 * wall at all, and then with a single socket.
 */
export const GUESS_NOTE = 'geraten – Lage bitte prüfen';

const END_CLEARANCE = 0.4;
const OPENING_CLEARANCE = 0.3;
const MIN_FREE = 0.8;
const MIN_FREE_EXTERIOR = 1.5;
const MAX_SPACING = 3.5;
/** An existing socket this close to a proposal makes the proposal needless. */
const KNOWN_REACH = 1.5;

type Interval = [number, number];

function freeIntervals(length: number, blocked: Interval[]): Interval[] {
  let free: Interval[] = [[END_CLEARANCE, length - END_CLEARANCE]];
  for (const [b0, b1] of blocked) {
    free = free.flatMap(([f0, f1]) => {
      const lo = b0 - OPENING_CLEARANCE;
      const hi = b1 + OPENING_CLEARANCE;
      if (hi <= f0 || lo >= f1) return [[f0, f1] as Interval];
      return [[f0, Math.min(f1, lo)] as Interval, [Math.max(f0, hi), f1] as Interval].filter(([x, y]) => y > x);
    });
  }
  return free;
}

export function guessSockets(p: Project): Fixture[] {
  const plan = derivePlan(p);
  const nodes = new Map(p.nodes.map((n) => [n.id, n]));
  const interiors = [...plan.rooms.values()].map((g) => g.interior);
  const known = p.fixtures.filter((f) => f.kind === 'socket');
  const result: Fixture[] = [];
  const base = { kind: 'socket' as const, count: 1, width: undefined, height: undefined };

  const tooClose = (pt: Vec2) => [...known, ...result].some((f) => dist(f, pt) < KNOWN_REACH);

  for (const room of p.rooms) {
    const geo = plan.rooms.get(room.id);
    if (!geo || !geo.closed) continue;
    const interior: { fixture: Fixture }[] = [];
    const exterior: { fixture: Fixture; free: number }[] = [];
    room.nodeIds.forEach((id, i) => {
      const a = nodes.get(id);
      const b = nodes.get(room.nodeIds[(i + 1) % room.nodeIds.length]);
      if (!a || !b) return;
      const wall = p.walls.find((w) => (w.a === id && w.b === room.nodeIds[(i + 1) % room.nodeIds.length]) || (w.b === id && w.a === room.nodeIds[(i + 1) % room.nodeIds.length]));
      if (!wall) return;
      const wa = nodes.get(wall.a)!;
      const wb = nodes.get(wall.b)!;
      const length = dist(wa, wb);
      const dir = normalize(sub(wb, wa));
      const mid = add(wa, scale(dir, length / 2));
      let n = perp(dir);
      if (cross(dir, sub(geo.centroid, wa)) < 0) n = scale(n, -1);
      const behind = add(mid, scale(n, -(wall.thickness / 2 + 0.4)));
      const isExterior = !interiors.some((poly) => pointInPolygon(behind, poly));
      const blocked: Interval[] = (plan.openings.get(wall.id) ?? []).map((r) => [r.s0, r.s1]);
      for (const [f0, f1] of freeIntervals(length, blocked)) {
        const span = f1 - f0;
        if (span < (isExterior ? MIN_FREE_EXTERIOR : MIN_FREE)) continue;
        const count = isExterior ? 1 : Math.max(1, Math.ceil(span / MAX_SPACING));
        for (let k = 0; k < count; k++) {
          const s = f0 + ((k + 0.5) * span) / count;
          const onLine = add(wa, scale(dir, s));
          const snap = snapFixtureToWall(p, { ...base, kind: 'socket' }, add(onLine, scale(n, 0.3)));
          if (!snap) continue;
          const fixture: Fixture = { id: newId('fix'), kind: 'socket', x: snap.x, y: snap.y, rotation: snap.rotation, elevation: FIXTURE_ELEVATION.socket, count: 1, note: GUESS_NOTE };
          if (isExterior) exterior.push({ fixture, free: span });
          else interior.push({ fixture });
        }
      }
    });
    const accepted = interior.filter((c) => !tooClose(c.fixture));
    result.push(...accepted.map((c) => c.fixture));
    const hasInterior = accepted.length > 0 || known.some((f) => pointInPolygon(f, geo.interior) || interiorTouch(f, geo.interior));
    if (!hasInterior && exterior.length) {
      const best = exterior.sort((x, y) => y.free - x.free).find((c) => !tooClose(c.fixture));
      if (best) result.push(best.fixture);
    }
  }
  return result;
}

/** A fixture sits on the wall face, i.e. just outside the clear interior outline. */
function interiorTouch(f: Vec2, poly: Vec2[]): boolean {
  return poly.some((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const l = dist(a, b) || 1;
    const t = Math.max(0, Math.min(1, ((f.x - a.x) * (b.x - a.x) + (f.y - a.y) * (b.y - a.y)) / (l * l)));
    return dist(f, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }) < 0.1;
  });
}
