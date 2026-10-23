/**
 * Walking grid of a room (#441): where one can stand with a given clear radius and what can be
 * reached from the doors (the ways between doors are measured by stage 0, `checkWalkways`). Grid cell 5 cm (10 cm in big rooms).
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { boundaryDist, bounds } from './geom';
import type { RItem } from './items';

export class WalkGrid {
  readonly cell: number;
  readonly x0: number;
  readonly y0: number;
  readonly nx: number;
  readonly ny: number;
  private readonly inside: Uint8Array;
  private readonly obstacleDist: Float32Array;
  private readonly wallDist: Float32Array;
  private readonly doorNear: Uint8Array;
  private readonly masks = new Map<number, Uint8Array>();

  /**
   * @param obstacles pieces that block walking
   * @param doorMids door and passage centres on the wall: near them the wall does not narrow the walk
   */
  constructor(
    readonly poly: Vec2[],
    obstacles: RItem[],
    doorMids: Vec2[],
  ) {
    const b = bounds(poly);
    const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    this.cell = area > 45 ? 0.1 : 0.05;
    this.x0 = b.x0;
    this.y0 = b.y0;
    this.nx = Math.ceil((b.x1 - b.x0) / this.cell) + 1;
    this.ny = Math.ceil((b.y1 - b.y0) / this.cell) + 1;
    const n = this.nx * this.ny;
    this.inside = new Uint8Array(n);
    this.obstacleDist = new Float32Array(n).fill(9);
    this.wallDist = new Float32Array(n).fill(9);
    this.doorNear = new Uint8Array(n);
    const boxes = obstacles.map((o) => {
      const c = Math.cos(o.rotation);
      const s = Math.sin(o.rotation);
      return { o, c, s, hw: o.width / 2, hd: o.depth / 2, reach: Math.hypot(o.width, o.depth) / 2 + 1.2 };
    });
    for (let j = 0; j < this.ny; j++)
      for (let i = 0; i < this.nx; i++) {
        const p = this.centre(i, j);
        const k = j * this.nx + i;
        if (!pointInPolygon(p, poly)) continue;
        this.inside[k] = 1;
        this.wallDist[k] = boundaryDist(p, poly);
        let best = 9;
        for (const bx of boxes) {
          const dx = p.x - bx.o.x;
          const dy = p.y - bx.o.y;
          if (Math.abs(dx) > bx.reach || Math.abs(dy) > bx.reach) continue;
          const lu = Math.abs(dx * bx.c + dy * bx.s);
          const lv = Math.abs(-dx * bx.s + dy * bx.c);
          best = Math.min(best, Math.hypot(Math.max(lu - bx.hw, 0), Math.max(lv - bx.hd, 0)));
        }
        this.obstacleDist[k] = best;
        if (doorMids.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 0.8)) this.doorNear[k] = 1;
      }
  }

  centre(i: number, j: number): Vec2 {
    return { x: this.x0 + i * this.cell, y: this.y0 + j * this.cell };
  }

  private cellOf(p: Vec2): [number, number] {
    return [Math.round((p.x - this.x0) / this.cell), Math.round((p.y - this.y0) / this.cell)];
  }

  /** Cells where a walker with this clear radius (half the width of the walk) fits. */
  mask(radius: number): Uint8Array {
    const key = Math.round(radius * 1000);
    let m = this.masks.get(key);
    if (!m) {
      m = new Uint8Array(this.inside.length);
      for (let k = 0; k < m.length; k++) m[k] = this.inside[k] && this.obstacleDist[k] >= radius - 0.012 && (this.wallDist[k] >= radius - 0.012 || this.doorNear[k]) ? 1 : 0;
      this.masks.set(key, m);
    }
    return m;
  }

  /** Nearest free cell within `reach` of a point, or -1. */
  private snap(p: Vec2, mask: Uint8Array, reach = 0.5): number {
    const [ci, cj] = this.cellOf(p);
    const r = Math.ceil(reach / this.cell);
    let best = -1;
    let bestD = Infinity;
    for (let j = Math.max(0, cj - r); j <= Math.min(this.ny - 1, cj + r); j++)
      for (let i = Math.max(0, ci - r); i <= Math.min(this.nx - 1, ci + r); i++) {
        const k = j * this.nx + i;
        if (!mask[k]) continue;
        const d = Math.hypot(i - ci, j - cj);
        if (d < bestD && d * this.cell <= reach) {
          bestD = d;
          best = k;
        }
      }
    return best;
  }

  /** Cells one can reach from the given points with a clear radius. */
  reachable(starts: Vec2[], radius: number): Uint8Array {
    const mask = this.mask(radius);
    const seen = new Uint8Array(mask.length);
    const stack: number[] = [];
    for (const p of starts) {
      const k = this.snap(p, mask);
      if (k >= 0 && !seen[k]) {
        seen[k] = 1;
        stack.push(k);
      }
    }
    while (stack.length) {
      const k = stack.pop()!;
      const ki = k % this.nx;
      const kj = (k - ki) / this.nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ki + di;
        const nj = kj + dj;
        if (ni < 0 || nj < 0 || ni >= this.nx || nj >= this.ny) continue;
        const nk = nj * this.nx + ni;
        if (mask[nk] && !seen[nk]) {
          seen[nk] = 1;
          stack.push(nk);
        }
      }
    }
    return seen;
  }

  /** Whether a reachable cell lies within `reach` of the point. */
  touches(seen: Uint8Array, p: Vec2, reach: number): boolean {
    const [ci, cj] = this.cellOf(p);
    const r = Math.ceil(reach / this.cell);
    for (let j = Math.max(0, cj - r); j <= Math.min(this.ny - 1, cj + r); j++)
      for (let i = Math.max(0, ci - r); i <= Math.min(this.nx - 1, ci + r); i++)
        if (seen[j * this.nx + i] && Math.hypot(i - ci, j - cj) * this.cell <= reach) return true;
    return false;
  }
}
