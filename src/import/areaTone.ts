/**
 * Paint colour "#rrggbb" (as pdf.js normalises it) → a light tone as used for room colouring?
 * Only lightness counts: walls are black/dark grey, and red (new) or other strongly coloured
 * walls in renovation plans stay wall candidates.
 */
export function isAreaTone(hex: string): boolean {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.6;
}
