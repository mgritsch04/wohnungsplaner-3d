/** Approximate sun direction (unit vector, world space, Y up) for an hour of the day. */
export function sunDirection(hour: number): { x: number; y: number; z: number } {
  // simple model: sunrise 6h (east, +X), noon 13h (south, +Z), sunset 20h (west)
  const t = Math.max(0, Math.min(1, (hour - 6) / 14));
  const azimuth = Math.PI * t; // 0 = east, PI = west
  const elevation = Math.sin(Math.PI * t) * 1.05; // radians, ~60° at noon
  const ce = Math.cos(elevation);
  const x = Math.cos(azimuth) * ce;
  const z = Math.sin(azimuth) * ce;
  const y = hour <= 6 || hour >= 20 ? -0.2 : Math.sin(elevation);
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}

/** Rough black-body colour for a colour temperature in Kelvin (Tanner Helland approximation). */
export function kelvinToColor(kelvin: number): string {
  const t = kelvin / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[r, g, b].map((v) => c(v).toString(16).padStart(2, '0')).join('')}`;
}
