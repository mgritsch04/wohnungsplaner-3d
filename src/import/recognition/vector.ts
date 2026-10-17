import { assembleWalls, type AssembleOptions, type Band, type GapClassifier, type GapInfo, type RecognizedOpening, type RecognizedWall } from './bands';
import { foldQuarter, insideWall, isOblique, joinAcrossFrames, makeFrame, mapFromFrame, toFrame, dirFromFrame, type Pt } from './oblique';
import type { RasterOutput } from './raster';

export interface VectorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Piece of a curve (door swing) – only ever a symbol line. */
  curve?: boolean;
}

interface VectorParams {
  tMin: number;
  tMax: number;
  minLen: number;
  angTol: number;
  assemble: AssembleOptions;
}

function vectorParams(mpp: number): VectorParams {
  return {
    tMin: 0.05 / mpp,
    tMax: 0.6 / mpp,
    minLen: 0.3 / mpp,
    angTol: Math.sin((1.5 * Math.PI) / 180),
    assemble: { mergeGap: 0.12 / mpp, minOpening: 0.5 / mpp, maxOpening: 2.6 / mpp, joinTol: 0.08 / mpp, maxThickness: 0.6 / mpp },
  };
}

type L = { a0: number; a1: number; c: number };

/**
 * Wall detector for vector PDFs: pairs of parallel lines with a wall-like
 * spacing become wall bands. Axis-aligned walls are found first; then lines in
 * other directions (e.g. 30°, 45°) are grouped by angle and detected in a
 * rotated frame. Coordinates are rendered underlay pixels.
 */
export function detectVectorWalls(
  segments: VectorSegment[],
  metersPerPixel: number,
  opts: { oblique?: boolean; /** Lines that may face a wall; the others only help to classify openings (#114). */ isWallLine?: (i: number) => boolean } = {},
): RasterOutput {
  const p = vectorParams(metersPerPixel);
  const axis = detectInFrame(segments, p, opts.isWallLine);
  if (opts.oblique === false) return { ...axis, threshold: 0 };
  return { ...detectOblique(segments, p, axis, opts.isWallLine), threshold: 0 };
}

/** Axis-aligned detection. Only segments accepted by `isWallLine` may form walls; all others count as symbols. */
function detectInFrame(segments: VectorSegment[], p: VectorParams, isWallLine?: (i: number) => boolean): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  const { tMin, tMax, minLen } = p;
  const { hs, vs, others } = splitLines(segments, p, isWallLine);

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
  return assembleWalls(bands, p.assemble, makeVectorClassifier(hs, vs, others));
}

function splitLines(segments: VectorSegment[], p: VectorParams, isWallLine?: (i: number) => boolean): { hs: L[]; vs: L[]; others: VectorSegment[] } {
  const hs: L[] = [];
  const vs: L[] = [];
  const others: VectorSegment[] = [];
  segments.forEach((s, i) => {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    if (s.curve || (isWallLine && !isWallLine(i))) others.push(s);
    else if (Math.abs(dy) / len <= p.angTol && len >= p.minLen) hs.push({ a0: Math.min(s.x1, s.x2), a1: Math.max(s.x1, s.x2), c: (s.y1 + s.y2) / 2 });
    else if (Math.abs(dx) / len <= p.angTol && len >= p.minLen) vs.push({ a0: Math.min(s.y1, s.y2), a1: Math.max(s.y1, s.y2), c: (s.x1 + s.x2) / 2 });
    else others.push(s);
  });
  return { hs, vs, others };
}

function makeVectorClassifier(hs: L[], vs: L[], others: VectorSegment[]): GapClassifier {
  // axis-aligned symbol lines (not wall faces), e.g. window frames drawn with a thinner pen
  const oh: L[] = [];
  const ov: L[] = [];
  const tol = Math.sin((1.5 * Math.PI) / 180);
  for (const s of others) {
    const dx = s.x2 - s.x1;
    const dy = s.y2 - s.y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (Math.abs(dy) / len <= tol) oh.push({ a0: Math.min(s.x1, s.x2), a1: Math.max(s.x1, s.x2), c: (s.y1 + s.y2) / 2 });
    else if (Math.abs(dx) / len <= tol) ov.push({ a0: Math.min(s.y1, s.y2), a1: Math.max(s.y1, s.y2), c: (s.x1 + s.x2) / 2 });
  }
  return (b, g0, g1) => {
    // window: lines parallel to the wall inside the gap (wall pens or thinner symbol lines)
    const inGapParallel = (l: L) => l.a0 >= g0 - 2 && l.a1 <= g1 + 2 && Math.abs(l.c - b.c) <= b.t / 2 + 1;
    const symbolParallel = (b.o === 'h' ? oh : ov).filter((l) => inGapParallel(l) && l.a1 - l.a0 > (g1 - g0) * 0.5);
    // one thin line across a gap is usually a door threshold; a window frame has two or more
    const parallel = (b.o === 'h' ? hs : vs).filter(inGapParallel).length + (symbolParallel.length >= 2 ? symbolParallel.length : 0);
    const door = doorSymbol(b, g0, g1, others);
    // a door symbol wins over frame lines: glazed balcony/patio doors are drawn like windows plus a leaf (#37)
    if (door) return door;
    if (parallel >= 1) return { kind: 'window', confidence: 0.6, note: 'Parallele Linien in der Öffnung' };
    return { kind: 'passage', confidence: 0.4, note: 'Öffnung ohne erkennbares Symbol' };
  };
}

/**
 * Door symbol at the gap g0–g1 of band b: a leaf (straight line about as long as the gap, starting
 * at one gap end and standing about square to the wall) or a swing arc around one gap end. Only these
 * make a door – hatching, labels or furniture lines next to a gap do not (#37). The hinge is the
 * gap end the symbol starts from, the swing side the side it lies on.
 */
function doorSymbol(b: Band, g0: number, g1: number, others: VectorSegment[]): GapInfo | null {
  const width = g1 - g0;
  const half = b.t / 2;
  // positions in the band frame: along the wall (a) and across it, relative to the centre line (c)
  const A = (x: number, y: number) => (b.o === 'h' ? x : y);
  const C = (x: number, y: number) => (b.o === 'h' ? y : x) - b.c;
  let best: { hinge: number; side: number; score: number } | null = null;
  for (const hinge of [g0, g1]) {
    for (const side of [1, -1]) {
      let leaf = 0;
      const arc: number[] = [];
      for (const s of others) {
        const p = { a: A(s.x1, s.y1), c: C(s.x1, s.y1) * side };
        const q = { a: A(s.x2, s.y2), c: C(s.x2, s.y2) * side };
        const len = Math.hypot(q.a - p.a, q.c - p.c);
        if (len < width * 0.08) continue;
        if (!s.curve) {
          // leaf: one end at the hinge, the other end out in the room, about one gap width away
          const [near, far] = Math.abs(p.a - hinge) + Math.abs(p.c) <= Math.abs(q.a - hinge) + Math.abs(q.c) ? [p, q] : [q, p];
          const atHinge = Math.abs(near.a - hinge) <= Math.max(0.15 * width, half) && Math.abs(near.c) <= half + 0.15 * width;
          const out = far.c >= half + 0.45 * width && far.a >= g0 - 0.3 * width && far.a <= g1 + 0.3 * width;
          // drawn open: about perpendicular to the wall (hatching at 45° is not a leaf)
          const square = Math.abs(far.a - near.a) <= 0.35 * len;
          if (atHinge && out && square && len >= 0.6 * width && len <= 1.3 * width) leaf++;
        }
        // arc: pieces at about one gap width from the hinge, running around it (not towards it)
        const r1 = Math.hypot(p.a - hinge, p.c);
        const r2 = Math.hypot(q.a - hinge, q.c);
        if (Math.min(p.c, q.c) < half * 0.5) continue;
        if (Math.min(r1, r2) < 0.7 * width || Math.max(r1, r2) > 1.3 * width) continue;
        if (Math.abs(r2 - r1) > 0.35 * len || len > 0.6 * width) continue;
        arc.push(Math.atan2(p.c, p.a - hinge), Math.atan2(q.c, q.a - hinge));
      }
      const span = arc.length >= 4 ? Math.max(...arc) - Math.min(...arc) : 0;
      const score = leaf * 2 + (span >= 0.5 ? 2 : 0);
      if (score > 0 && (!best || score > best.score)) best = { hinge, side, score };
    }
  }
  if (!best) return null;
  const along = best.hinge === g0 ? -1 : 1;
  return {
    kind: 'door',
    confidence: best.score >= 4 ? 0.7 : 0.6,
    swingSide: b.o === 'h' ? { x: 0, y: best.side } : { x: best.side, y: 0 },
    hingeSide: b.o === 'h' ? { x: along, y: 0 } : { x: 0, y: along },
    note: 'Türblatt/Türbogen an der Öffnung',
  };
}

const rotateSegment = (f: ReturnType<typeof makeFrame>, s: VectorSegment): VectorSegment => {
  const a = toFrame(f, { x: s.x1, y: s.y1 });
  const b = toFrame(f, { x: s.x2, y: s.y2 });
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(s.curve ? { curve: true } : {}) };
};

/** Classify the gap g0→g1 along an arbitrary wall direction (gaps at oblique wall ends). */
function classifyAlongWall(segments: VectorSegment[], p: VectorParams, w: RecognizedWall, g0: Pt, g1: Pt): GapInfo {
  const f = makeFrame(Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x));
  const { hs, vs, others } = splitLines(segments.map((s) => rotateSegment(f, s)), p);
  const q0 = toFrame(f, g0);
  const q1 = toFrame(f, g1);
  const a0 = Math.min(q0.x, q1.x);
  const a1 = Math.max(q0.x, q1.x);
  const band: Band = { o: 'h', a0, a1, c: toFrame(f, w.a).y, t: w.thickness, conf: w.confidence };
  const info = makeVectorClassifier(hs, vs, others)(band, a0, a1);
  return {
    ...info,
    ...(info.swingSide ? { swingSide: dirFromFrame(f, info.swingSide) } : {}),
    ...(info.hingeSide ? { hingeSide: dirFromFrame(f, info.hingeSide) } : {}),
  };
}

const MAX_FRAMES = 4;
const DEG = Math.PI / 180;

/**
 * Oblique walls: candidate lines (long enough, clearly not axis-aligned, not
 * inside an already detected wall – that excludes hatching) are clustered by
 * direction. Each cluster is detected in its own rotated frame, strongest
 * (longest line) first, so hatching inside oblique walls is excluded as well.
 */
function detectOblique(
  segments: VectorSegment[],
  p: VectorParams,
  axis: { walls: RecognizedWall[]; openings: RecognizedOpening[] },
  isWallLine?: (i: number) => boolean,
): { walls: RecognizedWall[]; openings: RecognizedOpening[] } {
  const cands: { i: number; ang: number; len: number; mid: Pt }[] = [];
  segments.forEach((s, i) => {
    if (s.curve || (isWallLine && !isWallLine(i))) return;
    const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
    if (len < p.minLen) return;
    const ang = foldQuarter(Math.atan2(s.y2 - s.y1, s.x2 - s.x1));
    if (!isOblique(ang)) return;
    cands.push({ i, ang, len, mid: { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 } });
  });
  if (cands.length < 2) return axis;
  cands.sort((a, b) => a.ang - b.ang);
  const clusters: (typeof cands)[] = [];
  for (const c of cands) {
    const cur = clusters[clusters.length - 1];
    if (cur && c.ang - cur[cur.length - 1].ang <= 0.3 * DEG && c.ang - cur[0].ang <= 1.5 * DEG) cur.push(c);
    else clusters.push([c]);
  }
  const ranked = clusters.filter((c) => c.length >= 2).sort((a, b) => Math.max(...b.map((c) => c.len)) - Math.max(...a.map((c) => c.len)));

  const detected: RecognizedWall[] = [...axis.walls];
  const obliqueWalls: RecognizedWall[] = [];
  const obliqueOpenings: RecognizedOpening[] = [];
  for (const cluster of ranked.slice(0, MAX_FRAMES)) {
    const members = new Set(cluster.filter((c) => !detected.some((w) => insideWall(c.mid, w, 1))).map((c) => c.i));
    if (members.size < 2) continue;
    const phi = cluster.reduce((s, c) => s + c.ang * c.len, 0) / cluster.reduce((s, c) => s + c.len, 0);
    const f = makeFrame(phi);
    // a slightly wider angle tolerance in the frame: members may deviate up to ±0.75° from φ
    const pf = { ...p, angTol: Math.max(p.angTol, Math.sin(2 * DEG)) };
    const mapped = mapFromFrame(f, detectInFrame(segments.map((s) => rotateSegment(f, s)), pf, (i) => members.has(i)));
    const keep = mapped.walls.filter((w) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) >= Math.max(p.minLen, 2 * w.thickness));
    detected.push(...keep);
    obliqueWalls.push(...keep);
    obliqueOpenings.push(...mapped.openings.filter((o) => keep.some((w) => insideWall(o.center, w, w.thickness / 2))));
  }
  if (!obliqueWalls.length) return axis;
  const walls = [...axis.walls.map((w) => ({ ...w, a: { ...w.a }, b: { ...w.b } })), ...obliqueWalls];
  const flags = walls.map((_, i) => i >= axis.walls.length);
  const extra = joinAcrossFrames(
    walls,
    flags,
    { joinTol: p.assemble.joinTol, margin: 0, minOpening: p.assemble.minOpening, maxOpening: p.assemble.maxOpening },
    (w, g0, g1) => classifyAlongWall(segments, p, w, g0, g1),
  );
  return { walls, openings: [...axis.openings, ...obliqueOpenings, ...extra] };
}
