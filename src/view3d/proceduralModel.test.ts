import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildParts } from './ProceduralModel';
import { GENERIC_CATALOG } from '../catalog/generic';

describe('procedural furniture models', () => {
  for (const item of GENERIC_CATALOG) {
    const shape = item.model.type === 'procedural' ? item.model.shape : 'box';
    it(`${item.id} (${shape}) stays within its stated dimensions`, () => {
      const parts = buildParts(shape, item.width, item.depth, item.height, item.color);
      expect(parts.length).toBeGreaterThan(0);
      const bb = new THREE.Box3();
      for (const p of parts) {
        const m = new THREE.Mesh(p.geo);
        m.position.set(...p.p);
        m.scale.set(...p.s);
        if (p.r) m.rotation.set(...p.r);
        m.updateMatrixWorld();
        bb.union(new THREE.Box3().setFromObject(m));
      }
      const size = bb.getSize(new THREE.Vector3());
      // allow small overhangs (handles, taps, reclined cushions, curtain rods)
      const tol = 0.12;
      expect(size.x).toBeLessThanOrEqual(item.width + tol);
      expect(size.z).toBeLessThanOrEqual(item.depth + tol);
      // taps are not part of the stated height, nor is the handrail of a stair (its height is the rise, #54)
      expect(bb.max.y).toBeLessThanOrEqual(item.height + (shape === 'k-sink' || shape === 'washbasin' ? 0.4 : shape === 'stairs' ? 1 : tol));
      expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6);
      // the model should fill most of its footprint (no mis-scaled parts)
      expect(size.x).toBeGreaterThan(item.width * 0.6);
    });
  }
});

describe('furniture material (#63)', () => {
  it('gives the main parts the chosen surface and keeps fixed parts', () => {
    const plain = buildParts('sofa', 2, 0.9, 0.85, '#8E9096');
    const leather = buildParts('sofa', 2, 0.9, 0.85, '#8E9096', undefined, 'leather');
    expect(leather).toHaveLength(plain.length);
    const main = leather.filter((p) => p.detail === 'leather');
    expect(main.length).toBeGreaterThan(plain.length / 2);
    expect(main.every((p) => p.rough === 0.45)).toBe(true);
    // the wooden feet are not in the item colour and keep their look
    const feet = leather.filter((_, i) => plain[i].detail === 'woodgrain');
    expect(feet.length).toBeGreaterThan(0);
    expect(feet.every((p) => p.detail === 'woodgrain')).toBe(true);
  });

  it('metal makes the body metallic but leaves glowing lamp shades alone', () => {
    const lamp = buildParts('table-lamp', 0.3, 0.3, 0.5, '#b7bbbf', undefined, 'metal');
    expect(lamp.some((p) => p.metal === 1 && (p.rough ?? 1) < 0.2)).toBe(true);
    expect(lamp.filter((p) => p.emissive).every((p) => p.metal === undefined)).toBe(true);
  });

  it('without a material the model keeps its built-in look', () => {
    expect(buildParts('table', 1.6, 0.9, 0.75, '#c9a477', undefined, undefined)).toEqual(buildParts('table', 1.6, 0.9, 0.75, '#c9a477'));
  });
});

describe('Gestell und Teilmaße (#273)', () => {
  it('jede Gestellart erzeugt Teile in der Gestellfarbe, die Platte bleibt in der Hauptfarbe', () => {
    for (const base of ['legs4', 'sled', 'x', 'pedestal', 'panel'] as const) {
      const parts = buildParts('table', 1.6, 0.9, 0.76, '#c49a6c', undefined, undefined, { base, secondary: '#1f1f1f' });
      expect(parts.filter((p) => p.color === '#1f1f1f').length).toBeGreaterThan(0);
      expect(parts.filter((p) => p.color === '#c49a6c')).toHaveLength(1);
    }
  });

  it('Plattenstärke aus der Seite', () => {
    const [top] = buildParts('table', 1.6, 0.9, 0.76, '#c49a6c', undefined, undefined, { topThickness: 0.05 });
    expect(top.p[1]).toBeCloseTo(0.76 - 0.025);
  });
});

it('nur die Tischplatte nimmt das Produktfoto (#273, Stufe 2)', () => {
  for (const shape of ['table', 'table-round', 'desk']) {
    const parts = buildParts(shape, 1.6, 0.9, 0.76, '#c49a6c');
    expect(parts.filter((p) => p.textured)).toHaveLength(1);
  }
  expect(buildParts('sofa', 2, 0.9, 0.85, '#8E9096').some((p) => p.textured)).toBe(false);
});
