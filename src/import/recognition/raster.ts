import { assembleWalls, type Band, type GapClassifier } from './bands';

/**
 * Raster wall detector for scanned/bitmap floor plans.
 * Finds thick, dark, axis-aligned strokes (typical for filled walls) and their
 * gaps (door/window candidates). Diagonal walls and walls drawn only as thin
 * double outlines are NOT detected. Pure function – runs in a Web Worker.
 */
export interface RasterInput {
  width: number;
  height: number;
  /** Grayscale 0..255, row-major. */
  gray: Uint8ClampedArray | Uint8Array;
  /** Meters per pixel of this (possibly downscaled) image. */
  metersPerPixel: number;
}

export interface RasterOutput {
  walls: { a: { x: number; y: number }; b: { x: number; y: number }; thickness: number; confidence: number }[];
  openings: { center: { x: number; y: number }; width: number; kind: 'door' | 'window' | 'passage'; swingSide?: { x: number; y: number }; confidence: number; note?: string }[];
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

export function detectRasterWalls(input: RasterInput, onProgress?: (p: number) => void): RasterOutput {
  const { width: W, height: H, gray, metersPerPixel: mpp } = input;
  const threshold = Math.min(170, otsuThreshold(gray));
  const dark = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) dark[i] = gray[i] <= threshold ? 1 : 0;
  onProgress?.(0.15);

  const tMin = Math.max(2, Math.round(0.05 / mpp));
  const tMax = Math.max(tMin + 1, Math.round(0.6 / mpp));
  const minLen = Math.max(tMin * 2, Math.round(0.35 / mpp));

  // run lengths
  const vr = new Uint16Array(W * H);
  const hr = new Uint16Array(W * H);
  for (let x = 0; x < W; x++) {
    let y = 0;
    while (y < H) {
      if (!dark[y * W + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < H && dark[e * W + x]) e++;
      const len = Math.min(65535, e - y);
      for (let k = y; k < e; k++) vr[k * W + x] = len;
      y = e;
    }
  }
  for (let y = 0; y < H; y++) {
    let x = 0;
    const row = y * W;
    while (x < W) {
      if (!dark[row + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < W && dark[row + e]) e++;
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
    return dark[i] === 1 && vr[i] >= tMin && vr[i] <= tMax && hr[i] >= minLen;
  }, minLen, tMin, tMax));
  onProgress?.(0.6);
  bands.push(...extractBands('v', H, W, (a, c) => {
    const i = a * W + c;
    return dark[i] === 1 && hr[i] >= tMin && hr[i] <= tMax && vr[i] >= minLen;
  }, minLen, tMin, tMax));
  onProgress?.(0.75);

  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? dark[Math.floor(y) * W + Math.floor(x)] : 0);
  const classify: GapClassifier = (b, g0, g1) => {
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

  const res = assembleWalls(
    bands,
    {
      mergeGap: Math.round(0.12 / mpp),
      minOpening: Math.round(0.5 / mpp),
      maxOpening: Math.round(2.6 / mpp),
      joinTol: Math.max(3, Math.round(0.08 / mpp)),
    },
    classify,
  );
  onProgress?.(1);
  return { ...res, threshold };
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
    runs: { a0: number; a1: number; c: number }[];
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
  const bands: Band[] = [];
  for (const g of finished) {
    const t = g.runs[g.runs.length - 1].c - g.runs[0].c + 1;
    if (t < tMin || t > tMax) continue;
    const a0 = median(g.runs.map((r) => r.a0));
    const a1 = median(g.runs.map((r) => r.a1));
    if (a1 - a0 < minLen) continue;
    // confidence: how consistent the run extents are
    const spread = g.runs.reduce((s, r) => s + Math.abs(r.a0 - a0) + Math.abs(r.a1 - a1), 0) / g.runs.length / Math.max(1, a1 - a0);
    bands.push({ o, a0, a1, c: (g.runs[0].c + g.runs[g.runs.length - 1].c) / 2, t, conf: Math.max(0.3, Math.min(0.85, 0.85 - spread * 2)) });
  }
  return bands;
}
