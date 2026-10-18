import { describe, expect, it } from 'vitest';
import { dominantColor } from './productColor';

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
