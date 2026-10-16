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
  const wasOn = level > 0;
  level = value;
  for (const [l, base] of lights) l.intensity = base * value;
  for (const m of shades) m.emissiveIntensity = value;
  if (wasOn !== value > 0) assignShadows();
}

export const lampLevelNow = () => level;

/**
 * Shadows of lamp lights (#130), so their light stops at walls and closed doors.
 * Point-light shadows render the scene six times, so they are kept cheap:
 * - at most MAX_SHADOW_LAMPS lights cast shadows (lamps before automatic room lights),
 * - only while the lamps are on (shader variants are cached, so switching is cheap),
 * - the shadow maps are rendered only when something changed (requestLampShadowUpdate),
 *   not every frame: walls and furniture are static while the camera moves.
 */
export const MAX_SHADOW_LAMPS = 6;
const LAMP_SHADOW_MAP = 512;

interface ShadowEntry {
  light: THREE.PointLight;
  /** Lower comes first when the budget is short. */
  priority: number;
}
const shadowLamps: ShadowEntry[] = [];
let shadowsDirty = false;

export function registerShadowLamp(light: THREE.PointLight, priority = 0): () => void {
  const s = light.shadow;
  s.mapSize.set(LAMP_SHADOW_MAP, LAMP_SHADOW_MAP);
  // lamps often stand close to a wall; far follows light.distance (set by the renderer)
  s.camera.near = 0.05;
  s.camera.updateProjectionMatrix();
  s.bias = -0.002;
  s.normalBias = 0.02;
  s.autoUpdate = false;
  s.needsUpdate = true;
  const entry = { light, priority };
  shadowLamps.push(entry);
  assignShadows();
  return () => {
    const i = shadowLamps.indexOf(entry);
    if (i >= 0) shadowLamps.splice(i, 1);
    light.castShadow = false;
    assignShadows();
  };
}

function assignShadows(): void {
  const on = level > 0;
  const ranked = [...shadowLamps].sort((a, b) => a.priority - b.priority);
  ranked.forEach(({ light }, i) => {
    const cast = on && i < MAX_SHADOW_LAMPS;
    // maps were not kept up to date while the light cast no shadow
    if (cast && !light.castShadow) light.shadow.needsUpdate = true;
    light.castShadow = cast;
  });
}

/** Walls, doors or furniture changed: re-render the lamp shadow maps in the next frame. */
export function requestLampShadowUpdate(): void {
  shadowsDirty = true;
}

/** Called once per frame before rendering. */
export function flushLampShadowUpdates(): void {
  if (!shadowsDirty) return;
  shadowsDirty = false;
  for (const { light } of shadowLamps) if (light.castShadow) light.shadow.needsUpdate = true;
}
