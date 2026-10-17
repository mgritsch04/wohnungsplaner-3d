import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { kelvinToColor, lightingAt, type LightingState } from './lighting';

/**
 * Environment (reflections and diffuse fill light) that follows the time of day (#192).
 *
 * Before #192 the scene used three.js' neutral RoomEnvironment at all hours: glossy floors, glass and
 * metal mirrored the same grey studio at noon, at sunset and at night. Here the same room is tinted
 * from the lighting state: its light panels take the colour of daylight (bluish sky, warm low sun),
 * at night the warm colour of the lamps, and a bright spot marks the sun while it is up. The overall
 * strength is still set by the lighting rig (scene.environmentIntensity), so brightness stays as it
 * was – only colour and direction change.
 *
 * Rebuilding the reflection map takes a few milliseconds, so it happens in steps of the hour
 * (see tierSettings) and at most every ENV_MIN_INTERVAL_MS while the time slider moves.
 */
export const ENV_MIN_INTERVAL_MS = 300;

/** Hour of the environment shown for a lighting hour: rounded to the step, so small slider moves do not rebuild it. */
export function envHour(hour: number, step: number): number {
  const h = ((hour % 24) + 24) % 24;
  return (Math.round(h / step) * step) % 24;
}

/** Cache key of an environment: the stepped hour and the lamp level in quarters. */
export function envKey(hour: number, lamps: number, step: number): string {
  return `${envHour(hour, step).toFixed(2)}|${Math.round(lamps * 4) / 4}`;
}

/** Colour with the same hue as `hex`, scaled to luminance 1, so tinting changes colour but not brightness. */
export function unitLuminance(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return lum > 1e-4 ? c.multiplyScalar(1 / lum) : new THREE.Color(1, 1, 1);
}

export interface EnvironmentTint {
  /** Colour of the light panels (windows). */
  panel: THREE.Color;
  /** Colour of the room walls (indirect light). */
  room: THREE.Color;
  /** Brightness of the sun spot relative to a light panel (0 = no sun). */
  sun: number;
  sunColor: THREE.Color;
  sunDir: THREE.Vector3;
}

const LAMP_COLOR = kelvinToColor(3000);
const PANEL_TINT = 0.5;
const ROOM_TINT = 0.3;

/** Tint of the environment for a lighting state and lamp level (0..1). Pure, for tests. */
export function environmentTint(st: LightingState, lamps: number): EnvironmentTint {
  // daylight: sky and sun colour mixed; at night the lamps take over as far as they are on
  const day = unitLuminance(st.skyColor).lerp(unitLuminance(st.sunColor), 0.5);
  const lampShare = Math.min(1, st.artificial * lamps);
  const hue = day.lerp(unitLuminance(LAMP_COLOR), lampShare);
  // only partly tinted: fully saturated light made metal look like copper and grey furniture brown
  const panel = new THREE.Color(1, 1, 1).lerp(hue, PANEL_TINT);
  // walls: bounce light, softer still
  const room = new THREE.Color(1, 1, 1).lerp(hue, ROOM_TINT);
  const s = st.sun;
  return { panel, room, sun: st.sunStrength, sunColor: unitLuminance(st.sunColor), sunDir: new THREE.Vector3(s.x, s.y, s.z).normalize() };
}

/** Sun spot strength at full sun, relative to the panels' own emission (they are 17–100). */
const SUN_SPOT = 40;

/** RoomEnvironment tinted for a lighting state; its dispose() frees all geometry and materials, the sun spot included. */
export function createDaylightEnvironment(hour: number, lamps: number): RoomEnvironment {
  const env = new RoomEnvironment();
  const tint = environmentTint(lightingAt(hour), lamps);
  env.traverse((o) => {
    if (o instanceof THREE.PointLight) o.color.copy(tint.room);
    if (!(o instanceof THREE.Mesh)) return;
    const m = o.material as THREE.Material;
    // light panels: black Lambert material with white emission (strength in emissiveIntensity)
    if (m instanceof THREE.MeshLambertMaterial) m.emissive.copy(tint.panel);
    else if (m instanceof THREE.MeshStandardMaterial && m.side === THREE.BackSide) m.color.copy(tint.room);
  });
  if (tint.sun > 0.01) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 8), new THREE.MeshBasicMaterial({ color: tint.sunColor.clone().multiplyScalar(SUN_SPOT * tint.sun) }));
    // inside the room (half size ~14), lifted against the room's own offset
    spot.position.copy(tint.sunDir).multiplyScalar(12).add(new THREE.Vector3(0, 3.5, 0));
    env.add(spot);
  }
  return env;
}

/**
 * Hour and lamp level the lighting currently shows, published by the lighting rig every time it
 * changes and read by the environment in its render loop (no React re-render).
 */
let shown = { hour: 13, lamps: 0 };
export function setEnvironmentLighting(hour: number, lamps: number): void {
  shown = { hour, lamps };
}
export const environmentLighting = () => shown;
