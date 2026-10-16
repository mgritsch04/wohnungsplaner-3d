/** Peak sun elevation at solar noon (degrees) – roughly Vienna in late spring. */
const MAX_ELEVATION_DEG = 62;

/** Sun elevation in degrees: 0° at 6:00 and 20:00, maximum at 13:00, negative at night. Continuous over 24 h. */
export function sunElevationDeg(hour: number): number {
  return MAX_ELEVATION_DEG * Math.cos((Math.PI * (hour - 13)) / 14);
}

/**
 * Approximate sun direction (unit vector, world space, Y up, pointing TO the sun).
 * Sunrise in the east (+X), noon in the south (+Z, plan "down"), sunset in the west.
 */
export function sunDirection(hour: number): { x: number; y: number; z: number } {
  const elev = (sunElevationDeg(hour) * Math.PI) / 180;
  const azimuth = (Math.PI * (hour - 6)) / 14; // 0 = east, π/2 = south, π = west
  const ce = Math.cos(elev);
  return { x: Math.cos(azimuth) * ce, y: Math.sin(elev), z: Math.sin(azimuth) * ce };
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, sh: number) => (p >> sh) & 255;
  const m = (sh: number) => Math.round(ch(pa, sh) + (ch(pb, sh) - ch(pa, sh)) * clamp01(t));
  return `#${[m(16), m(8), m(0)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export interface LightingState {
  hour: number;
  sun: { x: number; y: number; z: number };
  elevationDeg: number;
  /** 0 = night … 1 = full daylight. */
  daylight: number;
  /** 0..1, peaks around sunrise/sunset. */
  twilight: number;
  /** Relative direct-sun strength (0..1). */
  sunStrength: number;
  sunColor: string;
  skyColor: string;
  groundColor: string;
  /** Relative strength of diffuse sky/environment light (0..1). */
  ambientStrength: number;
  /** 0..1 – how much artificial interior light is needed (night). */
  artificial: number;
  /** Exposure multiplier (eye adaptation): brighter at night so interiors stay readable. */
  exposure: number;
  background: string;
}

/**
 * Coherent day/night lighting for an hour (0–24). Pure and continuous, so the
 * renderer can blend smoothly between hours. Colour temperatures are clamped to
 * plausible values (sun ≥ 3000 K) to avoid unnaturally orange scenes.
 */
export function lightingAt(hourRaw: number): LightingState {
  const hour = ((hourRaw % 24) + 24) % 24;
  const elev = sunElevationDeg(hour);
  const daylight = smoothstep(-6, 12, elev);
  const twilight = Math.max(0, 1 - Math.abs(elev) / 12) * smoothstep(-8, 0, elev);
  const sunStrength = smoothstep(-1, 15, elev);
  const kelvin = 3000 + (5600 - 3000) * smoothstep(0, 35, elev);
  const daySky = '#cfe0f5';
  const duskSky = '#e9c9b0';
  const nightSky = '#1a2236';
  const sky = mixHex(mixHex(nightSky, daySky, daylight), duskSky, twilight * 0.6);
  const ground = mixHex('#1c1d22', '#b9ad98', daylight);
  const artificial = 1 - smoothstep(-4, 8, elev);
  return {
    hour,
    sun: sunDirection(hour),
    elevationDeg: elev,
    daylight,
    twilight,
    sunStrength,
    sunColor: kelvinToColor(kelvin),
    skyColor: sky,
    groundColor: ground,
    ambientStrength: 0.06 + 0.94 * daylight,
    artificial,
    exposure: 1 + 0.5 * artificial,
    background: mixHex(mixHex('#0d1220', '#dfe7ee', daylight), '#ecd2bd', twilight * 0.5),
  };
}

/** Move `current` towards `target` on the 24 h circle (shortest way) by at most `maxStep` hours. */
export function stepHour(current: number, target: number, maxStep: number): number {
  let diff = (((target - current) % 24) + 36) % 24 - 12; // −12..12
  if (Math.abs(diff) <= maxStep) return target;
  diff = Math.sign(diff) * maxStep;
  return (((current + diff) % 24) + 24) % 24;
}

export const TIME_PRESETS: { label: string; hour: number }[] = [
  { label: 'Morgen', hour: 8 },
  { label: 'Mittag', hour: 13 },
  { label: 'Nachmittag', hour: 16 },
  { label: 'Sonnenuntergang', hour: 19.5 },
  { label: 'Abend', hour: 21 },
  { label: 'Nacht', hour: 23.5 },
];

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
