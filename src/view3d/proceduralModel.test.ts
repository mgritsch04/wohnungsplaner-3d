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
      // taps are not part of the stated height
      expect(bb.max.y).toBeLessThanOrEqual(item.height + (shape === 'k-sink' || shape === 'washbasin' ? 0.4 : tol));
      expect(bb.min.y).toBeGreaterThanOrEqual(-1e-6);
      // the model should fill most of its footprint (no mis-scaled parts)
      expect(size.x).toBeGreaterThan(item.width * 0.6);
    });
  }
});
