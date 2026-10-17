/**
 * Clipping paths of vector PDFs. CAD programs (e.g. AutoCAD layouts) export the
 * whole model behind a viewport and only clip it to the visible window – the
 * neighbouring flat or the staircase are in the file but not on the sheet. Lines
 * outside the active clip must not become walls (#214).
 */

export interface Pt {
  x: number;
  y: number;
}

/** A clip area: one or more closed subpaths, combined with the even-odd rule. */
export type ClipArea = Pt[][];

/** Even-odd test against all subpaths of a clip area. */
export function insideClip(p: Pt, area: ClipArea): boolean {
  let inside = false;
  for (const poly of area) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

/** Parameters (0…1) where segment a–b crosses an edge of the clip area. */
function crossings(a: Pt, b: Pt, area: ClipArea): number[] {
  const ts: number[] = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const poly of area) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const p = poly[j];
      const q = poly[i];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((p.x - a.x) * ey - (p.y - a.y) * ex) / den;
      const u = ((p.x - a.x) * dy - (p.y - a.y) * dx) / den;
      if (t > 1e-9 && t < 1 - 1e-9 && u >= 0 && u <= 1) ts.push(t);
    }
  }
  return ts;
}

/** Distance from p to the nearest edge of the clip area. */
function edgeDistance(p: Pt, area: ClipArea): number {
  let d = Infinity;
  for (const poly of area) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j];
      const b = poly[i];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len2 = ex * ex + ey * ey;
      const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2)) : 0;
      d = Math.min(d, Math.hypot(p.x - a.x - t * ex, p.y - a.y - t * ey));
    }
  }
  return d;
}

/**
 * The visible pieces of segment a–b inside every clip area of the stack (all areas apply at once).
 * Lines on or just outside the clip border stay (within `tol`): CAD viewports often end on or inside an outer wall.
 */
export function clipSegment(a: Pt, b: Pt, clips: readonly ClipArea[], tol = 1.5): [Pt, Pt][] {
  let pieces: [Pt, Pt][] = [[a, b]];
  for (const area of clips) {
    const next: [Pt, Pt][] = [];
    for (const [p, q] of pieces) {
      const ts = [0, ...crossings(p, q, area).sort((s, t) => s - t), 1];
      const at = (t: number) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
      let open: number | null = null; // start of the current visible run
      for (let k = 0; k + 1 < ts.length; k++) {
        if (ts[k + 1] - ts[k] < 1e-9) continue;
        const mid = at((ts[k] + ts[k + 1]) / 2);
        const inside = insideClip(mid, area) || edgeDistance(mid, area) <= tol;
        if (inside && open === null) open = ts[k];
        if (!inside && open !== null) {
          next.push([at(open), at(ts[k])]);
          open = null;
        }
      }
      if (open !== null) next.push([at(open), q]);
    }
    pieces = next;
    if (pieces.length === 0) break;
  }
  return pieces;
}
