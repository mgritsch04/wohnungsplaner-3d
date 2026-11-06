/**
 * What a piece looks at (#436): the gaze target of a sofa, armchair, bed or desk, worked out by
 * the code and not left to Claude. Claude is good with compass directions but bad at turning
 * them into „what is in front of the sofa“; the literature calls it the bed-north hallucination
 * (SpatialText 2026). A sofa that looks at the kitchen run was the most frequent flaw of the
 * Wohnküche (rule C3/W10).
 *
 * The gaze is a beam of ten rays from the front edge of the piece. Each ray ends at the first
 * thing that is worth looking at: a piece of furniture (kitchen run, television, shelf …) or the
 * wall, where the opening (window, door, passage) at that point is named. Low pieces (coffee
 * table, rug, chairs) and small decoration are looked over.
 */
import type { Furniture } from '../../model/schema';
import { dot, sub, type Vec2 } from '../../model/vec';
import { footprint, frontVec } from '../review/geom';
import { roleOf, shapeOf, type Role } from '../../suggest/roomGeometry';
import type { RoomAnalysis, WallInfo } from '../types';

/** A piece as the gaze sees it: plan coordinates (m), front = unit vector the front points to. */
export interface GazePiece {
  id: string;
  /** How the text names it („Sofa 3-Sitzer“, „sofa (Sofa, Leinen)“). */
  ref: string;
  x: number;
  y: number;
  front: Vec2;
  width: number;
  depth: number;
  height: number;
  elevation: number;
  poly: Vec2[];
  role: Role;
  shape: string;
  /** Kitchen module type for kitchen pieces. */
  kitchen?: string;
  parent?: string;
}

/** The pieces that get a gaze line: where one sits, lies or works. */
export const hasGaze = (p: Pick<GazePiece, 'role' | 'shape'>): boolean => p.role === 'sofa' || p.role === 'armchair' || p.role === 'bed' || p.shape === 'desk';

/** A piece of the model (existing furniture) for the gaze. */
export function gazePieceOf(f: Furniture): GazePiece {
  const role = roleOf({ name: f.name, category: f.category, model: f.model, catalogId: f.catalogId, elevation: f.elevation, height: f.height });
  const shape = shapeOf(f);
  return {
    id: f.id,
    ref: f.name.replace(/ \(Platzhalter\)$/, ''),
    x: f.x,
    y: f.y,
    front: frontVec(f.rotation),
    width: f.width,
    depth: f.depth,
    height: f.height,
    elevation: f.elevation,
    poly: footprint({ x: f.x, y: f.y, rotation: f.rotation, width: f.width, depth: f.depth }),
    role,
    shape,
    kitchen: f.kitchen?.type ?? (shape.startsWith('k-') ? shape.slice(2) : undefined),
  };
}

export interface GazeTarget {
  kind: 'window' | 'door' | 'wall' | 'kitchen' | 'tv' | 'piece' | 'art';
  /** Everyday words: „Küchenzeile an W2“, „Fenster F1“, „Wand W3“. */
  text: string;
  /** Distance from the front edge in cm. */
  cm: number;
  /** Rays (of ten) that end here. */
  rays: number;
}

export interface Gaze {
  /** Targets, the one most rays end at first. */
  targets: GazeTarget[];
  /** `„schaut auf: Küchenzeile an W2 (310 cm)“`, without the leading comma. */
  text: string;
}

const RAYS = [-0.45, -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35, 0.45];
/** Looked over: nobody looks at them. */
const SKIP_ROLES = new Set<Role>(['rug', 'curtain', 'mattress', 'box', 'seat', 'coffee-table', 'side-table', 'nightstand', 'floor-lamp', 'table-lamp', 'pendant', 'coat-rack']);

/** Distance along the ray to the first edge of the polygon, or null. */
function rayPoly(o: Vec2, d: Vec2, poly: readonly Vec2[]): number | null {
  let best: number | null = null;
  for (let i = 0; i < poly.length; i++) {
    const t = raySegment(o, d, poly[i], poly[(i + 1) % poly.length]);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Parameter `t` of the ray `o + t·d` where it crosses the segment a–b (t ≥ 0), else null. */
function raySegment(o: Vec2, d: Vec2, a: Vec2, b: Vec2): number | null {
  const s = sub(b, a);
  const den = d.x * s.y - d.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const q = sub(a, o);
  const t = (q.x * s.y - q.y * s.x) / den;
  const u = (q.x * d.y - q.y * d.x) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

const cm = (m: number) => Math.round(m * 100);

/** Wall the back of a piece stands against (within 10 cm). */
function backWallOf(a: RoomAnalysis, p: Pick<GazePiece, 'x' | 'y' | 'depth' | 'front'>): WallInfo | undefined {
  return a.walls.find((w) => {
    const off = dot(sub(p, w.a), w.inward) - p.depth / 2;
    const t = dot(sub(p, w.a), w.dir);
    return Math.abs(off) < 0.1 && dot(p.front, w.inward) > 0.9 && t > -0.05 && t < w.length + 0.05;
  });
}

/** Does this piece count as something one looks at? */
function visible(p: GazePiece, from: GazePiece): boolean {
  if (p.id === from.id || p.parent === from.id || (from.parent && p.parent === from.parent && p.role === from.role)) return false;
  if (p.role === 'tv') return true;
  if (p.role === 'wall-art') return p.shape === 'picture' || p.shape === 'picture-set' || p.shape === 'panel';
  if (p.role === 'mirror') return true;
  if (SKIP_ROLES.has(p.role) || p.shape === 'plant') return false;
  return p.height + p.elevation >= 0.55;
}

function pieceTarget(a: RoomAnalysis, p: GazePiece): Pick<GazeTarget, 'kind' | 'text'> {
  if (p.kitchen) {
    const w = backWallOf(a, p);
    return { kind: 'kitchen', text: `Küchenzeile${w ? ` an ${w.id}` : ''}` };
  }
  if (p.role === 'tv') return { kind: 'tv', text: p.ref };
  if (p.role === 'wall-art') return { kind: 'art', text: p.ref };
  if (p.role === 'mirror') return { kind: 'art', text: p.ref };
  return { kind: 'piece', text: p.ref };
}

/** What lies at point `t` along a wall: the opening there or the bare wall. */
function wallTarget(w: WallInfo, t: number): Pick<GazeTarget, 'kind' | 'text'> {
  const o = w.openings.find((x) => t >= x.t0 - 0.02 && t <= x.t1 + 0.02);
  if (!o) return { kind: 'wall', text: `Wand ${w.id}` };
  if (o.kind === 'window') return { kind: 'window', text: `${(o.sill ?? 1) < 0.05 ? 'Fenstertür' : 'Fenster'} ${o.id}` };
  return { kind: 'door', text: `${o.kind === 'passage' ? 'Durchgang' : 'Tür'} ${o.id}` };
}

/** Everything the beam of `from` meets, nearest first; `others` are the pieces already in the room. */
export function gazeOf(a: RoomAnalysis, from: GazePiece, others: readonly GazePiece[]): Gaze {
  // right-hand direction of the piece: the beam spreads along the front edge
  const right = { x: from.front.y, y: -from.front.x };
  const seen = visibleOthers(others, from);
  const hits = new Map<string, GazeTarget>();
  for (const k of RAYS) {
    const o = {
      x: from.x + from.front.x * (from.depth / 2 + 0.01) + right.x * k * from.width,
      y: from.y + from.front.y * (from.depth / 2 + 0.01) + right.y * k * from.width,
    };
    let best: { t: number; target: Pick<GazeTarget, 'kind' | 'text'> } | null = null;
    for (const w of a.walls) {
      const t = raySegment(o, from.front, w.a, w.b);
      if (t !== null && (!best || t < best.t)) best = { t, target: wallTarget(w, dot(sub({ x: o.x + from.front.x * t, y: o.y + from.front.y * t }, w.a), w.dir)) };
    }
    for (const p of seen) {
      const t = rayPoly(o, from.front, p.poly);
      if (t !== null && (!best || t < best.t)) best = { t, target: pieceTarget(a, p) };
    }
    if (!best) continue;
    const key = `${best.target.kind}|${best.target.text}`;
    const known = hits.get(key);
    if (known) {
      known.rays++;
      known.cm = Math.min(known.cm, cm(best.t + 0.01));
    } else hits.set(key, { ...best.target, cm: cm(best.t + 0.01), rays: 1 });
  }
  // a piece in the beam weighs more than the wall behind it: a sofa in front of a kitchen run looks at the kitchen
  const weight = (t: GazeTarget) => t.rays * (t.kind === 'wall' || t.kind === 'window' || t.kind === 'door' ? 1 : 1.6);
  const targets = [...hits.values()].sort((x, y) => weight(y) - weight(x) || x.cm - y.cm);
  const main = targets[0];
  if (!main) return { targets, text: 'schaut auf: nichts (offen)' };
  const second = targets.find((t, i) => i > 0 && t.rays >= 2 && t.text !== main.text);
  const names = [main, ...(second ? [second] : [])];
  return { targets, text: `schaut auf: ${names.map((t, i) => `${t.text}${i === 0 ? ` (${t.cm} cm)` : ''}`).join(' und ')}` };
}

function visibleOthers(others: readonly GazePiece[], from: GazePiece): GazePiece[] {
  return others.filter((p) => visible(p, from));
}

/** What a piece turns its back to, when the back is not against a wall: „Rücken zu: Küchenzeile an W2 (180 cm)“. */
export function backOf(a: RoomAnalysis, from: GazePiece, others: readonly GazePiece[]): string | null {
  if (backWallOf(a, from)) return null;
  const turned: GazePiece = { ...from, front: { x: -from.front.x, y: -from.front.y } };
  const g = gazeOf(a, turned, others);
  const main = g.targets[0];
  if (!main || main.kind === 'wall' || main.cm > 250) return null;
  return `Rücken zu: ${main.text} (${main.cm} cm)`;
}
