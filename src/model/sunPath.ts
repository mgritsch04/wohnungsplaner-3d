/**
 * Sun path of a place (default: Vienna) for three typical days, and the direct sun hours a room gets
 * through its windows. Estimate for the planner, not a simulation: no neighbouring buildings, no
 * balconies or reveals, no weather. Clock time is local wall-clock time (summer time in summer).
 */

export type Season = 'winter' | 'equinox' | 'summer';

export const SEASONS: readonly Season[] = ['winter', 'equinox', 'summer'];

export const SEASON_LABEL: Record<Season, string> = {
  winter: 'Winter (21. Dez.)',
  equinox: 'Frühling/Herbst (21. März/Sept.)',
  summer: 'Sommer (21. Juni)',
};

const DAY_OF_YEAR: Record<Season, number> = { winter: 355, equinox: 80, summer: 172 };
/** Local clock time of solar noon in Vienna (CET in winter, CEST in summer; longitude 16.4°). */
const SOLAR_NOON: Record<Season, number> = { winter: 12.1, equinox: 12.2, summer: 13.1 };

/** Latitude used when the project has no place (Vienna). */
export const DEFAULT_LATITUDE = 48.2;
/** Sun lower than this above the horizon gives no useful direct light in a flat (degrees). */
export const MIN_ELEVATION = 3;
/** A window gets direct sun while the sun is at most this far (degrees) off its facing direction. */
export const WINDOW_HALF_ANGLE = 80;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export interface SunPosition {
  /** Compass bearing, 0 = north, 90 = east. */
  azimuth: number;
  /** Degrees above the horizon, negative at night. */
  elevation: number;
}

export function sunPosition(season: Season, hour: number, latitude = DEFAULT_LATITUDE): SunPosition {
  const decl = rad(23.44 * Math.sin((2 * Math.PI * (284 + DAY_OF_YEAR[season])) / 365));
  const lat = rad(latitude);
  const ha = rad(15 * (hour - SOLAR_NOON[season]));
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  const az = Math.atan2(-Math.sin(ha) * Math.cos(decl), Math.sin(decl) * Math.cos(lat) - Math.cos(decl) * Math.sin(lat) * Math.cos(ha));
  return { azimuth: (deg(az) + 360) % 360, elevation: deg(el) };
}

const angleBetween = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** True while the sun shines onto a window facing `bearing`. */
export function sunShinesOn(bearing: number, season: Season, hour: number, latitude = DEFAULT_LATITUDE): boolean {
  const s = sunPosition(season, hour, latitude);
  return s.elevation >= MIN_ELEVATION && angleBetween(s.azimuth, bearing) <= WINDOW_HALF_ANGLE;
}

const STEP = 0.25;

export interface RoomSun {
  /** Hours of direct sun through at least one window over the day. */
  hours: number;
  /** First and last clock time with sun (decimal hours); null without sun. */
  from: number | null;
  to: number | null;
  /** Sun at a given clock time. */
  at: (hour: number) => boolean;
}

/** Direct sun of a room whose windows face `bearings`. */
export function roomSun(bearings: readonly number[], season: Season, latitude = DEFAULT_LATITUDE): RoomSun {
  const at = (hour: number) => bearings.some((b) => sunShinesOn(b, season, hour, latitude));
  let n = 0;
  let from: number | null = null;
  let to: number | null = null;
  for (let h = 4; h < 22; h += STEP) {
    if (at(h + STEP / 2)) {
      n++;
      if (from === null) from = h;
      to = h + STEP;
    }
  }
  return { hours: n * STEP, from, to, at };
}

export const formatClock = (h: number): string => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** "ca. 3,5 Std. direkte Sonne (10:15–14:00)" */
export function roomSunLabel(s: RoomSun): string {
  if (s.hours === 0 || s.from === null || s.to === null) return 'keine direkte Sonne';
  return `ca. ${String(Math.round(s.hours * 2) / 2).replace('.', ',')} Std. direkte Sonne (${formatClock(s.from)}–${formatClock(s.to)} Uhr)`;
}
