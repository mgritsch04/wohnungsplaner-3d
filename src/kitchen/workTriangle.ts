/**
 * Kitchen work triangle (#82)
 * ---------------------------
 * Sink, cooking place and fridge form the classic work triangle. Each side is
 * measured from front-edge centre to front-edge centre (the spot where one stands),
 * in the plan (2D).
 *
 * Roles are taken from the kitchen module type of the catalog items
 * (`kitchen.type`): 'sink' (Spülenschrank), 'cooktop' (Kochfeld) – or 'oven'
 * (Backofen-Umbau) when a room has no cooktop –, and 'fridge' (Kühlschrank).
 * Items are assigned to the room their centre lies in. With several candidates
 * per role, the combination with the shortest total is evaluated.
 *
 * Rule of thumb (a guideline, not a standard; adjustable in the project settings):
 * every side 1.2–2.7 m, total 4–8 m.
 */
import type { DerivedPlan } from '../model/derived';
import type { Furniture, Project } from '../model/schema';
import { add, dist, pointInPolygon, rotate, type Vec2 } from '../model/vec';

/** Always in metres with two decimals, e.g. „0,80 m“ (consistent within one message). */
export const formatM = (m: number) => `${m.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;

export type TriangleRole = 'sink' | 'cooktop' | 'fridge';

export interface TriangleLimits {
  sideMin: number;
  sideMax: number;
  sumMin: number;
  sumMax: number;
}

export const DEFAULT_TRIANGLE_LIMITS: TriangleLimits = { sideMin: 1.2, sideMax: 2.7, sumMin: 4, sumMax: 8 };

export const ROLE_LABEL: Record<TriangleRole, string> = { sink: 'Spüle', cooktop: 'Herd', fridge: 'Kühlschrank' };

export interface TriangleCorner {
  role: TriangleRole;
  id: string;
  /** Front-edge centre in plan metres. */
  point: Vec2;
}

export interface TriangleSide {
  from: TriangleRole;
  to: TriangleRole;
  length: number;
  status: 'ok' | 'short' | 'long';
}

export interface KitchenTriangleResult {
  roomId: string;
  roomName: string;
  /** Present when sink, cooking place and fridge were all found. */
  corners?: Record<TriangleRole, TriangleCorner>;
  sides?: TriangleSide[];
  sum?: number;
  sumStatus?: 'ok' | 'short' | 'long';
  ok: boolean;
  /** Clear German messages for the panel (missing items or values out of range). */
  messages: string[];
}

/** Front-edge centre: the procedural front of furniture is local +y. */
export function frontCenter(f: Pick<Furniture, 'x' | 'y' | 'depth' | 'rotation'>): Vec2 {
  return add({ x: f.x, y: f.y }, rotate({ x: 0, y: f.depth / 2 }, f.rotation));
}

function roleOf(f: Furniture): TriangleRole | 'oven' | null {
  switch (f.kitchen?.type) {
    case 'sink':
      return 'sink';
    case 'cooktop':
      return 'cooktop';
    case 'oven':
      return 'oven';
    case 'fridge':
      return 'fridge';
    default:
      return null;
  }
}

const SIDES: [TriangleRole, TriangleRole][] = [
  ['sink', 'cooktop'],
  ['cooktop', 'fridge'],
  ['fridge', 'sink'],
];

const rate = (v: number, min: number, max: number): 'ok' | 'short' | 'long' => (Math.round(v * 1000) < Math.round(min * 1000) ? 'short' : Math.round(v * 1000) > Math.round(max * 1000) ? 'long' : 'ok');

/** One result per room that contains at least one sink, cooking place or fridge. */
export function kitchenWorkTriangles(project: Project, derived: DerivedPlan, limits: TriangleLimits = DEFAULT_TRIANGLE_LIMITS): KitchenTriangleResult[] {
  const out: KitchenTriangleResult[] = [];
  for (const room of project.rooms) {
    const g = derived.rooms.get(room.id);
    if (!g) continue;
    const byRole: Record<TriangleRole | 'oven', Furniture[]> = { sink: [], cooktop: [], oven: [], fridge: [] };
    for (const f of project.furniture) {
      const r = roleOf(f);
      if (r && pointInPolygon({ x: f.x, y: f.y }, g.interior)) byRole[r].push(f);
    }
    const cooking = byRole.cooktop.length ? byRole.cooktop : byRole.oven;
    if (!byRole.sink.length && !cooking.length && !byRole.fridge.length) continue; // room without kitchen
    const res: KitchenTriangleResult = { roomId: room.id, roomName: room.name, ok: false, messages: [] };
    const missing = [!byRole.sink.length && 'Spüle', !cooking.length && 'Herd/Kochfeld', !byRole.fridge.length && 'Kühlschrank'].filter(Boolean);
    if (missing.length) {
      res.messages.push(`Arbeitsdreieck nicht prüfbar: ${missing.join(', ')} fehlt im Raum „${room.name}“.`);
      out.push(res);
      continue;
    }
    // shortest combination when a role has several candidates
    let best: { c: Record<TriangleRole, TriangleCorner>; sum: number } | null = null;
    for (const s of byRole.sink)
      for (const k of cooking)
        for (const fr of byRole.fridge) {
          const c = {
            sink: { role: 'sink' as const, id: s.id, point: frontCenter(s) },
            cooktop: { role: 'cooktop' as const, id: k.id, point: frontCenter(k) },
            fridge: { role: 'fridge' as const, id: fr.id, point: frontCenter(fr) },
          };
          const sum = SIDES.reduce((acc, [a, b]) => acc + dist(c[a].point, c[b].point), 0);
          if (!best || sum < best.sum) best = { c, sum };
        }
    const { c, sum } = best!;
    res.corners = c;
    res.sides = SIDES.map(([a, b]) => {
      const length = dist(c[a].point, c[b].point);
      return { from: a, to: b, length, status: rate(length, limits.sideMin, limits.sideMax) };
    });
    res.sum = sum;
    res.sumStatus = rate(sum, limits.sumMin, limits.sumMax);
    for (const s of res.sides) {
      if (s.status === 'short') res.messages.push(`${ROLE_LABEL[s.from]} – ${ROLE_LABEL[s.to]}: ${formatM(s.length)} ist kürzer als ${formatM(limits.sideMin)}.`);
      if (s.status === 'long') res.messages.push(`${ROLE_LABEL[s.from]} – ${ROLE_LABEL[s.to]}: ${formatM(s.length)} ist länger als ${formatM(limits.sideMax)}.`);
    }
    if (res.sumStatus === 'short') res.messages.push(`Summe ${formatM(sum)} ist kürzer als ${formatM(limits.sumMin)}.`);
    if (res.sumStatus === 'long') res.messages.push(`Summe ${formatM(sum)} ist länger als ${formatM(limits.sumMax)} – lange Wege.`);
    res.ok = res.sides.every((s) => s.status === 'ok') && res.sumStatus === 'ok';
    out.push(res);
  }
  return out;
}
