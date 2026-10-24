/**
 * Walking grid of a room (5 cm cells): which cells a person of a given clear width can stand
 * on. A cell is blocked for a width w when its centre is outside the room or closer than w/2 to
 * a solid wall or a piece standing on the floor. Connected free cells between two doors mean a
 * way of that width exists: this is the hard walkway rule (B1/B2), the walkway path from stage 0
 * is only a reference.
 *
 * Pieces are added and removed incrementally (a count per cell), so the search can test a move
 * without rebuilding the grid.
 */
import { pointInPolygon, type Vec2 } from '../../model/vec';
import { distToBox, distToSegment, type Box } from './geom';

export class WalkGrid {
  readonly cell: number;
  readonly ox: number;
  readonly oy: number;
  readonly nx: number;
  readonly ny: number;
  /** Half widths (m) the grid tracks, one layer each. */
  readonly radii: number[];
  /** Extra distance kept to placed pieces per layer (m), so the independent check measures the full width too. */
  readonly pads: number[];
  private readonly fixed: Uint8Array[];
  private readonly count: Uint16Array[];
  private readonly label: Int32Array;
  private readonly queue: Int32Array;
  private labelLayer = -1;

  constructor(room: readonly Vec2[], solid: readonly [Vec2, Vec2][], obstacles: readonly Box[], radii: number[], pads: number[] = [], cell = 0.05) {
    this.cell = cell;
    this.radii = radii;
    this.pads = radii.map((_, i) => pads[i] ?? 0);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of room) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    this.ox = minX;
    this.oy = minY;
    this.nx = Math.max(1, Math.ceil((maxX - minX) / cell));
    this.ny = Math.max(1, Math.ceil((maxY - minY) / cell));
    const n = this.nx * this.ny;
    const dist = new Float32Array(n);
    const inside = new Uint8Array(n);
    for (let j = 0; j < this.ny; j++) {
      for (let i = 0; i < this.nx; i++) {
        const p = { x: this.ox + (i + 0.5) * cell, y: this.oy + (j + 0.5) * cell };
        const k = j * this.nx + i;
        inside[k] = pointInPolygon(p, room as Vec2[]) ? 1 : 0;
        let d = Infinity;
        for (const [a, b] of solid) d = Math.min(d, distToSegment(p, a, b));
        for (const o of obstacles) d = Math.min(d, distToBox(p.x, p.y, o));
        dist[k] = d;
      }
    }
    this.fixed = radii.map((r) => {
      const f = new Uint8Array(n);
      for (let k = 0; k < n; k++) f[k] = !inside[k] || dist[k] < r ? 1 : 0;
      return f;
    });
    this.count = radii.map(() => new Uint16Array(n));
    this.label = new Int32Array(n);
    this.queue = new Int32Array(n);
  }

  /** Add (+1) or remove (−1) a piece standing on the floor. */
  add(b: Box, sign: 1 | -1): void {
    const c = Math.cos(b.rotation);
    const s = Math.sin(b.rotation);
    // half extents of the box along the axes
    const ex = Math.abs(c) * b.hw + Math.abs(s) * b.hd;
    const ey = Math.abs(s) * b.hw + Math.abs(c) * b.hd;
    const cell = this.cell;
    for (let li = 0; li < this.radii.length; li++) {
      const r = this.radii[li] + this.pads[li];
      const r2 = r * r;
      const cnt = this.count[li];
      const i0 = Math.max(0, Math.floor((b.x - ex - r - this.ox) / cell));
      const i1 = Math.min(this.nx - 1, Math.floor((b.x + ex + r - this.ox) / cell));
      const j0 = Math.max(0, Math.floor((b.y - ey - r - this.oy) / cell));
      const j1 = Math.min(this.ny - 1, Math.floor((b.y + ey + r - this.oy) / cell));
      for (let j = j0; j <= j1; j++) {
        const dy = this.oy + (j + 0.5) * cell - b.y;
        const row = j * this.nx;
        for (let i = i0; i <= i1; i++) {
          const dx = this.ox + (i + 0.5) * cell - b.x;
          let u = dx * c + dy * s;
          let v = dy * c - dx * s;
          u = (u < 0 ? -u : u) - b.hw;
          v = (v < 0 ? -v : v) - b.hd;
          if (u < 0) u = 0;
          if (v < 0) v = 0;
          if (u * u + v * v < r2) cnt[row + i] += sign;
        }
      }
    }
  }

  cellOf(p: Vec2): number {
    const i = Math.floor((p.x - this.ox) / this.cell);
    const j = Math.floor((p.y - this.oy) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.ny) return -1;
    return j * this.nx + i;
  }

  free(layer: number, k: number): boolean {
    return k >= 0 && !this.fixed[layer][k] && this.count[layer][k] === 0;
  }

  /**
   * Label the free cells reachable from the seeds on one layer. Returns the component of each
   * seed (−1 when its cell is blocked); seeds in one component share the number. The labels
   * stay valid for `reached` until the next call.
   */
  components(layer: number, seeds: readonly Vec2[]): number[] {
    const { label, queue, nx, ny } = this;
    label.fill(-1);
    this.labelLayer = layer;
    const fixed = this.fixed[layer];
    const cnt = this.count[layer];
    const out: number[] = [];
    let comp = 0;
    for (const s of seeds) {
      const k0 = this.cellOf(s);
      if (k0 < 0 || fixed[k0] || cnt[k0]) {
        out.push(-1);
        continue;
      }
      if (label[k0] >= 0) {
        out.push(label[k0]);
        continue;
      }
      let head = 0;
      let tail = 0;
      queue[tail++] = k0;
      label[k0] = comp;
      while (head < tail) {
        const k = queue[head++];
        const i = k % nx;
        const j = (k - i) / nx;
        if (i > 0) {
          const q = k - 1;
          if (label[q] < 0 && !fixed[q] && !cnt[q]) {
            label[q] = comp;
            queue[tail++] = q;
          }
        }
        if (i < nx - 1) {
          const q = k + 1;
          if (label[q] < 0 && !fixed[q] && !cnt[q]) {
            label[q] = comp;
            queue[tail++] = q;
          }
        }
        if (j > 0) {
          const q = k - nx;
          if (label[q] < 0 && !fixed[q] && !cnt[q]) {
            label[q] = comp;
            queue[tail++] = q;
          }
        }
        if (j < ny - 1) {
          const q = k + nx;
          if (label[q] < 0 && !fixed[q] && !cnt[q]) {
            label[q] = comp;
            queue[tail++] = q;
          }
        }
      }
      out.push(comp++);
    }
    return out;
  }

  /** After `components` on `layer`: is any cell centre inside the convex polygon reached? */
  reached(layer: number, area: readonly Vec2[]): boolean {
    if (this.labelLayer !== layer) return false;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of area) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const i0 = Math.max(0, Math.floor((minX - this.ox) / this.cell));
    const i1 = Math.min(this.nx - 1, Math.floor((maxX - this.ox) / this.cell));
    const j0 = Math.max(0, Math.floor((minY - this.oy) / this.cell));
    const j1 = Math.min(this.ny - 1, Math.floor((maxY - this.oy) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.nx + i;
        if (this.label[k] < 0) continue;
        if (pointInPolygon({ x: this.ox + (i + 0.5) * this.cell, y: this.oy + (j + 0.5) * this.cell }, area as Vec2[])) return true;
      }
    }
    return false;
  }
}
