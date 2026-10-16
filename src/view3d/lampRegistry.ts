import type * as THREE from 'three';

/**
 * Light sources of lamp furniture (bulb light + glowing shade) in realism mode.
 * The lighting rig sets one level (0..1) for all of them every time the time of
 * day or the lamp switch changes, without re-rendering React.
 */
const lights = new Map<THREE.PointLight, number>();
const shades = new Set<THREE.Material & { emissiveIntensity: number }>();
let level = 1;

export function registerLampLight(light: THREE.PointLight, baseIntensity: number): () => void {
  lights.set(light, baseIntensity);
  light.intensity = baseIntensity * level;
  return () => void lights.delete(light);
}

/** Shade materials are cached and shared, so they stay registered. */
export function registerLampShade(material: THREE.Material): void {
  const m = material as THREE.Material & { emissiveIntensity?: number };
  if (typeof m.emissiveIntensity !== 'number') return;
  shades.add(m as THREE.Material & { emissiveIntensity: number });
  m.emissiveIntensity = level;
}

export function setLampLevel(value: number): void {
  level = value;
  for (const [l, base] of lights) l.intensity = base * value;
  for (const m of shades) m.emissiveIntensity = value;
}

export const lampLevelNow = () => level;
