/**
 * Plausibility check of the plan scale with dimension texts of a vector PDF.
 *
 * A dimension text ("3,50", "350", "3,51⁵") is paired with the dimension line
 * it sits on (parallel line right next to the text) and the two ticks/extension
 * lines around it. The real value is compared with the measured span on the
 * current scale. The result is only shown to the user (warning on deviation);
 * it never changes the scale by itself.
 */

export interface PlanText {
  str: string;
  /** Text origin (baseline start) in rendered underlay pixels. */
  x: number;
  y: number;
  /** Unit reading direction in pixels (y down). */
  dir?: { x: number; y: number };
  /** Advance width along `dir` in pixels. */
  width?: number;
  /** Font height in pixels. */
  height?: number;
}

export interface LineSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface DimensionMatch {
  text: string;
  /** Stated value in metres. */
  value: number;
  /** Measured span between the ticks in pixels. */
  spanPx: number;
  /** Centre of the measured span (pixels). */
  center: { x: number; y: number };
}

export interface ScaleCheck {
  status: 'none' | 'ok' | 'mismatch' | 'unclear';
  matches: DimensionMatch[];
  /** The dimensions that agree with each other (basis of the result). */
  consistent: DimensionMatch[];
  /** Relative deviation of the current scale: (measured − stated) / stated, median of the consistent dimensions. */
  deviation: number | null;
}

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/**
 * Parse a dimension text: "3,50"/"3.50" (metres), "3,51⁵" (metres + mm),
 * "350" (centimetres), "88⁵" (centimetres + half/mm). Returns metres or null.
 */
export function parseDimensionText(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d{1,2})[.,](\d{2})([⁰¹²³⁴⁵⁶⁷⁸⁹])?$/.exec(s);
  if (m) {
    const v = parseInt(m[1], 10) + parseInt(m[2], 10) / 100 + (m[3] ? SUPERSCRIPT.indexOf(m[3]) / 1000 : 0);
    return v >= 0.2 ? v : null;
  }
  m = /^(\d{2,4})([⁰¹²³⁴⁵⁶⁷⁸⁹])?$/.exec(s);
  if (m) {
    const cm = parseInt(m[1], 10) + (m[2] ? SUPERSCRIPT.indexOf(m[2]) / 10 : 0);
    return cm >= 20 && cm <= 3000 ? cm / 100 : null;
  }
  return null;
}

const PARALLEL = Math.sin((2 * Math.PI) / 180);
const CROSSING = Math.sin((20 * Math.PI) / 180);

interface Seg {
  s: LineSegment;
  len: number;
  ux: number;
  uy: number;
}

/** Uniform grid over segment bounding boxes – CAD PDFs can contain 100 000+ segments. */
function segmentGrid(segs: Seg[], cell: number) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const g of segs) {
    minX = Math.min(minX, g.s.x1, g.s.x2);
    minY = Math.min(minY, g.s.y1, g.s.y2);
    maxX = Math.max(maxX, g.s.x1, g.s.x2);
    maxY = Math.max(maxY, g.s.y1, g.s.y2);
  }
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const ny = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - minX) / cell)));
  const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - minY) / cell)));
  const cells = new Map<number, number[]>();
  segs.forEach((g, i) => {
    for (let y = cy(Math.min(g.s.y1, g.s.y2)); y <= cy(Math.max(g.s.y1, g.s.y2)); y++) {
      for (let x = cx(Math.min(g.s.x1, g.s.x2)); x <= cx(Math.max(g.s.x1, g.s.x2)); x++) {
        const k = y * nx + x;
        const list = cells.get(k);
        if (list) list.push(i);
        else cells.set(k, [i]);
      }
    }
  });
  const stamp = new Int32Array(segs.length);
  let round = 0;
  /** Segments whose bounding box may overlap the given box. */
  return (x0: number, y0: number, x1: number, y1: number): Seg[] => {
    round++;
    const out: Seg[] = [];
    if (x1 < minX || y1 < minY || x0 > maxX || y0 > maxY) return out;
    for (let y = cy(y0); y <= cy(y1); y++) {
      for (let x = cx(x0); x <= cx(x1); x++) {
        for (const i of cells.get(y * nx + x) ?? []) {
          if (stamp[i] === round) continue;
          stamp[i] = round;
          out.push(segs[i]);
        }
      }
    }
    return out;
  };
}

/** Pair dimension texts with their dimension line and ticks. */
export function matchDimensions(texts: PlanText[], segments: LineSegment[]): DimensionMatch[] {
  const candidates = texts.filter((t) => t.dir && t.height && parseDimensionText(t.str) !== null);
  if (candidates.length === 0) return [];
  const segs: Seg[] = segments
    .map((s) => {
      const dx = s.x2 - s.x1;
      const dy = s.y2 - s.y1;
      const len = Math.hypot(dx, dy);
      return { s, len, ux: dx / len, uy: dy / len };
    })
    .filter((g) => g.len > 1e-6);
  const heights = candidates.map((t) => t.height!).sort((a, b) => a - b);
  const query = segmentGrid(segs, Math.max(8, heights[Math.floor(heights.length / 2)] * 4));
  const out: DimensionMatch[] = [];
  for (const t of candidates) {
    const value = parseDimensionText(t.str)!;
    const d = t.dir!;
    const h = t.height!;
    const w = t.width && t.width > 0 ? t.width : t.str.length * 0.55 * h;
    const up = { x: d.y, y: -d.x }; // screen "up" of the text (y points down)
    const C = { x: t.x + (d.x * w) / 2, y: t.y + (d.y * w) / 2 }; // baseline centre
    // the dimension line: parallel, right next to the baseline, running past the text
    let line: Seg | null = null;
    let lineOff = Infinity;
    const r = 1.6 * h;
    for (const g of query(C.x - r, C.y - r, C.x + r, C.y + r)) {
      if (Math.abs(g.ux * d.y - g.uy * d.x) > PARALLEL || g.len < w) continue;
      const off = (g.s.x1 - C.x) * up.x + (g.s.y1 - C.y) * up.y;
      if (Math.abs(off) > 1.5 * h) continue;
      const along = (C.x - g.s.x1) * g.ux + (C.y - g.s.y1) * g.uy;
      if (along < 0 || along > g.len) continue;
      if (Math.abs(off) < Math.abs(lineOff)) {
        line = g;
        lineOff = off;
      }
    }
    if (!line) continue;
    const L = line;
    const uC = (C.x - L.s.x1) * L.ux + (C.y - L.s.y1) * L.uy;
    // ticks: the line's own ends and all lines crossing (or touching) it
    const ticks: number[] = [0, L.len];
    const tol = 0.6 * h;
    const near = query(Math.min(L.s.x1, L.s.x2) - tol, Math.min(L.s.y1, L.s.y2) - tol, Math.max(L.s.x1, L.s.x2) + tol, Math.max(L.s.y1, L.s.y2) + tol);
    for (const g of near) {
      if (g === L) continue;
      const cr = L.ux * g.uy - L.uy * g.ux;
      if (Math.abs(cr) < CROSSING) continue;
      // L.s1 + a·uL = g.s1 + b·ug
      const qx = g.s.x1 - L.s.x1;
      const qy = g.s.y1 - L.s.y1;
      const a = (qx * g.uy - qy * g.ux) / cr;
      const b = (qx * L.uy - qy * L.ux) / cr;
      if (b < -tol || b > g.len + tol || a < -tol || a > L.len + tol) continue;
      ticks.push(a);
    }
    const half = 0.4 * w;
    if (ticks.some((a) => a > uC - half && a < uC + half)) continue; // a line through the text: ambiguous
    const lo = Math.max(...ticks.filter((a) => a <= uC - half));
    const hi = Math.min(...ticks.filter((a) => a >= uC + half));
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < w) continue;
    const mid = (lo + hi) / 2;
    out.push({ text: t.str, value, spanPx: hi - lo, center: { x: L.s.x1 + L.ux * mid, y: L.s.y1 + L.uy * mid } });
  }
  return out;
}

/**
 * Compare matched dimensions with the current scale. At least two dimensions
 * (and at least half of all matches) must agree within ±2 % with each other,
 * otherwise the result is "unclear". Within ±2 % of the scale → ok.
 */
export function checkScale(matches: DimensionMatch[], metersPerPixel: number, tolerance = 0.02): ScaleCheck {
  if (matches.length === 0) return { status: 'none', matches, consistent: [], deviation: null };
  const items = matches.map((m) => ({ m, r: Math.log((m.spanPx * metersPerPixel) / m.value) })).sort((a, b) => a.r - b.r);
  let best: typeof items = [];
  for (let i = 0; i < items.length; i++) {
    const group = items.filter((x) => x.r >= items[i].r && x.r <= items[i].r + 2 * Math.log(1 + tolerance));
    if (group.length > best.length) best = group;
  }
  const consistent = best.map((x) => x.m);
  if (best.length < 2 || best.length < Math.ceil(matches.length / 2)) return { status: 'unclear', matches, consistent, deviation: null };
  const deviation = Math.exp(best[Math.floor(best.length / 2)].r) - 1;
  return { status: Math.abs(deviation) <= tolerance ? 'ok' : 'mismatch', matches, consistent, deviation };
}

/** Short German message for the import panel / review, or null if there is nothing to report. */
export function scaleCheckMessage(c: ScaleCheck): string | null {
  const n = c.consistent.length;
  if (c.status === 'ok') return `Maßtexte im PDF passen zum Maßstab (${n} Maße, Abweichung ${formatPercent(c.deviation!)}).`;
  if (c.status === 'mismatch') {
    const ex = c.consistent[0];
    return `Maßtexte im PDF passen nicht zum Maßstab: Abweichung ${formatPercent(c.deviation!)} (${n} Maße, z. B. „${ex.text}“). Bitte die Kalibrierung prüfen – der Maßstab wird nicht automatisch geändert.`;
  }
  if (c.status === 'unclear') return `Maßtexte im PDF sind nicht eindeutig zuordenbar (${c.matches.length} gefunden) – keine Aussage zum Maßstab.`;
  return null;
}

function formatPercent(v: number): string {
  const p = v * 100;
  return `${p >= 0 ? '+' : '−'}${Math.abs(p).toFixed(1).replace('.', ',')} %`;
}
