import type { Project } from './schema';
import type { DerivedPlan } from './derived';
import { isOutdoorRoom } from './daylight';
import { wallRooms } from './acoustics';

/**
 * Rough heating-cost estimate (#90). Orientation only – no energy consulting, no standard
 * calculation. All figures are typical ballpark values and shown to the user as assumptions.
 */
export type Insulation = Project['settings']['insulation'];
export type HeatingSource = Project['settings']['heatingSource'];

export const INSULATION: { id: Insulation; label: string; /** typical heat demand, kWh per m² and year */ kwh: number }[] = [
  { id: 'unrenovated', label: 'Altbau unsaniert', kwh: 200 },
  { id: 'partial', label: 'Teilsaniert', kwh: 140 },
  { id: 'standard', label: 'Standard (ca. 1990–2010)', kwh: 100 },
  { id: 'good', label: 'Gut gedämmt (Neubau)', kwh: 60 },
  { id: 'passive', label: 'Passivhaus', kwh: 25 },
];

export const HEATING_SOURCES: { id: HeatingSource; label: string; /** € per kWh of heat delivered */ price: number }[] = [
  { id: 'gas', label: 'Gas', price: 0.12 },
  { id: 'oil', label: 'Öl', price: 0.11 },
  { id: 'district', label: 'Fernwärme', price: 0.14 },
  { id: 'heatpump', label: 'Wärmepumpe (Strom, Jahresarbeitszahl ca. 3,5)', price: 0.09 },
  { id: 'electric', label: 'Elektro-Direktheizung', price: 0.3 },
];

/** Typical share of window area to heated floor area; more glass raises the demand a little. */
export const REF_WINDOW_SHARE = 0.15;

export interface HeatingEstimate {
  /** Heated floor area (rooms without balconies/terraces), m². */
  area: number;
  /** Window and glass-door area in outer walls, m². */
  windowArea: number;
  windowShare: number;
  /** Demand correction for the window share (1 = typical). */
  windowFactor: number;
  kwhPerM2: number;
  kwhPerYear: number;
  pricePerKwh: number;
  eurPerYear: number;
}

/** Demand changes by 2 % per percentage point of window share above/below the reference, within 0.85–1.3. */
export const windowFactorOf = (share: number): number => Math.max(0.85, Math.min(1.3, 1 + (share - REF_WINDOW_SHARE) * 2));

export function estimateHeating(project: Project, plan: DerivedPlan): HeatingEstimate {
  const heated = project.rooms.filter((r) => !isOutdoorRoom(r));
  const area = heated.reduce((sum, r) => sum + (plan.rooms.get(r.id)?.area ?? 0), 0);
  const heatedIds = new Set(heated.map((r) => r.id));
  let windowArea = 0;
  for (const o of project.openings) {
    if (o.kind !== 'window') continue;
    const rooms = wallRooms(project, o.wallId);
    if (rooms.length === 1 && heatedIds.has(rooms[0])) windowArea += o.width * o.height;
  }
  const windowShare = area > 0 ? windowArea / area : 0;
  const windowFactor = windowFactorOf(windowShare);
  const { insulation, heatingSource } = project.settings;
  const kwhPerM2 = INSULATION.find((x) => x.id === insulation)!.kwh * windowFactor;
  const kwhPerYear = kwhPerM2 * area;
  const pricePerKwh = HEATING_SOURCES.find((x) => x.id === heatingSource)!.price;
  return { area, windowArea, windowShare, windowFactor, kwhPerM2, kwhPerYear, pricePerKwh, eurPerYear: kwhPerYear * pricePerKwh };
}
