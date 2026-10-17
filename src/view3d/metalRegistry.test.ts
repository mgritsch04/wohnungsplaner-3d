import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { getColorMaterial } from './materials3d';
import { metalEnvIntensity, setMetalEnvironment, setMetalEnvLevel } from './metalRegistry';

describe('metal reflections (#188)', () => {
  it('metal materials get the environment as their own, brighter reflection', () => {
    const env = new THREE.Texture();
    setMetalEnvironment(env);
    setMetalEnvLevel(0.6);
    const metal = getColorMaterial('#b7bbbf', 'realism', { roughness: 0.16, metalness: 1 }) as THREE.MeshStandardMaterial;
    const paint = getColorMaterial('#b7bbbf', 'realism', { roughness: 0.2, metalness: 0 }) as THREE.MeshStandardMaterial;
    expect(metal.envMap).toBe(env);
    expect(metal.envMapIntensity).toBeGreaterThan(0.6);
    expect(paint.envMap).toBeNull();
    setMetalEnvironment(null);
    expect(metal.envMap).toBeNull();
  });

  it('reflection follows the time of day but never goes black', () => {
    expect(metalEnvIntensity(0.6)).toBeGreaterThan(metalEnvIntensity(0.1));
    expect(metalEnvIntensity(0)).toBeGreaterThan(0.3);
    expect(metalEnvIntensity(10)).toBeLessThanOrEqual(1.6);
  });

  it('at night without shining lamps, metal and glass do not glow (#216)', () => {
    const night = 0.006; // scene environment intensity at 0:00
    expect(metalEnvIntensity(night, 0)).toBeLessThan(0.02);
    expect(metalEnvIntensity(night, 1)).toBeGreaterThan(0.3);
    expect(metalEnvIntensity(0.6, 0)).toBe(metalEnvIntensity(0.6, 1)); // by day unchanged
  });
});
