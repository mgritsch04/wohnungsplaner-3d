/**
 * Common post-processing for wall recognition.
 *
 * Detectors (raster or vector) produce axis-aligned "bands": straight strips
 * of wall material in image pixel coordinates. This module merges bands,
 * turns gaps into opening candidates and joins wall ends at corners.
 */
export interface Band {
  /** 'h' = horizontal (along = x, across = y), 'v' = vertical (along = y, across = x). */
  o: 'h' | 'v';
  a0: number;
  a1: number;
  /** Center line position across the band. */
  c: number;
  /** Thickness across the band. */
  t: number;
  conf: number;
}

export interface GapInfo {
  kind: 'door' | 'window' | 'passage';
  confidence: number;
  /** Direction (pixel frame) towards which a door leaf swings. */
  swingSide?: { x: number; y: number };
  note?: string;
}

export type GapClassifier = (band: Band, g0: number, g1: number) => GapInfo;

export interface RecognizedWall {
  a: { x: number; y: number };
  b: { x: number; y: number };
  thickness: number;
  confidence: number;
}

export interface RecognizedOpening {
  center: { x: number; y: number };
  width: number;
  kind: 'door' | 'window' | 'passage';
  swingSide?: { x: number; y: number };
  confidence: number;
  note?: string;
}

export interface AssembleOptions {
  /** Gaps up to this length are closed silently (scan noise). */
  mergeGap: number;
  minOpening: number;
  maxOpening: number;
  /** Tolerance when snapping wall ends onto perpendicular walls. */
  joinTol: number;
  /**
   * Merged bands thicker than this are dropped: they are runs of densely packed parallel lines
   * (tiles, stairs, furniture, dimension chains) that merged into a "wall" metres thick (#114).
   */
  maxThickness?: number;
}

const lo = (b: Band) => b.c - b.t / 2;
const hi = (b: Band) => b.c + b.t / 2;

/** Merge bands of the same orientation that overlap across and along. */
export function mergeBands(bands: Band[], alongTol = 0): Band[] {
  let list = bands.map((b) => ({ ...b }));
  let changed = true;
  while (changed) {
    changed = false;
    const out: Band[] = [];
    const used = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (used[i]) continue;
      const cur = { ...list[i] };
      for (let j = i + 1; j < list.length; j++) {
        if (used[j]) continue;
        const o = list[j];
        if (o.o !== cur.o) continue;
        const acrossOverlap = Math.min(hi(cur), hi(o)) - Math.max(lo(cur), lo(o));
        const alongGap = Math.max(cur.a0, o.a0) - Math.min(cur.a1, o.a1);
        if (acrossOverlap > -0.5 && alongGap <= alongTol) {
          const nlo = Math.min(lo(cur), lo(o));
          const nhi = Math.max(hi(cur), hi(o));
          const w1 = cur.a1 - cur.a0;
          const w2 = o.a1 - o.a0;
          cur.conf = (cur.conf * w1 + o.conf * w2) / Math.max(1e-9, w1 + w2);
          cur.a0 = Math.min(cur.a0, o.a0);
          cur.a1 = Math.max(cur.a1, o.a1);
          cur.c = (nlo + nhi) / 2;
          cur.t = nhi - nlo;
          used[j] = true;
          changed = true;
        }
      }
      out.push(cur);
    }
    list = out;
  }
  return list;
}

/** Turn bands into walls + openings. Coordinates stay in the detector's pixel frame. */
export function assembleWalls(input: Band[], opts: AssembleOptions, classify: GapClassifier): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  const openings: RecognizedOpening[] = [];
  const pointOf = (o: 'h' | 'v', along: number, c: number) => (o === 'h' ? { x: along, y: c } : { x: c, y: along });

  // 1. merge collinear bands across small gaps and opening-sized gaps
  let bands = mergeBands(input, opts.mergeGap);
  if (opts.maxThickness !== undefined) bands = bands.filter((b) => b.t <= opts.maxThickness!);
  const merged: Band[] = [];
  for (const o of ['h', 'v'] as const) {
    // along the wall first: collinear pieces whose centre lines differ by rounding noise
    // (common in PDF coordinates) must still be chained from left to right
    const list = bands.filter((b) => b.o === o).sort((a, b) => a.a0 - b.a0 || a.c - b.c);
    const done = new Array(list.length).fill(false);
    for (let i = 0; i < list.length; i++) {
      if (done[i]) continue;
      let cur = { ...list[i] };
      done[i] = true;
      let progress = true;
      while (progress) {
        progress = false;
        let bestJ = -1;
        let bestGap = Infinity;
        for (let j = 0; j < list.length; j++) {
          if (done[j]) continue;
          const n = list[j];
          if (Math.abs(n.c - cur.c) > Math.max(cur.t, n.t) * 0.5) continue;
          if (Math.abs(n.t - cur.t) > Math.max(cur.t, n.t) * 0.6) continue;
          const gap = n.a0 - cur.a1;
          if (gap >= -1 && gap <= opts.maxOpening && gap < bestGap) {
            bestGap = gap;
            bestJ = j;
          }
        }
        if (bestJ >= 0) {
          const n = list[bestJ];
          const gap = n.a0 - cur.a1;
          if (gap >= opts.minOpening) {
            const info = classify(cur, cur.a1, n.a0);
            openings.push({ center: pointOf(o, (cur.a1 + n.a0) / 2, (cur.c + n.c) / 2), width: gap, ...info });
          }
          const wsum = cur.a1 - cur.a0 + (n.a1 - n.a0);
          cur = {
            o,
            a0: cur.a0,
            a1: Math.max(cur.a1, n.a1),
            c: (cur.c * (cur.a1 - cur.a0) + n.c * (n.a1 - n.a0)) / wsum,
            t: (cur.t * (cur.a1 - cur.a0) + n.t * (n.a1 - n.a0)) / wsum,
            conf: Math.min(cur.conf, n.conf),
          };
          done[bestJ] = true;
          progress = true;
        }
      }
      merged.push(cur);
    }
  }
  bands = merged;

  // 2. join ends onto perpendicular bands (corners and T-junctions)
  const result = bands.map((b) => ({ ...b }));
  for (const b of result) {
    const perps = bands.filter((p) => p.o !== b.o && p.a0 - p.t / 2 - opts.joinTol <= b.c && p.a1 + p.t / 2 + opts.joinTol >= b.c);
    for (const end of ['a0', 'a1'] as const) {
      const pos = b[end];
      let best: { p: Band; d: number } | null = null;
      for (const p of perps) {
        // distance from this end to the near face of p
        const d = end === 'a1' ? lo(p) - pos : pos - hi(p);
        const inside = pos >= lo(p) - opts.joinTol && pos <= hi(p) + opts.joinTol;
        const dd = inside ? 0 : d;
        if (dd >= -opts.joinTol && dd <= opts.joinTol && (!best || Math.abs(dd) < best.d)) best = { p, d: Math.abs(dd) };
      }
      if (best) {
        b[end] = best.p.c;
        continue;
      }
      // opening between the wall end and a perpendicular wall (e.g. a door next to a corner)
      let bestOpen: { p: Band; gap: number } | null = null;
      for (const p of perps) {
        const gap = end === 'a1' ? lo(p) - pos : pos - hi(p);
        if (gap >= opts.minOpening && gap <= opts.maxOpening && (!bestOpen || gap < bestOpen.gap)) bestOpen = { p, gap };
      }
      if (bestOpen) {
        const g0 = end === 'a1' ? pos : hi(bestOpen.p);
        const g1 = end === 'a1' ? lo(bestOpen.p) : pos;
        const info = classify(b, g0, g1);
        openings.push({ center: pointOf(b.o, (g0 + g1) / 2, b.c), width: g1 - g0, ...info, confidence: info.confidence * 0.8 });
        b[end] = bestOpen.p.c;
      }
    }
  }

  const walls = result
    .filter((b) => b.a1 - b.a0 > b.t * 0.8)
    .map((b) => ({ a: pointOf(b.o, b.a0, b.c), b: pointOf(b.o, b.a1, b.c), thickness: b.t, confidence: b.conf }));
  return { walls, openings };
}
