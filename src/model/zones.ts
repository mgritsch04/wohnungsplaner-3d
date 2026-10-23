import type { DerivedPlan } from './derived';
import type { PlanZone, Project } from './schema';
import { boundsOf, closestPointOnSegment, cross, dist, pointInPolygon, polygonArea, polygonCentroid, sub, type Vec2 } from './vec';

/**
 * Marked areas with a purpose (#416): the user draws a zone in the 2D plan and writes what it is
 * for („Arbeitsecke“, „Essbereich“, „frei lassen“). Claude gets the zones as a binding brief and
 * assigns furniture to them; the placement (src/suggest/furnishing.ts) puts a zone's furniture
 * only inside it and keeps everything else out.
 */

/** Quick picks in the little text box that opens after drawing. */
export const ZONE_PRESETS = ['Arbeitsecke', 'Essbereich', 'Leseplatz', 'Sitzecke', 'Schlafbereich', 'Spielecke', 'Küchenzeile', 'Stauraum', 'frei lassen'];

export const ZONE_COLORS = ['#0d9488', '#7c3aed', '#ea580c', '#2563eb', '#db2777', '#65a30d', '#ca8a04', '#0891b2'];

export const zoneColor = (index: number) => ZONE_COLORS[((index % ZONE_COLORS.length) + ZONE_COLORS.length) % ZONE_COLORS.length];

/** Smallest side of a drawn rectangle (m); a smaller drag counts as a click. */
export const MIN_ZONE_SIZE = 0.3;

/** A zone meant to stay empty („frei lassen“, „Platz für die Yogamatte“ …): no furniture goes in. */
export const isKeepFree = (purpose: string) => /\b(frei|leer)\b|frei\s*lassen|nichts\s+(hin|rein)|keine\s+möbel/i.test(purpose);

/** Labels in list order: Z1, Z2 … (also the keys Claude refers to). */
export function zoneLabels(zones: PlanZone[]): Map<string, string> {
  return new Map(zones.map((z, i) => [z.id, `Z${i + 1}`]));
}

export function rectPoints(a: Vec2, b: Vec2): Vec2[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export const zoneArea = (z: Pick<PlanZone, 'points'>) => polygonArea(z.points);
export const zoneCenter = (z: Pick<PlanZone, 'points'>) => polygonCentroid(z.points);

/** Room the zone belongs to: the smallest room containing its centre (null = outside every room). */
export function zoneRoomId(project: Pick<Project, 'rooms'>, derived: DerivedPlan, z: Pick<PlanZone, 'points'>): string | null {
  const c = zoneCenter(z);
  const hits = project.rooms
    .map((r) => ({ r, g: derived.rooms.get(r.id) }))
    .filter((h) => h.g && pointInPolygon(c, h.g.interior))
    .sort((a, b) => a.g!.area - b.g!.area);
  return hits[0]?.r.id ?? null;
}

export function zonesInRoom(project: Pick<Project, 'rooms' | 'zones'>, derived: DerivedPlan, roomId: string): PlanZone[] {
  return project.zones.filter((z) => zoneRoomId(project, derived, z) === roomId);
}

/** The zone whose area contains `p` (the last drawn wins, it lies on top). */
export function zoneAt(zones: PlanZone[], p: Vec2): PlanZone | null {
  for (let i = zones.length - 1; i >= 0; i--) if (pointInPolygon(p, zones[i].points)) return zones[i];
  return null;
}

function properCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Inside `poly` and not on its outline. */
const strictlyInside = (p: Vec2, poly: Vec2[]) => pointInPolygon(p, poly) && poly.every((a, i) => closestPointOnSegment(p, a, poly[(i + 1) % poly.length]).distance > 1e-6);

/** Whether two polygons (also non-convex) share area; touching edges do not count. */
export function polygonsOverlap(a: Vec2[], b: Vec2[]): boolean {
  const probes = (poly: Vec2[]) => [...poly, polygonCentroid(poly), ...poly.map((p, i) => ({ x: (p.x + poly[(i + 1) % poly.length].x) / 2, y: (p.y + poly[(i + 1) % poly.length].y) / 2 }))];
  if (probes(a).some((p) => strictlyInside(p, b)) || probes(b).some((p) => strictlyInside(p, a))) return true;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) if (properCross(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  return false;
}

/** Whether polygon `inner` lies completely inside `outer`. */
export const polygonInside = (inner: Vec2[], outer: Vec2[]) => inner.every((p) => pointInPolygon(p, outer)) && !inner.some((p, i) => outer.some((q, j) => properCross(p, inner[(i + 1) % inner.length], q, outer[(j + 1) % outer.length])));

const m = (v: number) => v.toFixed(1).replace('.', ',');

/**
 * Where the zone lies in its room, in words Claude can plan with (#416): size, share of the
 * room, position in the plan, which walls it touches and whether a window or door is there.
 */
export function describeZone(derived: DerivedPlan, z: PlanZone, roomId: string | null): string {
  const zb = boundsOf(z.points)!;
  const area = zoneArea(z);
  const parts = [`${m(zb.maxX - zb.minX)} × ${m(zb.maxY - zb.minY)} m (${m(area)} m²)`];
  const g = roomId ? derived.rooms.get(roomId) : undefined;
  if (!g) return [...parts, 'außerhalb der Räume'].join(', ');
  const rb = boundsOf(g.interior)!;
  parts.push(`ca. ${Math.round((area / Math.max(g.area, 0.01)) * 100)} % des Raums`);
  parts.push(`im Raum von ${m(zb.minX - rb.minX)} bis ${m(zb.maxX - rb.minX)} m nach rechts und ${m(zb.minY - rb.minY)} bis ${m(zb.maxY - rb.minY)} m nach unten (gemessen von der linken oberen Raumecke im Plan, Raum ${m(rb.maxX - rb.minX)} × ${m(rb.maxY - rb.minY)} m)`);
  // walls the zone touches: sample its outline, a wall counts when enough of the outline runs along it
  const samples: Vec2[] = [];
  z.points.forEach((p, i) => {
    const q = z.points[(i + 1) % z.points.length];
    const n = Math.max(1, Math.ceil(dist(p, q) / 0.1));
    for (let k = 0; k < n; k++) samples.push({ x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n });
  });
  const walls = g.interior.map((a, i) => ({ a, b: g.interior[(i + 1) % g.interior.length] })).filter((e) => samples.filter((s) => closestPointOnSegment(s, e.a, e.b).distance < 0.25).length >= 3);
  const near = (p: Vec2, reach: number) => pointInPolygon(p, z.points) || z.points.some((a, i) => closestPointOnSegment(p, a, z.points[(i + 1) % z.points.length]).distance < reach);
  const openings = { window: 0, door: 0 };
  for (const [wallId, list] of derived.openings) {
    const fp = derived.footprints.get(wallId);
    if (!fp) continue;
    for (const r of list) {
      const s = (r.s0 + r.s1) / 2;
      const c = { x: fp.a.x + fp.dir.x * s, y: fp.a.y + fp.dir.y * s };
      if (!near(c, fp.thickness / 2 + 0.3)) continue;
      if (r.opening.kind === 'window') openings.window++;
      else openings.door++;
    }
  }
  parts.push(walls.length >= 2 ? `liegt in einer Ecke (an ${walls.length} Wänden)` : walls.length === 1 ? 'liegt an einer Wand' : 'liegt frei im Raum, an keiner Wand');
  if (openings.window) parts.push(openings.window > 1 ? `${openings.window} Fenster grenzen an` : 'ein Fenster grenzt an');
  if (openings.door) parts.push(openings.door > 1 ? `${openings.door} Türen/Durchgänge grenzen an` : 'eine Tür bzw. ein Durchgang grenzt an');
  return parts.join(', ');
}
