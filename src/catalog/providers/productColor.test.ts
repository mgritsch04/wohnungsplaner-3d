import { describe, expect, it } from 'vitest';
import { dominantColor, productColors } from './productColor';

/** RGBA pixels: `n` copies of each colour */
const pixels = (...parts: [number, [number, number, number, number?]][]) =>
  new Uint8ClampedArray(parts.flatMap(([n, [r, g, b, a = 255]]) => Array.from({ length: n }, () => [r, g, b, a]).flat()));

describe('Hauptfarbe eines Produktfotos (#273)', () => {
  it('nimmt die häufigste Farbe und übergeht den hellen Hintergrund', () => {
    const c = dominantColor(pixels([700, [250, 250, 250]], [200, [140, 90, 43]], [100, [30, 30, 30]]));
    expect(c).toBe('#8c5a2b');
  });

  it('übergeht durchsichtige Pixel', () => {
    expect(dominantColor(pixels([500, [255, 0, 0, 0]], [100, [20, 60, 120]]))).toBe('#143c78');
  });

  it('meldet nichts, wenn fast nur Hintergrund da ist', () => {
    expect(dominantColor(pixels([990, [255, 255, 255]], [10, [0, 0, 0]]))).toBeNull();
  });
});

/** w×h image: background everywhere, then filled rectangles [x0,y0,x1,y1,rgb] */
function image(w: number, h: number, bg: [number, number, number], rects: [number, number, number, number, [number, number, number]][]) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const r = rects.find(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1);
      px.set([...(r ? r[4] : bg), 255], (y * w + x) * 4);
    }
  return px;
}

describe('Platte und Gestell getrennt (#273)', () => {
  // SYNTHETIC table photo: light oak top, black metal legs, white studio background
  const table = image(40, 40, [255, 255, 255], [
    [4, 8, 36, 13, [205, 170, 125]],
    [6, 13, 9, 34, [30, 30, 30]],
    [31, 13, 34, 34, [30, 30, 30]],
    [6, 30, 34, 34, [30, 30, 30]],
  ]);

  it('Platte oben, Beine unten – auch wenn die Beine mehr Fläche haben', () => {
    expect(productColors(table, 40, 40)).toEqual({ main: '#cdaa7d', secondary: '#1e1e1e' });
  });

  it('eine weiße Platte bleibt erhalten (Hintergrund nur vom Rand her)', () => {
    const white = image(40, 40, [255, 255, 255], [
      [4, 8, 36, 10, [60, 60, 60]], // dark edge separates the top from the background
      [5, 10, 35, 14, [238, 238, 236]],
      [6, 14, 9, 34, [30, 30, 30]],
      [31, 14, 34, 34, [30, 30, 30]],
    ]);
    expect(productColors(white, 40, 40)?.main).toBe('#eeeeec');
  });

  it('einfarbiges Produkt: keine zweite Farbe', () => {
    expect(productColors(image(20, 20, [250, 250, 250], [[3, 3, 17, 17, [90, 110, 140]]]), 20, 20)).toEqual({ main: '#5a6e8c' });
  });
});
