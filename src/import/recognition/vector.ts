import { assembleWalls, type Band, type GapClassifier } from './bands';
import type { RasterOutput } from './raster';

export interface VectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Wall detector for vector PDFs: pairs of parallel, axis-aligned lines with a
 * wall-like spacing become wall bands. Coordinates are rendered underlay pixels.
 */
export function detectVectorWalls(segments: VectorSegment[], metersPerPixel: number): RasterOutput {
  const mpp = metersPerPixel;
  const tMin = 0.05 / mpp;
  const tMax = 0.6 / mpp;
  const minLen = 0.3 / mpp;
  const angTol = Math.sin((1.5 * Math.PI) / 180);

  type L = { a0: number; a1: number; c: number };
  const hs: L[] = [];
  const vs: L[] = [];
  const others: VectorSegment[] = [];
  for (const s of segments) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (Math.abs(dy) / len <= angTol && len >= minLen) hs.push({ a0: Math.min(s.x1, s.x2), a1: Math.max(s.x1, s.x2), c: (s.y1 + s.y2) / 2 });
    else if (Math.abs(dx) / len <= angTol && len >= minLen) vs.push({ a0: Math.min(s.y1, s.y2), a1: Math.max(s.y1, s.y2), c: (s.x1 + s.x2) / 2 });
    else others.push(s);
  }

  const pair = (lines: L[], o: 'h' | 'v'): Band[] => {
    const sorted = [...lines].sort((p, q) => p.c - q.c);
    const out: Band[] = [];
    for (let i = 0; i < sorted.length; i++) {
      const s = sorted[i];
      let best: { j: number; d: number } | null = null;
      for (let j = i + 1; j < sorted.length; j++) {
        const t = sorted[j];
        const d = t.c - s.c;
        if (d > tMax) break;
        if (d < tMin) continue;
        const overlap = Math.min(s.a1, t.a1) - Math.max(s.a0, t.a0);
        if (overlap < Math.max(minLen, 0.5 * Math.min(s.a1 - s.a0, t.a1 - t.a0))) continue;
        if (!best || d < best.d) best = { j, d };
      }
      if (best) {
        const t = sorted[best.j];
        out.push({ o, a0: Math.max(s.a0, t.a0), a1: Math.min(s.a1, t.a1), c: (s.c + t.c) / 2, t: best.d, conf: 0.7 });
      }
    }
    return out;
  };
  const bands = [...pair(hs, 'h'), ...pair(vs, 'v')];

  const classify: GapClassifier = (b, g0, g1) => {
    const inGap = (x: number, y: number, pad: number) => {
      const a = b.o === 'h' ? x : y;
      const c = b.o === 'h' ? y : x;
      return a > g0 + pad && a < g1 - pad && Math.abs(c - b.c) <= b.t / 2 + pad;
    };
    // window: lines parallel to the wall inside the gap
    const parallel = (b.o === 'h' ? hs : vs).filter((l) => l.a0 >= g0 - 2 && l.a1 <= g1 + 2 && Math.abs(l.c - b.c) <= b.t / 2 + 1).length;
    if (parallel >= 1) return { kind: 'window', confidence: 0.6, note: 'Parallele Linien in der Öffnung' };
    const width = g1 - g0;
    let plus = 0;
    let minus = 0;
    for (const s of others) {
      const mx = (s.x1 + s.x2) / 2;
      const my = (s.y1 + s.y2) / 2;
      if (inGap(mx, my, 0)) continue;
      const a = b.o === 'h' ? mx : my;
      const c = b.o === 'h' ? my : mx;
      if (a < g0 - 2 || a > g1 + 2) continue;
      const d = c - b.c;
      if (d > b.t / 2 && d < b.t / 2 + width * 1.1) plus++;
      if (-d > b.t / 2 && -d < b.t / 2 + width * 1.1) minus++;
    }
    if (plus + minus >= 3) {
      const s = plus >= minus ? 1 : -1;
      return { kind: 'door', confidence: 0.55, swingSide: b.o === 'h' ? { x: 0, y: s } : { x: s, y: 0 }, note: 'Bogen-/Schräglinien neben der Öffnung' };
    }
    return { kind: 'passage', confidence: 0.4, note: 'Öffnung ohne erkennbares Symbol' };
  };

  const res = assembleWalls(bands, { mergeGap: 0.12 / mpp, minOpening: 0.5 / mpp, maxOpening: 2.6 / mpp, joinTol: 0.08 / mpp }, classify);
  return { ...res, threshold: 0 };
}
