import type * as THREE from 'three';

/**
 * Metallic surfaces in realism mode (#188). A metal shows almost no diffuse colour, so it only looks like metal
 * when it reflects its surroundings. The scene-wide environment light is kept dim (it is fill light for
 * everything), which made metal read as flat grey; these materials get the environment as their own envMap
 * with a stronger reflection level that still follows the time of day.
 */
const metals = new Set<THREE.MeshStandardMaterial>();
let envMap: THREE.Texture | null = null;
let intensity = 1;

/** Metalness from which a material counts as metal. */
export const METAL_THRESHOLD = 0.5;

/**
 * Reflection level of metals for a given scene environment intensity: bright by day; at night a
 * minimum level as far as lamps actually shine (`lampShine` 0..1), so a room without lamps stays
 * dark and its handles and window panes do not glow (#216).
 */
export function metalEnvIntensity(sceneIntensity: number, lampShine = 1): number {
  return Math.min(1.6, Math.max(0.35 * lampShine, 2.4 * sceneIntensity));
}

/** Metal materials are cached and shared, so they stay registered. */
export function registerMetal(material: THREE.MeshStandardMaterial): void {
  metals.add(material);
  apply(material);
}

/** Called when the material cache is disposed. */
export function forgetMetals(): void {
  metals.clear();
}

export function setMetalEnvironment(map: THREE.Texture | null): void {
  envMap = map;
  metals.forEach(apply);
}

export function setMetalEnvLevel(sceneIntensity: number, lampShine = 1): void {
  intensity = metalEnvIntensity(sceneIntensity, lampShine);
  metals.forEach(apply);
}

function apply(m: THREE.MeshStandardMaterial) {
  if (m.envMap !== envMap) {
    m.envMap = envMap;
    m.needsUpdate = true;
  }
  m.envMapIntensity = intensity;
}
