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
  /** Direction (pixel frame) along the wall from the opening centre towards the door hinge. */
  hingeSide?: { x: number; y: number };
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
  hingeSide?: { x: number; y: number };
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
   * Merging also never grows a band past this, and a band only grows thicker from a band beside
   * it that runs along most of its length – so a thin partition wall ending at a hatched pillar
   * is not swallowed by the pillar's stacked lines.
   */
  maxThickness?: number;
  /**
   * Gaps wider than this without a door or window symbol are no openings: the walls simply end
   * there (an open corridor, #37). Omitted = every gap up to maxOpening becomes an opening.
   */
  maxPassage?: number;
}

const lo = (b: Band) => b.c - b.t / 2;
const hi = (b: Band) => b.c + b.t / 2;
const acrossOverlap = (b: Band, q: Band) => Math.min(hi(b), hi(q)) - Math.max(lo(b), lo(q));
const overlapAlong = (q: Band, g0: number, g1: number) => Math.max(0, Math.min(q.a1, g1) - Math.max(q.a0, g0));

/** Parallel band q touches band b across and lies beside b's end at `pos` or along most of the gap g0–g1. */
function alongside(b: Band, q: Band, pos: number, g0: number, g1: number, tol: number): boolean {
  if (acrossOverlap(b, q) <= -1) return false;
  return (q.a0 - 2 * tol <= pos && q.a1 + 2 * tol >= pos) || overlapAlong(q, g0, g1) >= 0.5 * (g1 - g0);
}

/** Merge bands of the same orientation that overlap across and along. */
export function mergeBands(bands: Band[], alongTol = 0, maxThickness?: number): Band[] {
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
          if (maxThickness !== undefined) {
            if (nhi - nlo > maxThickness) continue;
            const grows = nhi - nlo > Math.max(cur.t, o.t) + 0.5;
            if (grows && -alongGap < 0.5 * Math.max(cur.a1 - cur.a0, o.a1 - o.a0)) continue;
          }
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
  const opening = (kind: GapInfo['kind'], gap: number) => kind !== 'passage' || opts.maxPassage === undefined || gap <= opts.maxPassage;
  const pointOf = (o: 'h' | 'v', along: number, c: number) => (o === 'h' ? { x: along, y: c } : { x: c, y: along });

  // 1. merge collinear bands across small gaps and opening-sized gaps
  let bands = mergeBands(input, opts.mergeGap, opts.maxThickness);
  if (opts.maxThickness !== undefined) bands = bands.filter((b) => b.t <= opts.maxThickness!);
  const merged: Band[] = [];
  const blocks: Band[] = [];
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
          // a much thicker stubby piece in line with a wall (a shaft or pre-wall block beside the wall, #37):
          // the wall runs on through it, and the block stays a wall of its own as well
          const [thin, block] = cur.t < n.t ? [cur, n] : [n, cur];
          if (gap < opts.minOpening && block.t > 1.5 * thin.t && block.a1 - block.a0 <= 4 * block.t) blocks.push({ ...block });
          if (gap >= opts.minOpening) {
            const info = classify(cur, cur.a1, n.a0);
            if (!opening(info.kind, gap)) break;
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
  bands = [...merged, ...blocks];

  // 2. join ends onto perpendicular bands (corners and T-junctions)
  const result = bands.map((b) => ({ ...b }));
  const extend: { q: Band; at: number }[] = [];
  // bands with a wall joined to them or joined to another wall (unconnected ones may be dropped below)
  const connected = new Set<Band>();
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
        // a short way off still closes: such a small gap is no opening (#37)
        if (dd >= -opts.joinTol && dd <= 2 * opts.joinTol && (!best || Math.abs(dd) < best.d)) best = { p, d: Math.abs(dd) };
      }
      if (best) {
        b[end] = best.p.c;
        connected.add(b).add(result[bands.indexOf(best.p)]);
        continue;
      }
      // opening between the wall end and a perpendicular wall (e.g. a door next to a corner);
      // the wall may meet the perpendicular one near its end, where a thicker outer wall turns
      // the corner (a partition offset from the outer wall's centre line, #214)
      const reach = opts.joinTol + b.t;
      const perpsOpen = bands.filter((p) => p.o !== b.o && p.a0 - p.t / 2 - reach <= b.c && p.a1 + p.t / 2 + reach >= b.c);
      let bestOpen: { p: Band; gap: number } | null = null;
      for (const p of perpsOpen) {
        const gap = end === 'a1' ? lo(p) - pos : pos - hi(p);
        if (gap >= opts.minOpening && gap <= opts.maxOpening && (!bestOpen || gap < bestOpen.gap)) bestOpen = { p, gap };
      }
      if (bestOpen) {
        const g0 = end === 'a1' ? pos : hi(bestOpen.p);
        const g1 = end === 'a1' ? lo(bestOpen.p) : pos;
        // a parallel wall beside this end (a shaft, a wall layer, #37): no opening through it; a thin
        // wall runs on through a much thicker block, otherwise it ends here
        const beside = bands.find((q) => q !== bands[result.indexOf(b)] && q.o === b.o && alongside(b, q, pos, g0, g1, opts.joinTol));
        if (beside) {
          if (beside.t > 1.5 * b.t) {
            // through the block: meet a perpendicular wall at its far end, or the wall across the gap
            const far = end === 'a1' ? beside.a1 : beside.a0;
            const reachP = opts.joinTol + beside.t;
            const p = bands.find((p) => p.o !== b.o && p.a0 - p.t / 2 - reachP <= b.c && p.a1 + p.t / 2 + reachP >= b.c && far >= lo(p) - opts.joinTol && far <= hi(p) + opts.joinTol);
            const to = p ?? (overlapAlong(beside, g0, g1) >= 0.5 * (g1 - g0) ? bestOpen.p : undefined);
            if (to) {
              b[end] = to.c;
              const q = result[bands.indexOf(to)];
              connected.add(b).add(q);
              // the perpendicular wall reaches through the block as well
              if (p) extend.push({ q, at: b.c });
            }
          }
          continue;
        }
        const info = classify(b, g0, g1);
        if (!opening(info.kind, g1 - g0)) continue;
        openings.push({ center: pointOf(b.o, (g0 + g1) / 2, b.c), width: g1 - g0, ...info, confidence: info.confidence * 0.8 });
        b[end] = bestOpen.p.c;
        connected.add(b).add(result[bands.indexOf(bestOpen.p)]);
        // reaching past the perpendicular wall's end: lengthen it (below, once all ends are
        // joined), so both walls meet in one corner
        extend.push({ q: result[bands.indexOf(bestOpen.p)], at: b.c });
      }
    }
  }

  for (const { q, at } of extend) {
    q.a0 = Math.min(q.a0, at);
    q.a1 = Math.max(q.a1, at);
  }

  // 3. a wall that only lies against a parallel wall at least as thick, joined to nothing, is a
  // second line of that wall (the face of a neighbouring shaft, a lining) – no wall of its own (#37)
  const doubled = (b: Band) =>
    !connected.has(b) &&
    result.some((q) => q !== b && q.o === b.o && q.t >= b.t && acrossOverlap(b, q) > -1 && q.a0 - opts.joinTol <= b.a0 && q.a1 + opts.joinTol >= b.a1);
  const walls = result
    .filter((b) => b.a1 - b.a0 > b.t * 0.8 && !doubled(b))
    .map((b) => ({ a: pointOf(b.o, b.a0, b.c), b: pointOf(b.o, b.a1, b.c), thickness: b.t, confidence: b.conf }));
  return { walls, openings };
}
