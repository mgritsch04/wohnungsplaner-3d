/**
 * Main colour of a product photo (#273): shops without 3D models (Möbelix) still show a photo,
 * so the planner's substitute shape gets the product's colour instead of a neutral grey.
 * Product photos usually stand on a white or light grey background, which is skipped.
 */

/** RGBA pixels → "#rrggbb" of the largest colour group, or null when the photo is (almost) only background. */
export function dominantColor(pixels: Uint8ClampedArray | number[], keepLight = false): string | null {
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
    if (!keepLight && min > 225 && max - min < 18) continue; // white / light grey studio background
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

/** Main and frame colour of a product photo (#273): upper part (table top, body, cushions) and lower part (legs, base). */
export interface ProductColors {
  main: string;
  /** set only when the lower part clearly differs from the main colour */
  secondary?: string;
}

/**
 * The product's colours from RGBA pixels of a (small) photo. The studio background is removed
 * where it is connected to the image border and close to the corner colour (or practically
 * identical to it, e.g. seen through a frame), so an off-white table top inside the product stays. The upper 40 % of the product gives the main colour,
 * the lower 45 % the colour of legs or base.
 */
export function productColors(pixels: Uint8ClampedArray | number[], w: number, h: number): ProductColors | null {
  if (w * h * 4 > pixels.length || w < 2 || h < 2) return null;
  const at = (i: number) => [pixels[i * 4], pixels[i * 4 + 1], pixels[i * 4 + 2], pixels[i * 4 + 3]];
  const corners = [0, w - 1, (h - 1) * w, h * w - 1].map(at);
  const bg = [0, 1, 2].map((c) => corners.map((p) => p[c]).sort((a, b) => a - b)[1]); // robust against one odd corner
  const bgDist = (i: number) => {
    const [r, g, b] = at(i);
    return Math.max(Math.abs(r - bg[0]), Math.abs(g - bg[1]), Math.abs(b - bg[2]));
  };
  const isBg = (i: number) => at(i)[3] < 128 || bgDist(i) < 18;
  // flood fill from the border
  const back = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    if (back[i] || !isBg(i)) continue;
    back[i] = 1;
    const x = i % w;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (i >= w) stack.push(i - w);
    if (i < w * (h - 1)) stack.push(i + w);
  }
  let top = h;
  let bottom = -1;
  let count = 0;
  // background seen through a frame (between sled legs) is enclosed, but practically identical to it
  for (let i = 0; i < w * h; i++) if (!back[i] && bgDist(i) < 8) back[i] = 1;
  for (let i = 0; i < w * h; i++)
    if (!back[i] && at(i)[3] >= 128) {
      const y = Math.floor(i / w);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
      count++;
    }
  if (count < w * h * 0.03) return null;
  const span = bottom - top + 1;
  const region = (from: number, to: number) => {
    const px: number[] = [];
    for (let y = Math.max(top, Math.floor(top + from * span)); y <= Math.min(bottom, Math.ceil(top + to * span) - 1); y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!back[i]) px.push(...at(i));
      }
    return px;
  };
  // keepLight: inside the product, light pixels are real (a white top)
  const main = dominantColor(region(0, 0.4), true) ?? dominantColor(region(0, 1), true);
  if (!main) return null;
  const secondary = dominantColor(region(0.55, 1), true);
  return secondary && colorDistance(main, secondary) > 60 ? { main, secondary } : { main };
}

function colorDistance(a: string, b: string): number {
  const v = (s: string) => [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16));
  const [x, y] = [v(a), v(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/** Decode a photo in the browser, shrunk to at most 64 px, and return its main and frame colour. */
export async function colorsOfImage(blob: Blob): Promise<ProductColors | null> {
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
    return productColors(ctx.getImageData(0, 0, w, h).data, w, h);
  } finally {
    bitmap.close();
  }
}
