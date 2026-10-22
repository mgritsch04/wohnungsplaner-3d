import type { FixtureKind } from '../../model/schema';
import type { Vec2 } from '../../model/vec';
import { closestPointOnSegment, pointInPolygon } from '../../model/vec';
import { components, orientedBox, type FixtureSegment } from './fixtures';

/**
 * Installation symbols of an electrical / sanitary plan (#222): socket, switch, LAN / data
 * outlet, water and waste-water connection, radiator. Symbols are small closed shapes drawn at
 * a wall; the shapes below are the usual ones (circle = round box):
 *   socket   circle with a bar through its centre
 *   switch   circle with a short stem leaving its edge
 *   water    circle crossed by two lines (X)
 *   LAN      small triangle (becomes a socket marked "LAN / Daten")
 *   drain    small square with both diagonals
 *   radiator thin long rectangle along a wall
 * Anything else (plain circles, lamps, furniture outlines) is ignored – nothing is invented.
 * Every hit is a proposal: weak ones are returned as `uncertain` and are not taken over unless
 * the user selects them in the review. Mounting heights are not read from the plan.
 */

export interface InstallationCandidate {
  kind: FixtureKind;
  center: Vec2;
  /** Radiator length along the wall (m). */
  width?: number;
  /** What the symbol was read as, for the review. */
  symbol: 'socket' | 'switch' | 'lan' | 'water' | 'drain' | 'radiator';
  confidence: number;
  note: string;
}

interface Wall {
  a: Vec2;
  b: Vec2;
  thickness: number;
}

/** Symbols at or above this confidence are taken over by default. */
export const INSTALLATION_ACCEPT_AT = 0.6;

const BASE: Record<InstallationCandidate['symbol'], number> = { socket: 0.7, switch: 0.7, water: 0.7, drain: 0.7, lan: 0.65, radiator: 0.6 };
const WET_ROOM = /bad|wc|toilet|dusch|wasch|küche|kueche|hwr|hauswirtschaft|technik|keller/i;
/** A symbol further than this from the wall face is not an installation point. */
const WALL_REACH = 0.45;
/** Radiator long side may stand at most this far from the wall face. */
const RADIATOR_GAP = 0.25;
const MAX_PIECE = 2.4;
const CLOSE = 0.03;

const len = (s: FixtureSegment) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
const mid = (s: FixtureSegment): Vec2 => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
const A = (s: FixtureSegment): Vec2 => ({ x: s.x1, y: s.y1 });
const B = (s: FixtureSegment): Vec2 => ({ x: s.x2, y: s.y2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Wall face lines are long and run along a wall; symbol bars/stems are short. */
function isWallFace(s: FixtureSegment, walls: Wall[]): boolean {
  if (len(s) <= 0.3) return false;
  return walls.some((w) => {
    const m = closestPointOnSegment(mid(s), w.a, w.b);
    if (m.distance > w.thickness / 2 + CLOSE) return false;
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const wl = Math.hypot(dx, dy) || 1;
    return Math.abs((dx * (s.y2 - s.y1) - dy * (s.x2 - s.x1)) / (wl * len(s))) < 0.05;
  });
}

function wallFaceDistance(p: Vec2, walls: Wall[]): number {
  return Math.min(...walls.map((w) => Math.max(0, closestPointOnSegment(p, w.a, w.b).distance - w.thickness / 2)), Infinity);
}

/** Distance of the infinite line through the segment from `p`. */
function lineDist(p: Vec2, s: FixtureSegment): number {
  const l = len(s) || 1;
  return Math.abs(((s.x2 - s.x1) * (s.y1 - p.y) - (s.x1 - p.x) * (s.y2 - s.y1)) / l);
}

function ringOf(curve: FixtureSegment[]): { c: Vec2; r: number } | null {
  if (curve.length < 8) return null;
  const pts = curve.flatMap((s) => [A(s), B(s)]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const d = (w + h) / 2;
  if (d < 0.05 || d > 0.4 || Math.max(w, h) / Math.min(w, h) > 1.25) return null;
  const c = { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 };
  const r = d / 2;
  if (pts.some((p) => Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r) > 0.25 * r)) return null;
  return { c, r };
}

type Sym = Pick<InstallationCandidate, 'kind' | 'symbol' | 'center' | 'width'> & { label: string };

function classifyRing(ring: { c: Vec2; r: number }, extras: FixtureSegment[]): Sym | null {
  const { c, r } = ring;
  const at = (symbol: Sym['symbol'], kind: FixtureKind, label: string): Sym => ({ symbol, kind, label, center: c });
  if (extras.length === 1) {
    const s = extras[0];
    const da = Math.hypot(s.x1 - c.x, s.y1 - c.y);
    const db = Math.hypot(s.x2 - c.x, s.y2 - c.y);
    const [near, far] = da <= db ? [da, db] : [db, da];
    // bar through the centre: both ends on the ring
    if (lineDist(c, s) <= 0.25 * r && near >= 0.7 * r && far <= 1.3 * r) return at('socket', 'socket', 'Steckdose');
    // stem: one end on the ring, the other clearly outside
    if (near >= 0.7 * r && near <= 1.3 * r && far >= 1.6 * r && far <= 4.5 * r) return at('switch', 'switch', 'Schalter');
  }
  if (extras.length === 2) {
    const [s, t] = extras;
    const through = (u: FixtureSegment) => lineDist(c, u) <= 0.25 * r && len(u) >= 1.4 * r && len(u) <= 3.2 * r;
    const ang = (((Math.atan2(s.y2 - s.y1, s.x2 - s.x1) - Math.atan2(t.y2 - t.y1, t.x2 - t.x1)) % Math.PI) + Math.PI) % Math.PI;
    if (through(s) && through(t) && ang > Math.PI / 3 && ang < (2 * Math.PI) / 3) return at('water', 'water', 'Wasseranschluss');
  }
  return null;
}

function classifyStraight(segs: FixtureSegment[]): Sym | null {
  const pts = segs.flatMap((s) => [A(s), B(s)]);
  const box = orientedBox(pts);
  const label = (symbol: Sym['symbol'], kind: FixtureKind, text: string, width?: number): Sym => ({ symbol, kind, label: text, center: box.center, width });
  const lens = segs.map(len);
  if (segs.length === 3 && box.l >= 0.08 && box.l <= 0.4 && box.w >= 0.06 && Math.max(...lens) <= 0.45) return label('lan', 'socket', 'LAN-/Datendose');
  if (segs.length === 6 && box.l >= 0.06 && box.l <= 0.4 && box.l / box.w <= 1.3) {
    const sorted = [...lens].sort((a, b) => a - b);
    const side = sorted.slice(0, 4).reduce((n, v) => n + v, 0) / 4;
    const diag = sorted.slice(4);
    if (sorted[3] <= 1.3 * sorted[0] && diag.every((v) => Math.abs(v - side * Math.SQRT2) <= 0.2 * side * Math.SQRT2)) return label('drain', 'drain', 'Abwasseranschluss');
  }
  if (segs.length >= 4 && box.l >= 0.35 && box.l <= MAX_PIECE && box.w >= 0.04 && box.w <= 0.25 && box.l / box.w >= 3.5) return label('radiator', 'radiator', 'Heizkörper', box.l);
  return null;
}

/**
 * Installation symbols in the vector segments of a plan (metres). `walls` are the proposed wall
 * centre lines; a symbol must stand at one. `rooms` (interiors with names) only raise or lower
 * the confidence of water connections.
 */
export function detectInstallations(segments: FixtureSegment[], walls: Wall[], rooms: { polygon: Vec2[]; name: string }[]): InstallationCandidate[] {
  if (!walls.length) return [];
  const pieces = segments.filter((s) => !s.areaFill && !s.faint && len(s) > 1e-4 && len(s) <= MAX_PIECE && !isWallFace(s, walls));
  const out: InstallationCandidate[] = [];
  for (const { segs } of components(pieces)) {
    const curve = segs.filter((s) => s.curve);
    const ring = ringOf(curve);
    const sym = ring ? classifyRing(ring, segs.filter((s) => !s.curve)) : curve.length === 0 ? classifyStraight(segs) : null;
    if (!sym) continue;
    const gap = wallFaceDistance(sym.center, walls);
    if (sym.symbol === 'radiator') {
      // the long side runs along a wall at a small gap
      const w = walls.map((wl) => ({ wl, d: closestPointOnSegment(sym.center, wl.a, wl.b).distance - wl.thickness / 2 })).sort((p, q) => p.d - q.d)[0];
      const dir = { x: w.wl.b.x - w.wl.a.x, y: w.wl.b.y - w.wl.a.y };
      const longest = segs.reduce((m, s) => (len(s) > len(m) ? s : m));
      const par = Math.abs(dir.x * (longest.y2 - longest.y1) - dir.y * (longest.x2 - longest.x1)) / (Math.hypot(dir.x, dir.y) * len(longest));
      if (par > 0.1 || w.d - 0.1 > RADIATOR_GAP) continue;
    } else if (gap > WALL_REACH) continue;
    let confidence = BASE[sym.symbol] - (gap > 0.25 && sym.symbol !== 'radiator' ? 0.2 : 0);
    const room = rooms.find((r) => pointInPolygon(sym.center, r.polygon));
    const water = sym.kind === 'water' || sym.kind === 'drain';
    if (water && room?.name) confidence += WET_ROOM.test(room.name) ? 0.1 : -0.2;
    confidence = round2(confidence);
    out.push({
      kind: sym.kind,
      center: sym.center,
      width: sym.width ? round2(sym.width) : undefined,
      symbol: sym.symbol,
      confidence,
      note: `${sym.label} aus dem Symbol im Plan${room?.name ? ` in „${room.name}“` : ''}${confidence < INSTALLATION_ACCEPT_AT ? ' – unsicher, nur nach Prüfung übernehmen' : ''} · Höhe nicht im Plan, Richtwert gesetzt`,
    });
  }
  return out;
}
