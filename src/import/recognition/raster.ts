import { assembleWalls, type AssembleOptions, type Band, type GapClassifier, type GapInfo, type RecognizedOpening, type RecognizedWall } from './bands';
import { clearWall, dirFromFrame, findDominantAngles, fromFrame, groupFrames, joinAcrossFrames, makeFrame, mapFromFrame, rotateMask, toFrame, type Pt } from './oblique';

/**
 * Raster wall detector for scanned/bitmap floor plans.
 * Finds thick, dark strokes (typical for filled walls) and their gaps
 * (door/window candidates). Axis-aligned walls are found first; walls at other
 * angles (e.g. 30°, 45°) are then searched in rotated copies of the remaining
 * image. Walls drawn only as thin double outlines are NOT detected.
 * Pure function – runs in a Web Worker.
 */
export interface RasterInput {
  width: number;
  height: number;
  /** Grayscale 0..255, row-major. */
  gray: Uint8ClampedArray | Uint8Array;
  /** Meters per pixel of this (possibly downscaled) image. */
  metersPerPixel: number;
  /** Also search for walls that are not axis-aligned (default: true). */
  oblique?: boolean;
}

export interface RasterOutput {
  walls: { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number; confidence: number }[];
  openings: { center: { x: number; y: number }; width: number; kind: 'door' | 'window' | 'passage'; swingSide?: { x: number; y: number }; hingeSide?: { x: number; y: number }; confidence: number; note?: string }[];
  threshold: number;
}

export function otsuThreshold(gray: ArrayLike<number>): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

interface RasterParams {
  tMin: number;
  tMax: number;
  minLen: number;
  assemble: AssembleOptions;
}

function rasterParams(mpp: number): RasterParams {
  const tMin = Math.max(2, Math.round(0.05 / mpp));
  const tMax = Math.max(tMin + 1, Math.round(0.6 / mpp));
  const minLen = Math.max(tMin * 2, Math.round(0.35 / mpp));
  return {
    tMin,
    tMax,
    minLen,
    assemble: {
      mergeGap: Math.round(0.12 / mpp),
      minOpening: Math.round(0.5 / mpp),
      maxOpening: Math.round(2.6 / mpp),
      joinTol: Math.max(3, Math.round(0.08 / mpp)),
    },
  };
}

type Sampler = (x: number, y: number) => number;

export function detectRasterWalls(input: RasterInput, onProgress?: (p: number) => void): RasterOutput {
  const { width: W, height: H, gray, metersPerPixel: mpp } = input;
  const threshold = Math.min(170, otsuThreshold(gray));
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = gray[i] <= threshold ? 1 : 0;
  onProgress?.(0.15);

  const p = rasterParams(mpp);
  const at: Sampler = (x, y) => (x >= 0 && y >= 0 && x < W && y < H ? dark[Math.floor(y) * W + Math.floor(x)] : 0);
  const axis = detectAxisAligned(dark, W, H, p, at, onProgress);
  if (input.oblique === false) {
    onProgress?.(1);
    return { ...axis, threshold };
  }
  const res = detectOblique(dark, W, H, p, axis, at, (v) => onProgress?.(0.75 + 0.23 * v));
  onProgress?.(1);
  return { ...res, threshold };
}

/** Axis-aligned bands in a binary mask; `at` samples the full dark image in the same frame (gap classification). */
function detectAxisAligned(mask: Uint8Array, W: number, H: number, p: RasterParams, at: Sampler, onProgress?: (p: number) => void): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  const { tMin, tMax, minLen } = p;
  // run lengths
  const vr = new Uint16Array(W * H);
  const hr = new Uint16Array(W * H);
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!mask[y * W + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < H && mask[e * W + x]) e++;
      const len = Math.min(65535, e - y);
      for (let k = y; k < e; k++) vr[k * W + x] = len;
      y = e;
    }
  }
  for (let y = 0; y < H; y++) {
    let x = 0;
    const row = y * W;
    while (x < W) {
      if (!mask[row + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && mask[row + e]) e++;
      const len = Math.min(65535, e - x);
      for (let k = x; k < e; k++) hr[row + k] = len;
      x = e;
    }
  }
  onProgress?.(0.4);

  const bands: Band[] = [];
  // horizontal walls: thin vertically, long horizontally
  bands.push(...extractBands('h', W, H, (x, y) => {
    const i = y * W + x;
    return mask[i] === 1 && vr[i] >= tMin && vr[i] <= tMax && hr[i] >= minLen;
  }, minLen, tMin, tMax));
  onProgress?.(0.6);
  bands.push(...extractBands('v', H, W, (a, c) => {
    const i = a * W + c;
    return mask[i] === 1 && hr[i] >= tMin && hr[i] <= tMax && vr[i] >= minLen;
  }, minLen, tMin, tMax));
  onProgress?.(0.75);

  return assembleWalls(bands, p.assemble, makeRasterClassifier(at));
}

/** Gap classifier on a dark-pixel sampler given in band (frame) coordinates. */
function makeRasterClassifier(at: Sampler): GapClassifier {
  return (b, g0, g1) => {
    const width = g1 - g0;
    // inside the wall band: thin lines along the wall indicate a window
    let inBand = 0;
    let n = 0;
    for (let a = g0 + 1; a < g1 - 1; a += 1) {
      for (let c = b.c - b.t / 2; c <= b.c + b.t / 2; c += 1) {
        n++;
        inBand += b.o === 'h' ? at(a, c) : at(c, a);
      }
    }
    const bandRatio = n ? inBand / n : 0;
    if (bandRatio > 0.06 && bandRatio < 0.7) return { kind: 'window', confidence: 0.5, note: 'Dünne Linien in der Wandlücke' };
    // door swing arcs: dark pixels in the squares beside the gap
    const side = (sign: 1 | -1) => {
      let cnt = 0;
      let tot = 0;
      const step = Math.max(1, Math.floor(width / 40));
      for (let a = g0; a <= g1; a += step) {
        for (let d = b.t / 2 + 2; d <= b.t / 2 + width; d += step) {
          tot++;
          const c = b.c + sign * d;
          cnt += b.o === 'h' ? at(a, c) : at(c, a);
        }
      }
      return tot ? cnt / tot : 0;
    };
    const plus = side(1);
    const minus = side(-1);
    if (Math.max(plus, minus) > 0.015) {
      const s = plus >= minus ? 1 : -1;
      return { kind: 'door', confidence: 0.45, swingSide: b.o === 'h' ? { x: 0, y: s } : { x: s, y: 0 }, note: 'Türbogen vermutet' };
    }
    return { kind: 'passage', confidence: 0.35, note: 'Lücke ohne erkennbares Symbol' };
  };
}

/** Classify the gap g0→g1 along an arbitrary wall direction (used for gaps at oblique wall ends). */
function classifyAlongWall(w: RecognizedWall, g0: Pt, g1: Pt, at: Sampler): GapInfo {
  const f = makeFrame(Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x));
  const atF: Sampler = (i, j) => {
    const q = fromFrame(f, { x: i, y: j });
    return at(q.x, q.y);
  };
  const q0 = toFrame(f, g0);
  const q1 = toFrame(f, g1);
  const a0 = Math.min(q0.x, q1.x);
  const a1 = Math.max(q0.x, q1.x);
  const band: Band = { o: 'h', a0, a1, c: toFrame(f, w.a).y, t: w.thickness, conf: w.confidence };
  const info = makeRasterClassifier(atF)(band, a0, a1);
  return info.swingSide ? { ...info, swingSide: dirFromFrame(f, info.swingSide) } : info;
}

/** Pixels removed around already detected walls before searching the rest (anti-aliasing, ragged edges). */
const CLEAR_MARGIN = 2;
const MAX_FRAMES = 3;

/**
 * Search the image without the axis-aligned walls for walls in other
 * directions: find dominant directions, rotate the remaining mask so that
 * those walls become axis-aligned, detect them there and map back.
 */
function detectOblique(
  dark: Uint8Array,
  W: number,
  H: number,
  p: RasterParams,
  axis: { walls: RecognizedWall[]; openings: RecognizedOpening[] },
  at: Sampler,
  onProgress: (p: number) => void,
): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  const residual = dark.slice();
  for (const w of axis.walls) clearWall(residual, W, H, w, CLEAR_MARGIN);
  const found = findDominantAngles(residual, W, H, { coreRadius: p.tMin / 2, minLen: p.minLen });
  onProgress(0.25);
  if (!found.angles.length) return axis;
  const frames = groupFrames(found.angles).slice(0, MAX_FRAMES);
  // search area: the lines found in this direction, plus room for wall ends and thickness
  const pad = p.tMax + p.minLen;
  const obliqueWalls: RecognizedWall[] = [];
  const obliqueOpenings: RecognizedOpening[] = [];
  frames.forEach(({ phi, extent }, fi) => {
    if (!extent.length) return;
    const pts = extent.map((c) => toFrame(makeFrame(phi), c));
    const u0 = Math.floor(Math.min(...pts.map((c) => c.x)) - pad);
    const v0 = Math.floor(Math.min(...pts.map((c) => c.y)) - pad);
    const RW = Math.ceil(Math.max(...pts.map((c) => c.x)) + pad) - u0 + 1;
    const RH = Math.ceil(Math.max(...pts.map((c) => c.y)) + pad) - v0 + 1;
    const f = makeFrame(phi, u0, v0);
    const rot = rotateMask(residual, W, H, f, RW, RH);
    const atF: Sampler = (i, j) => {
      const q = fromFrame(f, { x: i, y: j });
      return at(q.x, q.y);
    };
    const mapped = mapFromFrame(f, detectAxisAligned(rot, RW, RH, p, atF));
    // oblique walls must look like walls: clearly longer than thick
    const keep = mapped.walls.filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= Math.max(p.minLen, 2 * w.thickness));
    for (const w of keep) clearWall(residual, W, H, w, CLEAR_MARGIN);
    obliqueWalls.push(...keep);
    obliqueOpenings.push(...mapped.openings.filter((o) => keep.some((w) => segDist(o.center, w.a, w.b) <= w.thickness)));
    onProgress(0.25 + (0.65 * (fi + 1)) / frames.length);
  });
  if (!obliqueWalls.length) return axis;
  const walls = [...axis.walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } })), ...obliqueWalls];
  const flags = walls.map((_, i) => i >= axis.walls.length);
  const extra = joinAcrossFrames(
    walls,
    flags,
    { joinTol: p.assemble.joinTol, margin: CLEAR_MARGIN, minOpening: p.assemble.minOpening, maxOpening: p.assemble.maxOpening },
    (w, g0, g1) => classifyAlongWall(w, g0, g1, at),
  );
  return { walls, openings: [...axis.openings, ...obliqueOpenings, ...extra] };
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

interface Run {
  a0: number;
  a1: number;
  c: number;
}

const runLen = (r: Run) => r.a1 - r.a0;
const lengthJump = (a: number, b: number) => Math.abs(a - b) > 0.5 * Math.max(a, b);

/**
 * Remove diagonal strokes from a group of runs. Where a wall meets a diagonal
 * wall, the diagonal's short, steadily shifting runs end up in the same group
 * as the wall's runs; the mixed group is then either dropped (losing the wall)
 * or becomes a bogus band. The runs are split into regimes of similar length
 * (single outlier rows do not start a regime); regimes whose centre drifts
 * steadily from row to row are diagonal and are removed. Groups without such a
 * regime are returned unchanged.
 */
function withoutDiagonals(runs: Run[], minRows: number): Run[][] {
  const regimes: Run[][] = [[runs[0]]];
  let ref = runLen(runs[0]);
  for (let i = 1; i < runs.length; i++) {
    const l = runLen(runs[i]);
    if (!lengthJump(l, ref)) {
      regimes[regimes.length - 1].push(runs[i]);
      ref = l;
      continue;
    }
    // a new regime only if the following rows confirm the new length
    const next = runs.slice(i + 1, i + 3);
    if (next.length > 0 && next.every((r) => lengthJump(runLen(r), ref) && !lengthJump(runLen(r), l))) {
      regimes.push([runs[i]]);
      ref = l;
    } else regimes[regimes.length - 1].push(runs[i]);
  }
  // least-squares slope (per row) of one run end
  const slope = (rs: Run[], end: (r: Run) => number) => {
    const n = rs.length;
    const mc = rs.reduce((s, r) => s + r.c, 0) / n;
    const me = rs.reduce((s, r) => s + end(r), 0) / n;
    let num = 0;
    let den = 0;
    for (const r of rs) {
      num += (r.c - mc) * (end(r) - me);
      den += (r.c - mc) ** 2;
    }
    return den > 0 ? num / den : 0;
  };
  // diagonal: both run ends shift steadily in the same direction (a wall meeting a
  // diagonal at a mitred corner only has one shifting end)
  const drifts = (rs: Run[]) => {
    if (rs.length < minRows) return false;
    const s0 = slope(rs, (r) => r.a0);
    const s1 = slope(rs, (r) => r.a1);
    return Math.sign(s0) === Math.sign(s1) && Math.min(Math.abs(s0), Math.abs(s1)) >= 0.35;
  };
  const diagonal = regimes.map(drifts);
  if (!diagonal.some(Boolean)) return [runs];
  const parts: Run[][] = [];
  let cur: Run[] = [];
  regimes.forEach((rs, i) => {
    if (diagonal[i]) {
      if (cur.length) parts.push(cur);
      cur = [];
    } else cur.push(...rs);
  });
  if (cur.length) parts.push(cur);
  return parts;
}

/**
 * Group marked pixels into bands. The callback always receives (along, across):
 * for 'h' that is (x, y), for 'v' it is (y, x).
 */
function extractBands(
  o: 'h' | 'v',
  alongSize: number,
  acrossSize: number,
  marked: (along: number, across: number) => boolean,
  minLen: number,
  tMin: number,
  tMax: number,
): Band[] {
  interface Group {
    runs: Run[];
    lastC: number;
    a0: number;
    a1: number;
  }
  const active: Group[] = [];
  const finished: Group[] = [];
  for (let c = 0; c < acrossSize; c++) {
    const runs: { a0: number; a1: number }[] = [];
    let a = 0;
    while (a < alongSize) {
      const m = marked(a, c);
      if (!m) {
        a++;
        continue;
      }
      let e = a;
      while (e < alongSize && marked(e, c)) e++;
      if (e - a >= minLen) runs.push({ a0: a, a1: e });
      a = e;
    }
    const nextActive: Group[] = [];
    const usedGroups = new Set<Group>();
    for (const r of runs) {
      const g = active.find((g) => !usedGroups.has(g) && Math.min(g.a1, r.a1) - Math.max(g.a0, r.a0) >= 0.5 * Math.min(r.a1 - r.a0, g.a1 - g.a0));
      if (g) {
        g.runs.push({ ...r, c });
        g.lastC = c;
        g.a0 = r.a0;
        g.a1 = r.a1;
        usedGroups.add(g);
        nextActive.push(g);
      } else {
        const ng = { runs: [{ ...r, c }], lastC: c, a0: r.a0, a1: r.a1 };
        usedGroups.add(ng);
        nextActive.push(ng);
      }
    }
    for (const g of active) if (!usedGroups.has(g)) finished.push(g);
    active.length = 0;
    active.push(...nextActive);
  }
  finished.push(...active);

  const median = (xs: number[]) => {
    const s = [...xs].sort((p, q) => p - q);
    return s[Math.floor(s.length / 2)];
  };
  const groups: Run[][] = [];
  const minRows = Math.max(3, Math.ceil(tMin / 2));
  for (const g of finished) groups.push(...withoutDiagonals(g.runs, minRows));
  const bands: Band[] = [];
  for (const runs of groups) {
    const t = runs[runs.length - 1].c - runs[0].c + 1;
    if (t < tMin || t > tMax) continue;
    const a0 = median(runs.map((r) => r.a0));
    const a1 = median(runs.map((r) => r.a1));
    if (a1 - a0 < minLen) continue;
    // confidence: how consistent the run extents are
    const spread = runs.reduce((s, r) => s + Math.abs(r.a0 - a0) + Math.abs(r.a1 - a1), 0) / runs.length / Math.max(1, a1 - a0);
    bands.push({ o, a0, a1, c: (runs[0].c + runs[runs.length - 1].c) / 2, t, conf: Math.max(0.3, Math.min(0.85, 0.85 - spread * 2)) });
  }
  return bands;
}
