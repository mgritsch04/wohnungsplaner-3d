/**
 * Support for walls that are not axis-aligned (e.g. 30° or 45°).
 *
 * The band detectors (raster and vector) only understand horizontal and
 * vertical strips. For an oblique wall direction φ the input is rotated into a
 * "frame" in which those walls are axis-aligned, detected there with the same
 * code, and mapped back. Afterwards wall ends of different frames are joined
 * at the intersection of their centerlines (corners and T-junctions).
 */
import type { GapInfo, RecognizedOpening, RecognizedWall } from './bands';

export interface Pt {
  x: number;
  y: number;
}

/** Rotated pixel frame: frame point = R(−φ)·p − (u0, v0). */
export interface Frame {
  cos: number;
  sin: number;
  u0: number;
  v0: number;
}

export function makeFrame(phi: number, u0 = 0, v0 = 0): Frame {
  return { cos: Math.cos(phi), sin: Math.sin(phi), u0, v0 };
}

export function toFrame(f: Frame, p: Pt): Pt {
  return { x: p.x * f.cos + p.y * f.sin - f.u0, y: -p.x * f.sin + p.y * f.cos - f.v0 };
}

export function fromFrame(f: Frame, q: Pt): Pt {
  const u = q.x + f.u0;
  const v = q.y + f.v0;
  return { x: u * f.cos - v * f.sin, y: u * f.sin + v * f.cos };
}

export function dirFromFrame(f: Frame, d: Pt): Pt {
  return { x: d.x * f.cos - d.y * f.sin, y: d.x * f.sin + d.y * f.cos };
}

/** Map walls/openings detected in a frame back to the original pixel frame. */
export function mapFromFrame(f: Frame, res: { walls: RecognizedWall[]; openings: RecognizedOpening[] }): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  return {
    walls: res.walls.map((w) => ({ ...w, a: fromFrame(f, w.a), b: fromFrame(f, w.b) })),
    openings: res.openings.map((o) => ({ ...o, center: fromFrame(f, o.center), swingSide: o.swingSide ? dirFromFrame(f, o.swingSide) : undefined })),
  };
}

const DEG = Math.PI / 180;

/** Angle of a direction folded into [0°, 90°) – walls at φ and φ+90° share one frame. */
export function foldQuarter(angle: number): number {
  const q = Math.PI / 2;
  return ((angle % q) + q) % q;
}

/** True if a folded angle is clearly away from the axes (axis-aligned walls are handled by the main detector). */
export function isOblique(folded: number, axisTol = 3 * DEG): boolean {
  return folded >= axisTol && folded <= Math.PI / 2 - axisTol;
}

/** Is a point inside the footprint of a wall (rectangle along its centerline), with extra margin (and extra length at both ends)? */
export function insideWall(p: Pt, w: RecognizedWall, margin: number, alongExtra = 0): boolean {
  const dx = w.b.x - w.a.x;
  const dy = w.b.y - w.a.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return false;
  const ux = dx / L;
  const uy = dy / L;
  const px = p.x - w.a.x;
  const py = p.y - w.a.y;
  const along = px * ux + py * uy;
  const across = Math.abs(-px * uy + py * ux);
  return across <= w.thickness / 2 + margin && along >= -margin - alongExtra && along <= L + margin + alongExtra;
}

/**
 * Clear (set to 0) all mask pixels inside a wall footprint plus margin. The
 * ends are extended by half the thickness so that corner squares vanish too.
 */
export function clearWall(mask: Uint8Array, W: number, H: number, w: RecognizedWall, margin: number) {
  const r = w.thickness / 2 + margin;
  const ext = w.thickness / 2;
  const x0 = Math.max(0, Math.floor(Math.min(w.a.x, w.b.x) - r - 1));
  const x1 = Math.min(W - 1, Math.ceil(Math.max(w.a.x, w.b.x) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(w.a.y, w.b.y) - r - 1));
  const y1 = Math.min(H - 1, Math.ceil(Math.max(w.a.y, w.b.y) + r + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (mask[y * W + x] && insideWall({ x, y }, w, margin, ext)) mask[y * W + x] = 0;
    }
  }
}

/** Chamfer (3-4) distance of every foreground pixel to the background, in units of 1/3 px. */
export function chamferDistance(mask: Uint8Array, W: number, H: number): Uint16Array {
  const d = new Uint16Array(W * H);
  const INF = 65000;
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? INF : 0;
  // pixels outside the image count as background
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x > 0 ? d[i - 1] + 3 : 3);
      if (y > 0) {
        v = Math.min(v, d[i - W] + 3);
        v = Math.min(v, x > 0 ? d[i - W - 1] + 4 : 4);
        v = Math.min(v, x < W - 1 ? d[i - W + 1] + 4 : 4);
      } else v = Math.min(v, 3);
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      v = Math.min(v, x < W - 1 ? d[i + 1] + 3 : 3);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + 3);
        v = Math.min(v, x < W - 1 ? d[i + W + 1] + 4 : 4);
        v = Math.min(v, x > 0 ? d[i + W - 1] + 4 : 4);
      } else v = Math.min(v, 3);
      d[i] = v;
    }
  }
  return d;
}

export interface AngleCandidate {
  /** Line direction in radians, [0, π). */
  angle: number;
  score: number;
  /** Extreme points of the pixels on long lines in this direction (to limit the search area). */
  extent: Pt[];
}

export interface DominantAngles {
  angles: AngleCandidate[];
}

/**
 * Find directions of long, thick strokes in a binary mask that are not
 * axis-aligned. Only "core" pixels (at least `coreRadius` px away from the
 * background) take part, so thin lines (text, hatching, door arcs, dimension
 * lines) are ignored. A projection histogram per direction (Hough-like) gives
 * a score; local maxima are refined to 0.1°.
 */
export function findDominantAngles(
  mask: Uint8Array,
  W: number,
  H: number,
  opts: { coreRadius: number; minLen: number; axisTolDeg?: number; maxCandidates?: number; maxPixels?: number },
): DominantAngles {
  const dt = chamferDistance(mask, W, H);
  const thr = Math.max(3, Math.round(opts.coreRadius * 3));
  let n = 0;
  for (let i = 0; i < W * H; i++) if (dt[i] >= thr) n++;
  if (n === 0) return { angles: [] };
  const stride = Math.max(1, Math.ceil(n / (opts.maxPixels ?? 250_000)));
  const m = Math.ceil(n / stride);
  const xs = new Float32Array(m);
  const ys = new Float32Array(m);
  let k = 0;
  let seen = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (dt[y * W + x] < thr) continue;
      if (seen++ % stride === 0 && k < m) {
        xs[k] = x;
        ys[k] = y;
        k++;
      }
    }
  }
  const diag = Math.ceil(Math.hypot(W, H)) + 2;
  const counts = new Int32Array(2 * diag + 1);
  const project = (a: number) => {
    counts.fill(0);
    const s = Math.sin(a);
    const c = Math.cos(a);
    for (let i = 0; i < k; i++) counts[Math.round(-xs[i] * s + ys[i] * c) + diag]++;
  };
  const maxWindow = (w: number) => {
    let sum = 0;
    let best = 0;
    for (let i = 0; i < counts.length; i++) {
      sum += counts[i];
      if (i >= w) sum -= counts[i - w];
      if (sum > best) best = sum;
    }
    return best;
  };
  const sharpness = () => {
    let s = 0;
    for (let i = 0; i < counts.length; i++) s += counts[i] * counts[i];
    return s;
  };

  const score = new Float64Array(180);
  for (let d = 0; d < 180; d++) {
    project(d * DEG);
    score[d] = maxWindow(5) * stride;
  }
  const axisTol = opts.axisTolDeg ?? 4;
  const minScore = 3 * opts.minLen;
  const raw: { d: number; s: number }[] = [];
  for (let d = 0; d < 180; d++) {
    const prev = score[(d + 179) % 180];
    const next = score[(d + 1) % 180];
    if (score[d] < minScore || score[d] < prev || score[d] <= next) continue;
    const folded = d % 90;
    if (folded < axisTol || folded > 90 - axisTol) continue;
    raw.push({ d, s: score[d] });
  }
  raw.sort((p, q) => q.s - p.s);
  const picked: { d: number; s: number }[] = [];
  for (const r of raw) {
    if (picked.some((p) => Math.min(Math.abs(p.d - r.d), 180 - Math.abs(p.d - r.d)) < 3)) continue;
    picked.push(r);
    if (picked.length >= (opts.maxCandidates ?? 4)) break;
  }
  const angles = picked.map(({ d, s }) => {
    let best = d * DEG;
    let bestS = -1;
    for (let t = -10; t <= 10; t++) {
      const a = (d + t / 10) * DEG;
      project(a);
      const sh = sharpness();
      if (sh > bestS) {
        bestS = sh;
        best = a;
      }
    }
    // extent of the pixels lying on long lines (projection bins with many pixels) in this
    // direction; walls crossing at a small angle also fill bins, so the bar is relative to the
    // strongest line (shorter parallel walls usually lie within the extent of the long ones)
    project(best);
    let peak = 0;
    for (let i = 0; i < counts.length; i++) peak = Math.max(peak, counts[i]);
    const minCount = Math.max(2, opts.minLen / stride, 0.25 * peak);
    const sb = Math.sin(best);
    const cb = Math.cos(best);
    let minU: Pt | null = null;
    let maxU: Pt | null = null;
    let minV: Pt | null = null;
    let maxV: Pt | null = null;
    for (let i = 0; i < k; i++) {
      const v = -xs[i] * sb + ys[i] * cb;
      if (counts[Math.round(v) + diag] < minCount) continue;
      const u = xs[i] * cb + ys[i] * sb;
      const p = { x: xs[i], y: ys[i] };
      if (!minU || u < minU.x * cb + minU.y * sb) minU = p;
      if (!maxU || u > maxU.x * cb + maxU.y * sb) maxU = p;
      if (!minV || v < -minV.x * sb + minV.y * cb) minV = p;
      if (!maxV || v > -maxV.x * sb + maxV.y * cb) maxV = p;
    }
    return { angle: (best + Math.PI) % Math.PI, score: s, extent: [minU, maxU, minV, maxV].filter((p): p is Pt => !!p) };
  });
  return { angles };
}

/** Group candidate directions into frames (folded to [0°, 90°)), strongest first, with the extent of their lines. */
export function groupFrames(angles: AngleCandidate[], tol = 1.5 * DEG): { phi: number; extent: Pt[] }[] {
  const frames: { phi: number; score: number; extent: Pt[] }[] = [];
  for (const a of [...angles].sort((p, q) => q.score - p.score)) {
    const phi = foldQuarter(a.angle);
    const f = frames.find((f) => Math.abs(f.phi - phi) < tol);
    if (f) f.extent.push(...a.extent);
    else frames.push({ phi, score: a.score, extent: [...a.extent] });
  }
  return frames.map(({ phi, extent }) => ({ phi, extent }));
}

/** Nearest-neighbour rotation of a binary mask into a frame of size RW × RH. */
export function rotateMask(mask: Uint8Array, W: number, H: number, f: Frame, RW: number, RH: number): Uint8Array {
  const out = new Uint8Array(RW * RH);
  for (let j = 0; j < RH; j++) {
    const v = j + f.v0;
    for (let i = 0; i < RW; i++) {
      const u = i + f.u0;
      const x = Math.round(u * f.cos - v * f.sin);
      const y = Math.round(u * f.sin + v * f.cos);
      if (x >= 0 && y >= 0 && x < W && y < H) out[j * RW + i] = mask[y * W + x];
    }
  }
  return out;
}

export interface CrossJoinOptions {
  joinTol: number;
  /** Extra clearance used when wall footprints were removed from the mask. */
  margin: number;
  minOpening: number;
  maxOpening: number;
}

/** Classifies the gap between a wall end (g0) and a wall it runs into (g1). */
export type EndGapClassifier = (wall: RecognizedWall, g0: Pt, g1: Pt) => GapInfo;

function segDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Join free wall ends to non-parallel walls of another frame at the
 * intersection of the centerlines (mutates `walls`). Axis-aligned pairs are
 * left alone – the band assembler already joined them. Returns openings found
 * between a wall end and the wall it runs into (e.g. a door next to a corner).
 */
export function joinAcrossFrames(walls: RecognizedWall[], oblique: boolean[], opts: CrossJoinOptions, classify?: EndGapClassifier): RecognizedOpening[] {
  const openings: RecognizedOpening[] = [];
  const minSin = Math.sin(15 * DEG);
  const dirOf = (w: RecognizedWall) => {
    const L = Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) || 1;
    return { x: (w.b.x - w.a.x) / L, y: (w.b.y - w.a.y) / L };
  };
  const connected = (wi: number, e: Pt) => {
    const d = dirOf(walls[wi]);
    return walls.some((q, qi) => {
      if (qi === wi) return false;
      const dq = dirOf(q);
      return Math.abs(d.x * dq.y - d.y * dq.x) >= minSin && segDistance(e, q.a, q.b) <= 1.5;
    });
  };
  const order = [...walls.keys()].sort((i, j) => Number(oblique[j]) - Number(oblique[i]));
  for (const wi of order) {
    const w = walls[wi];
    for (const end of ['a', 'b'] as const) {
      const E = w[end];
      const O = end === 'a' ? w.b : w.a;
      const L = Math.hypot(E.x - O.x, E.y - O.y);
      if (L < 1e-6 || connected(wi, E)) continue;
      const u = { x: (E.x - O.x) / L, y: (E.y - O.y) / L };
      let best: { I: Pt; d: number } | null = null;
      let bestGap: { I: Pt; g: number } | null = null;
      for (let qi = 0; qi < walls.length; qi++) {
        if (qi === wi || (!oblique[wi] && !oblique[qi])) continue;
        const q = walls[qi];
        const Lq = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
        if (Lq < 1e-6) continue;
        const uq = { x: (q.b.x - q.a.x) / Lq, y: (q.b.y - q.a.y) / Lq };
        const cr = u.x * uq.y - u.y * uq.x;
        const sin = Math.abs(cr);
        if (sin < minSin) continue;
        const cot = Math.sqrt(Math.max(0, 1 - sin * sin)) / sin;
        // E + s·u = q.a + r·uq
        const s = ((q.a.x - E.x) * uq.y - (q.a.y - E.y) * uq.x) / cr;
        const I = { x: E.x + u.x * s, y: E.y + u.y * s };
        const r = (I.x - q.a.x) * uq.x + (I.y - q.a.y) * uq.y;
        const limQ = (w.thickness / 2 + opts.joinTol + opts.margin) / sin + (q.thickness / 2) * cot;
        if (r < -limQ || r > Lq + limQ) continue;
        const ext = (q.thickness / 2 + opts.margin + opts.joinTol) / sin + (w.thickness / 2) * cot;
        const over = (q.thickness / 2 + opts.joinTol) / sin + (w.thickness / 2) * cot;
        if (s >= -over && s <= ext) {
          if (!best || Math.abs(s) < Math.abs(best.d)) best = { I, d: s };
        } else if (s > ext && r >= -q.thickness / 2 && r <= Lq + q.thickness / 2) {
          const g = s - q.thickness / 2 / sin;
          if (g >= opts.minOpening && g <= opts.maxOpening && (!bestGap || g < bestGap.g)) bestGap = { I, g };
        }
      }
      if (best) {
        w[end] = best.I;
      } else if (bestGap) {
        const g1 = { x: E.x + u.x * bestGap.g, y: E.y + u.y * bestGap.g };
        const info: GapInfo = classify ? classify(w, E, g1) : { kind: 'passage', confidence: 0.35, note: 'Lücke am Wandende' };
        openings.push({ center: { x: (E.x + g1.x) / 2, y: (E.y + g1.y) / 2 }, width: bestGap.g, ...info, confidence: info.confidence * 0.8 });
        w[end] = bestGap.I;
      }
    }
  }
  return openings;
}
