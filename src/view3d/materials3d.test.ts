import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getColorMaterial, heightToNormalPixels, roughnessPixels } from './materials3d';

describe('surface detail maps (#192)', () => {
  it('a flat height field gives a straight-up normal', () => {
    const px = heightToNormalPixels(new Float32Array(16).fill(0.5), 4, 3);
    expect([px[0], px[1], px[2]]).toEqual([128, 128, 255]);
  });

  it('a slope tilts the normal against it', () => {
    // brightness rises to the right: the surface faces left (−x)
    const size = 4;
    const h = new Float32Array(size * size).map((_, i) => (i % size) / size);
    const px = heightToNormalPixels(h, size, 3);
    const i = (1 * size + 1) * 4;
    expect(px[i]).toBeLessThan(128);
    expect(px[i + 1]).toBe(128);
  });

  it('dark parts (joints, grout) are rougher; the mean is reported for compensation', () => {
    const { pixels, mean } = roughnessPixels(new Float32Array([0.2, 1, 1, 1]), 0.5);
    expect(pixels[1]).toBe(255); // darkest: factor 1
    expect(pixels[5]).toBe(128); // brightest: 1 − 0.5
    expect(mean).toBeCloseTo((1 + 3 * 0.5) / 4, 5);
    expect(roughnessPixels(new Float32Array([0.3, 0.9]), 0).mean).toBe(1);
  });
});

describe('glass (#192)', () => {
  it('smooth see-through surfaces become reflecting glass in realism mode only', () => {
    const glass = getColorMaterial('#a5c8e1', 'realism', { roughness: 0.05, metalness: 0.1, opacity: 0.28 });
    expect(glass).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    const g = glass as THREE.MeshPhysicalMaterial;
    expect(g.premultipliedAlpha).toBe(true);
    expect(g.metalness).toBe(0);
    expect(g.opacity).toBeCloseTo(0.28);
    expect(getColorMaterial('#a5c8e1', 'planning', { roughness: 0.05, opacity: 0.28 })).toBeInstanceOf(THREE.MeshLambertMaterial);
    // a matt, see-through overlay is no glass
    expect(getColorMaterial('#ff0000', 'realism', { roughness: 0.6, opacity: 0.4 })).not.toBeInstanceOf(THREE.MeshPhysicalMaterial);
  });
});
