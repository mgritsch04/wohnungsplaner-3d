/**
 * Plausible width/depth/height (m) for flat textile and wall items. Shops state "Länge × Breite" for
 * curtains and rugs and thickness for pictures, so a reported triple can have its axes mixed up
 * (a 140 × 250 cm curtain read as 155 × 250 × 165 cm hangs as a deep slab). Idempotent.
 */
export interface Dims3 {
  width: number;
  depth: number;
  height: number;
}

const CURTAIN_DEPTH = 0.06;
const RUG_THICKNESS = 0.02;
const FLAT_MAX = 0.1;
const round = (v: number) => Math.round(v * 1000) / 1000;

/** True when the product name says a pair/set of panels is sold ("2 Gardinenschals", "Paar", "2er-Pack"). */
export function isPanelPair(name: string): boolean {
  return /\bpaar\b|\b2\s*(?:x\s*)?(?:gardinen|vorh[äa]nge|schals?|stores?|flügel)|\b2er\b|\b2\s*st(?:ü|ue)ck\b/i.test(name);
}

export function normalizeShapeDims(shape: string | undefined, d: Dims3): Dims3 {
  if (shape === 'curtain') {
    // the longest side is the drop; the width is the stated width, or the longer remaining side if that was the drop
    const [w, dp, h] = [d.width, d.depth, d.height];
    const drop = Math.max(w, dp, h);
    let width = w;
    if (w === drop) width = Math.max(dp, h);
    return { width: round(width), depth: dp <= FLAT_MAX && h === drop ? dp : CURTAIN_DEPTH, height: round(drop) };
  }
  if (shape === 'rug') {
    const [a, b, c] = [d.width, d.depth, d.height].sort((x, y) => y - x);
    return { width: round(a), depth: round(b), height: c <= 0.05 ? round(c) : RUG_THICKNESS };
  }
  if (shape === 'picture') {
    // thickness is the smallest side
    const min = Math.min(d.width, d.depth, d.height);
    if (d.depth <= min) return d;
    return d.height === min ? { width: d.width, depth: d.height, height: d.depth } : { width: d.depth, depth: d.width, height: d.height };
  }
  return d;
}
