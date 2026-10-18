/**
 * Main colour of a product photo (#273): shops without 3D models (Möbelix) still show a photo,
 * so the planner's substitute shape gets the product's colour instead of a neutral grey.
 * Product photos usually stand on a white or light grey background, which is skipped.
 */

/** RGBA pixels → "#rrggbb" of the largest colour group, or null when the photo is (almost) only background. */
export function dominantColor(pixels: Uint8ClampedArray | number[]): string | null {
  const groups = new Map<number, { n: number; r: number; g: number; b: number }>();
  let used = 0;
  const total = pixels.length / 4;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    if (pixels[i + 3] < 128) continue; // transparent cut-out
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    if (min > 225 && max - min < 18) continue; // white / light grey studio background
    used++;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const grp = groups.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    grp.n++;
    grp.r += r;
    grp.g += g;
    grp.b += b;
    groups.set(key, grp);
  }
  if (!used || used < total * 0.03) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const grp of groups.values()) if (!best || grp.n > best.n) best = grp;
  const hex = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0');
  return `#${hex(best!.r)}${hex(best!.g)}${hex(best!.b)}`;
}

/** Decode a photo in the browser, shrunk to at most 64 px, and return its main colour. */
export async function colorOfImage(blob: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(blob);
  try {
    const k = Math.min(1, 64 / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return dominantColor(ctx.getImageData(0, 0, w, h).data);
  } finally {
    bitmap.close();
  }
}
