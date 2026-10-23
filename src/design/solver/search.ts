/**
 * Search state and moves: start from Claude's places (snapped to walls and the 90° grid) or
 * from „anchors first“ over wall slots, repair hard violations with local moves, then simulated
 * annealing with discrete and continuous moves. Costs are kept per unit and per pair of units,
 * the walking grid is updated incrementally, so a move costs only what it touches.
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { rotationFacing } from '../../suggest/roomGeometry';
import { gridCost, pairCost, unitCost, type Cost } from './cost';
import { refreshUnit } from './derive';
import { clamp, wrapAngle } from './geom';
import type { Model, Unit } from './model';
import { isFloor } from './cost';
import type { Rng } from './rng';

export interface Pose {
  mode: 'wall' | 'free';
  wall: number;
  t: number;
  x: number;
  y: number;
  rot: number;
  s?: number;
  reversed?: boolean;
}

export const poseOf = (u: Unit): Pose => ({ mode: u.mode, wall: u.wall, t: u.t, x: u.x, y: u.y, rot: u.rot, s: u.kitchen?.s, reversed: u.kitchen?.reversed });

export function setPose(u: Unit, p: Pose): void {
  u.mode = p.mode;
  u.wall = p.wall;
  u.t = p.t;
  u.x = p.x;
  u.y = p.y;
  u.rot = p.rot;
  if (u.kitchen && p.s !== undefined) {
    u.kitchen.s = p.s;
    u.kitchen.reversed = !!p.reversed;
  }
}

const total = (c: Cost) => c.hard + c.soft;

export class State {
  readonly m: Model;
  unitC: Cost[];
  pairC: Cost[][];
  grid = 0;
  constructor(m: Model) {
    this.m = m;
    const n = m.units.length;
    this.unitC = Array.from({ length: n }, () => ({ hard: 0, soft: 0 }));
    this.pairC = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ hard: 0, soft: 0 })));
  }

  /** Full recomputation (after a start or restore). */
  rebuild(): void {
    const { m } = this;
    const n = m.units.length;
    if (this.unitC.length !== n) {
      this.unitC = Array.from({ length: n }, () => ({ hard: 0, soft: 0 }));
      this.pairC = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ hard: 0, soft: 0 })));
    }
    for (const u of m.units) this.ungrid(u);
    for (const u of m.units) refreshUnit(m, u);
    for (const u of m.units) this.engrid(u);
    for (const u of m.units) this.unitC[u.index] = unitCost(m, u);
    for (const u of m.units) for (const v of m.units) if (u.index < v.index) this.pairC[u.index][v.index] = pairCost(m, u, v);
    this.grid = gridCost(m);
  }

  ungrid(u: Unit): void {
    for (const n of u.nodes) {
      if (n.gridBox) {
        this.m.ctx.grid.add(n.gridBox, -1);
        n.gridBox = null;
      }
    }
  }

  engrid(u: Unit): void {
    if (!u.active) return;
    for (const n of u.nodes) {
      if (isFloor(n)) {
        n.gridBox = { ...n.box };
        this.m.ctx.grid.add(n.gridBox, 1);
      }
    }
  }

  hard(): number {
    let h = this.grid;
    for (const c of this.unitC) h += c.hard;
    for (let i = 0; i < this.pairC.length; i++) for (let j = i + 1; j < this.pairC.length; j++) h += this.pairC[i][j].hard;
    return h;
  }

  total(): number {
    let t = this.grid;
    for (const c of this.unitC) t += total(c);
    for (let i = 0; i < this.pairC.length; i++) for (let j = i + 1; j < this.pairC.length; j++) t += total(this.pairC[i][j]);
    return t;
  }

  /** Hard cost that touches one unit (its own and its pairs), without the grid. */
  unitHard(u: Unit): number {
    let h = this.unitC[u.index].hard;
    for (const v of this.m.units) if (v !== u) h += this.pair(u.index, v.index).hard;
    return h;
  }

  pair(i: number, j: number): Cost {
    return i < j ? this.pairC[i][j] : this.pairC[j][i];
  }

  /**
   * Try new poses for some units. Returns the change of the total and a commit/rollback pair.
   * `bound`: give up (and roll back) as soon as the change surely exceeds it.
   */
  propose(changes: { u: Unit; pose: Pose }[], bound = Infinity): { delta: number; commit: () => void; rollback: () => void } {
    const { m } = this;
    const olds = changes.map((c) => poseOf(c.u));
    const set = new Set(changes.map((c) => c.u.index));
    for (const c of changes) {
      setPose(c.u, c.pose);
      refreshUnit(m, c.u);
    }
    const newUnit = new Map<number, Cost>();
    const newPair = new Map<string, Cost>();
    let delta = 0;
    for (const c of changes) {
      const nc = unitCost(m, c.u);
      newUnit.set(c.u.index, nc);
      delta += total(nc) - total(this.unitC[c.u.index]);
      for (const v of m.units) {
        if (v === c.u || (set.has(v.index) && v.index < c.u.index)) continue;
        const pc = pairCost(m, c.u, v);
        newPair.set(`${c.u.index}|${v.index}`, pc);
        delta += total(pc) - total(this.pair(c.u.index, v.index));
      }
    }
    const restorePoses = () => {
      changes.forEach((c, k) => {
        setPose(c.u, olds[k]);
        refreshUnit(m, c.u);
      });
    };
    // the grid cost can only drop by what it is now
    if (delta - this.grid > bound) {
      restorePoses();
      return { delta: Infinity, commit: () => {}, rollback: () => {} };
    }
    const oldBoxes = changes.map((c) => c.u.nodes.map((n) => n.gridBox));
    for (const c of changes) this.ungridFrom(c.u, oldBoxes[changes.indexOf(c)]);
    for (const c of changes) this.engrid(c.u);
    const g = gridCost(m);
    delta += g - this.grid;
    return {
      delta,
      commit: () => {
        for (const [i, c] of newUnit) this.unitC[i] = c;
        for (const [k, c] of newPair) {
          const [a, b] = k.split('|').map(Number);
          if (a < b) this.pairC[a][b] = c;
          else this.pairC[b][a] = c;
        }
        this.grid = g;
      },
      rollback: () => {
        for (const c of changes) this.ungrid(c.u);
        restorePoses();
        for (const c of changes) this.engrid(c.u);
      },
    };
  }

  private ungridFrom(u: Unit, boxes: (import('./geom').Box | null)[]): void {
    u.nodes.forEach((n, k) => {
      const b = boxes[k];
      if (b) this.m.ctx.grid.add(b, -1);
      n.gridBox = null;
    });
  }
}

// ---------------------------------------------------------------------------------------------
// poses
// ---------------------------------------------------------------------------------------------

/** Wall pose nearest to a point (back of the piece at the wall). */
export function wallPoseNear(m: Model, u: Unit, p: Vec2, facing?: number, only?: number): Pose {
  let best: Pose | null = null;
  let bd = Infinity;
  const width = u.main?.spec.width ?? 0;
  const depth = u.main?.spec.depth ?? 0;
  m.ctx.walls.forEach((w, i) => {
    if (only !== undefined && i !== only) return;
    if (w.length < width - 0.01) return;
    const t = clamp((p.x - w.a.x) * w.dir.x + (p.y - w.a.y) * w.dir.y, width / 2, w.length - width / 2);
    const bx = w.a.x + w.dir.x * t + (w.inward.x * depth) / 2;
    const by = w.a.y + w.dir.y * t + (w.inward.y * depth) / 2;
    let d = Math.hypot(bx - p.x, by - p.y);
    if (facing !== undefined) d += 0.6 * Math.abs(Math.sin((wrapAngle(rotationFacing(w.inward) - facing)) / 2));
    if (d < bd) {
      bd = d;
      best = { mode: 'wall', wall: i, t, x: u.x, y: u.y, rot: u.rot };
    }
  });
  return best ?? { mode: 'free', wall: 0, t: 0, x: p.x, y: p.y, rot: facing ?? 0 };
}

const snap90 = (r: number) => Math.round(r / (Math.PI / 2)) * (Math.PI / 2);

/** Start pose from Claude's place: on the nearest wall for wall pieces, else free on the 90° grid. */
export function hintPose(m: Model, u: Unit): Pose {
  const n = u.main!;
  const z = u.zoneRect;
  const p = u.hint ?? (z ? { x: (z.x0 + z.x1) / 2, y: (z.y0 + z.y1) / 2, rotation: 0 } : { ...centroid(m.ctx.poly), rotation: 0 });
  if (u.kind === 'wall-item' || u.bound === 'always' || u.wantWall !== null) return wallPoseNear(m, u, p, u.hint?.rotation, u.wantWall ?? undefined);
  if (u.bound === 'prefer') {
    const wp = wallPoseNear(m, u, p, u.hint?.rotation);
    const w = m.ctx.walls[wp.wall];
    // back of the piece within 35 cm of the wall: Claude meant it at the wall
    const back = { x: p.x - (Math.sin(-(u.hint?.rotation ?? 0)) * n.spec.depth) / 2, y: p.y - (Math.cos(u.hint?.rotation ?? 0) * n.spec.depth) / 2 };
    const off = (back.x - w.a.x) * w.inward.x + (back.y - w.a.y) * w.inward.y;
    if (wp.mode === 'wall' && off < 0.35) return wp;
  }
  return { mode: 'free', wall: 0, t: 0, x: p.x, y: p.y, rot: snap90(p.rotation) };
}

function centroid(poly: Vec2[]): Vec2 {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

/** Random neighbour pose. */
export function randomMove(m: Model, u: Unit, rng: Rng, start: Pose): Pose {
  const p = poseOf(u);
  if (u.kitchen) {
    const k = u.kitchen;
    const w = m.ctx.walls[k.wall];
    const r = rng.next();
    if (r < 0.15) return { ...p, reversed: !k.reversed };
    if (r < 0.3) return { ...p, s: k.preferred };
    return { ...p, s: clamp(k.s + rng.normal() * (rng.next() < 0.5 ? 0.1 : 0.5), 0, Math.max(0, w.length - k.length)) };
  }
  const n = u.main!;
  const sigma = rng.next() < 0.6 ? 0.08 + 0.2 * rng.next() : 0.4 + rng.next();
  const r = rng.next();
  if (r < 0.08) return { ...start };
  if (u.mode === 'wall') {
    const w = m.ctx.walls[u.wall];
    if (r < 0.55) return { ...p, t: clamp(u.t + rng.normal() * sigma, n.spec.width / 2, Math.max(n.spec.width / 2, w.length - n.spec.width / 2)) };
    if (r < 0.7) return { ...p, t: rng.next() < 0.5 ? n.spec.width / 2 : w.length - n.spec.width / 2 };
    if (r < 0.88 || u.bound === 'always' || u.kind === 'wall-item') {
      const walls = m.ctx.walls.map((_, i) => i).filter((i) => m.ctx.walls[i].length >= n.spec.width);
      if (!walls.length) return p;
      const wi = walls[Math.floor(rng.next() * walls.length)];
      const ww = m.ctx.walls[wi];
      return { ...p, wall: wi, t: n.spec.width / 2 + rng.next() * Math.max(0, ww.length - n.spec.width) };
    }
    // step away from the wall
    const off = 0.05 + rng.next() * 0.6;
    return { mode: 'free', wall: u.wall, t: u.t, x: n.box.x + w.inward.x * off, y: n.box.y + w.inward.y * off, rot: snap90(n.box.rotation) };
  }
  if (r < 0.6) {
    const q = { ...p, x: u.x + rng.normal() * sigma, y: u.y + rng.normal() * sigma };
    return pointInPolygon(q, m.ctx.poly) ? q : p;
  }
  if (r < 0.8) return { ...p, rot: wrapAngle(u.rot + (rng.next() < 0.5 ? 1 : rng.next() < 0.5 ? -1 : 2) * (Math.PI / 2)) };
  if (u.bound === 'free' && r < 0.88) return p;
  return wallPoseNear(m, u, { x: u.x, y: u.y }, u.rot);
}

/** Candidate poses for repair and for „anchors first“: wall slots every 10–20 cm and free grid points. */
export function candidates(m: Model, u: Unit, rng: Rng, limit = 160): Pose[] {
  const out: Pose[] = [];
  if (u.kitchen) {
    const w = m.ctx.walls[u.kitchen.wall];
    const span = Math.max(0, w.length - u.kitchen.length);
    for (let s = 0; s <= span + 1e-6; s += 0.05) for (const reversed of [false, true]) out.push({ ...poseOf(u), s, reversed });
    return out;
  }
  const n = u.main!;
  const step = n.spec.width > 1 ? 0.1 : 0.15;
  m.ctx.walls.forEach((w, i) => {
    if (w.length < n.spec.width - 0.01) return;
    if (u.wantWall !== null && i !== u.wantWall && rng.next() < 0.6) return;
    for (let t = n.spec.width / 2; t <= w.length - n.spec.width / 2 + 1e-6; t += step) out.push({ mode: 'wall', wall: i, t, x: u.x, y: u.y, rot: u.rot });
    out.push({ mode: 'wall', wall: i, t: w.length - n.spec.width / 2, x: u.x, y: u.y, rot: u.rot });
  });
  if (u.bound !== 'always' && u.kind !== 'wall-item') {
    const xs = m.ctx.poly.map((p) => p.x);
    const ys = m.ctx.poly.map((p) => p.y);
    const g = 0.2;
    for (let x = Math.min(...xs) + 0.3; x < Math.max(...xs) - 0.2; x += g) {
      for (let y = Math.min(...ys) + 0.3; y < Math.max(...ys) - 0.2; y += g) {
        if (!pointInPolygon({ x, y }, m.ctx.poly)) continue;
        for (let k = 0; k < 4; k++) out.push({ mode: 'free', wall: 0, t: 0, x, y, rot: wrapAngle((k * Math.PI) / 2) });
      }
    }
  }
  if (out.length <= limit) return out;
  // keep an even spread: shuffle deterministically and cut
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, limit);
}
