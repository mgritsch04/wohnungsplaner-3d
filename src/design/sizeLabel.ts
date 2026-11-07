/**
 * Claude's description of a piece names its size („Teppich 120×170“). When the solver lays a
 * bigger rug or stands a smaller piece than planned, the size in the description follows the piece
 * that really stands there (image review r7 and r10: the name said 120 × 170, the rug was 160 × 230).
 */
export function withActualSize(label: string, planned: string, actual: string, width: number, depth: number): string {
  if (planned === actual) return label;
  const w = Math.round(width * 100);
  const d = Math.round(depth * 100);
  const lo = Math.min(w, d);
  const hi = Math.max(w, d);
  return label.replace(/\b(\d{2,3})\s*[×x]\s*(\d{2,3})\b/, (_, a: string, b: string) => (Number(a) <= Number(b) ? `${lo}×${hi}` : `${hi}×${lo}`));
}
