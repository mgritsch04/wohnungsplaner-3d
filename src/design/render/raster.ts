/**
 * The room image as PNG for Claude (#442): Claude looks at PNG, an SVG would arrive as text.
 * Drawn in the browser through an image and a canvas, like the plan export (`exportPng.tsx`).
 */

export interface RoomImage {
  mediaType: 'image/png';
  /** Base64 without the `data:` prefix. */
  data: string;
  width: number;
  height: number;
}

/** Longer side of the PNG at most (px): Claude scales larger images down anyway. */
export const MAX_IMAGE_PX = 1568;

export async function svgToPng(plan: { svg: string; width: number; height: number }, opts: { maxPx?: number; timeoutMs?: number } = {}): Promise<RoomImage> {
  if (typeof document === 'undefined' || typeof Image === 'undefined' || typeof URL.createObjectURL !== 'function') throw new Error('Das Raumbild lässt sich nur im Browser zeichnen.');
  const k = Math.min(1, (opts.maxPx ?? MAX_IMAGE_PX) / Math.max(plan.width, plan.height));
  const width = Math.max(1, Math.round(plan.width * k));
  const height = Math.max(1, Math.round(plan.height * k));
  const url = URL.createObjectURL(new Blob([plan.svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      const timer = setTimeout(() => reject(new Error('Das Raumbild wurde nicht rechtzeitig gezeichnet.')), opts.timeoutMs ?? 5000);
      im.onload = () => {
        clearTimeout(timer);
        resolve(im);
      };
      im.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Das Raumbild konnte nicht gezeichnet werden.'));
      };
      im.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Zeichenfläche nicht verfügbar.');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, width, height);
    g.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/png');
    return { mediaType: 'image/png', data: dataUrl.slice(dataUrl.indexOf(',') + 1), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
