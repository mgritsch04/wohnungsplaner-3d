import { PHOTO_MAX_CHARS, PHOTO_MAX_SIDE } from './own';

/** Largest crop of a `w:h` picture inside an image of `iw × ih` pixels, centred (source rectangle). */
export function coverCrop(iw: number, ih: number, w: number, h: number): { sx: number; sy: number; sw: number; sh: number } {
  const target = w / h;
  const have = iw / ih;
  if (have > target) {
    const sw = ih * target;
    return { sx: (iw - sw) / 2, sy: 0, sw, sh: ih };
  }
  const sh = iw / target;
  return { sx: 0, sy: (ih - sh) / 2, sw: iw, sh };
}

/**
 * The picture file as a small JPEG (data URL) cropped to the proportions of the picture, so it fits
 * the stored text limit; stays on this computer (it only travels with the project file).
 */
export async function imageToPictureTexture(file: Blob, w: number, h: number): Promise<string> {
  const bmp = await createImageBitmap(file);
  try {
    const crop = coverCrop(bmp.width, bmp.height, w, h);
    const longest = Math.max(w, h);
    let side = PHOTO_MAX_SIDE;
    for (let attempt = 0; attempt < 6; attempt++) {
      const cw = Math.max(16, Math.round((w / longest) * side));
      const ch = Math.max(16, Math.round((h / longest) * side));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Das Bild konnte nicht verkleinert werden.');
      ctx.drawImage(bmp, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cw, ch);
      for (const q of [0.85, 0.7, 0.55]) {
        const url = canvas.toDataURL('image/jpeg', q);
        if (url.length <= PHOTO_MAX_CHARS) return url;
      }
      side = Math.round(side * 0.75);
    }
    throw new Error('Das Bild ist zu detailreich, um es im Projekt zu speichern – bitte ein einfacheres Bild wählen.');
  } finally {
    bmp.close();
  }
}
