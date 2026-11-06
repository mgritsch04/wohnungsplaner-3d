import { isOutdoorRoom } from './daylight';
import type { DerivedPlan } from './derived';
import { DEFAULT_CEILING_MATERIAL_ID, DEFAULT_FLOOR_MATERIAL_ID, DEFAULT_WALL_MATERIAL_ID, materialById } from './materials';
import type { Furniture, Material, Project, Room } from './schema';
import { windowLights } from './windowLight';
import { pointInPolygon, polygonArea, type Vec2 } from './vec';

/**
 * Room acoustics (#494): rough reverberation time per room after Sabine, T = 0.161 · V / A, with the
 * equivalent absorption area A = Σ surface · absorption coefficient.
 *
 * An orientation, not a measurement: the absorption coefficients are typical broadband guide values
 * (mean of the octaves 125 Hz … 2 kHz) rounded from common reference tables – e.g. Möser, "Technische
 * Akustik", and Fasold/Veres, "Schallschutz und Raumakustik in der Praxis" – not product data. Real
 * values vary with the product, the mounting and the frequency. The target comes from the speech
 * formula of DIN 18041 (T_soll = 0.37·lg V − 0.14 s), the bands around it are a planning guide.
 */

/** Typical absorption coefficient per material kind, by where the surface is. */
export const ABSORPTION: Record<'floor' | 'wall' | 'ceiling', Record<Material['kind'], number>> = {
  floor: { paint: 0.05, wood: 0.08, tile: 0.02, stone: 0.02, concrete: 0.02, carpet: 0.3, metal: 0.03, glass: 0.03, fabric: 0.3, plastic: 0.04 },
  wall: { paint: 0.04, wood: 0.1, tile: 0.02, stone: 0.03, concrete: 0.03, carpet: 0.25, metal: 0.04, glass: 0.04, fabric: 0.2, plastic: 0.04 },
  ceiling: { paint: 0.06, wood: 0.1, tile: 0.03, stone: 0.03, concrete: 0.03, carpet: 0.25, metal: 0.04, glass: 0.04, fabric: 0.2, plastic: 0.05 },
};
/** Window glass (broadband, incl. the low frequencies where the pane vibrates). */
export const WINDOW_ABSORPTION = 0.12;
/** Rug on a hard floor, heavy curtain (gathered, hung in front of the glass), filled bookshelf front, bed, picture with absorber. */
export const RUG_ABSORPTION = 0.3;
export const CURTAIN_ABSORPTION = 0.3;
export const SHELF_ABSORPTION = 0.2;
export const BED_ABSORPTION = 0.3;
export const ACOUSTIC_PICTURE_ABSORPTION = 0.6;
/** Equivalent absorption area (m²) of one upholstered seat, of a plant. */
export const SEAT_AREA = 0.4;
export const PLANT_AREA = 0.15;
/** Other solid furniture (tables, cabinets, chairs): top and front, scatters more than it absorbs. */
export const OTHER_ABSORPTION = 0.1;

export type AcousticUsage = 'living' | 'work' | 'sleep';

export const USAGE_LABEL: Record<AcousticUsage, string> = { living: 'Wohnen', work: 'Homeoffice/Telefonieren', sleep: 'Schlafen' };

/** Bands as multiples of the target time: good up to `good`, fair up to `fair`, above that poor. */
export const USAGE_BANDS: Record<AcousticUsage, { good: number; fair: number }> = {
  living: { good: 1.7, fair: 2.6 },
  work: { good: 1.4, fair: 2.1 },
  sleep: { good: 1.8, fair: 2.7 },
};

/** Rooms where reverberation is no topic: wet rooms, halls, storage. */
const SKIP = /(bad|wc|toilette|wasch|abstell|speicher|keller|technik|hwr|gang|flur|diele|vorraum|vorzimmer|garderobe)/i;
const WORK = /(arbeit|büro|buero|office|studier|homeoffice)/i;
const SLEEP = /(schlaf|kind|gäste|gaeste|bedroom|nursery)/i;

export const usageOf = (name: string): AcousticUsage => (WORK.test(name) ? 'work' : SLEEP.test(name) ? 'sleep' : 'living');

export type AcousticLevel = 'good' | 'fair' | 'poor';

export const ACOUSTIC_LABEL: Record<AcousticLevel, string> = { good: 'angenehm', fair: 'etwas hallig', poor: 'hallt' };

export interface AcousticSuggestion {
  label: string;
  /** Estimated change of the reverberation time in seconds (negative = shorter). */
  delta: number;
}

export interface RoomAcoustic {
  roomId: string;
  name: string;
  usage: AcousticUsage;
  /** Room volume (m³) and equivalent absorption area (m²). */
  volume: number;
  absorption: number;
  /** Estimated reverberation time (s) and the target time of the room (s). */
  reverb: number;
  target: number;
  /** Largest reverberation time (s) that still counts as pleasant for the usage. */
  limit: number;
  level: AcousticLevel;
  suggestions: AcousticSuggestion[];
}

const shapeOf = (f: Furniture): string => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);

/** Target reverberation time (s) for speech in a room of `volume` m³ (DIN 18041, group A, formula for 30 … 5000 m³). */
export const targetReverb = (volume: number): number => Math.max(0.3, 0.37 * Math.log10(Math.max(30, volume)) - 0.14);

export const sabine = (volume: number, absorption: number): number => (0.161 * volume) / Math.max(0.1, absorption);

/** "ca. 1,2 s" */
export const formatSeconds = (s: number): string => `${(Math.round(s * 10) / 10).toFixed(1).replace('.', ',')} s`;

const wallHeightOf = (project: Project, room: Room): number => {
  const hs: number[] = [];
  for (let i = 0; i < room.nodeIds.length; i++) {
    const a = room.nodeIds[i];
    const b = room.nodeIds[(i + 1) % room.nodeIds.length];
    const w = project.walls.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
    if (w) hs.push(w.height);
  }
  return hs.length ? hs.reduce((s, h) => s + h, 0) / hs.length : 2.5;
};

const perimeter = (poly: Vec2[]): number => poly.reduce((s, p, i) => s + Math.hypot(p.x - poly[(i + 1) % poly.length].x, p.y - poly[(i + 1) % poly.length].y), 0);

/** Acoustic estimate of every indoor living room (not wet rooms, halls, storage, balconies). */
export function roomAcoustics(project: Project, plan: DerivedPlan): RoomAcoustic[] {
  const windows = windowLights(project, plan);
  const out: RoomAcoustic[] = [];
  for (const room of project.rooms) {
    const poly = plan.rooms.get(room.id)?.interior;
    if (!poly || poly.length < 3 || isOutdoorRoom(room) || SKIP.test(room.name)) continue;
    const floor = polygonArea(poly);
    const height = wallHeightOf(project, room);
    const volume = floor * height;
    if (floor < 4 || volume < 10) continue;

    const floorMat = materialById(project.materials, room.floorMaterialId, DEFAULT_FLOOR_MATERIAL_ID);
    const wallMat = materialById(project.materials, room.wallMaterialId, DEFAULT_WALL_MATERIAL_ID);
    const ceilingMat = materialById(project.materials, room.ceilingMaterialId, DEFAULT_CEILING_MATERIAL_ID);
    const aFloor = ABSORPTION.floor[floorMat.kind];

    const inRoom = project.furniture.filter((f) => pointInPolygon({ x: f.x, y: f.y }, poly));
    const glass = windows.filter((w) => w.roomId === room.id);
    const glassArea = glass.reduce((s, w) => s + w.glass, 0);
    const wallArea = Math.max(0, perimeter(poly) * height - glassArea);

    let A = floor * aFloor + floor * ABSORPTION.ceiling[ceilingMat.kind] + wallArea * ABSORPTION.wall[wallMat.kind] + glassArea * WINDOW_ABSORPTION;

    let rugArea = 0;
    let curtainWidth = 0;
    for (const f of inRoom) {
      const shape = shapeOf(f);
      const qty = f.quantity ?? 1;
      if (shape === 'rug') {
        const area = Math.min(f.width * f.depth * qty, floor * 0.9 - rugArea);
        if (area > 0) {
          rugArea += area;
          A += area * Math.max(0, RUG_ABSORPTION - aFloor);
        }
      } else if (shape === 'curtain') {
        A += f.width * f.height * CURTAIN_ABSORPTION * qty;
        curtainWidth += f.width * qty;
      } else if (shape === 'sofa') A += Math.max(1, Math.round(f.width / 0.65)) * SEAT_AREA * qty;
      else if (shape === 'sofa-corner') A += Math.max(2, Math.round((f.width + f.depth) / 0.65 - 1)) * SEAT_AREA * qty;
      else if (shape === 'armchair') A += SEAT_AREA * 1.2 * qty;
      else if (shape === 'bed' || shape === 'mattress') A += f.width * f.depth * BED_ABSORPTION * qty;
      else if (shape === 'shelf') A += f.width * f.height * SHELF_ABSORPTION * qty;
      else if (shape === 'plant') A += PLANT_AREA * qty;
      else if (f.solid && f.height > 0.3) A += (f.width * f.depth + f.width * f.height) * OTHER_ABSORPTION * qty;
    }

    const usage = usageOf(room.name);
    const target = targetReverb(volume);
    const bands = USAGE_BANDS[usage];
    const reverb = sabine(volume, A);
    const level: AcousticLevel = reverb <= target * bands.good ? 'good' : reverb <= target * bands.fair ? 'fair' : 'poor';

    // measures with their estimated effect (each on its own, not added up)
    const suggestions: AcousticSuggestion[] = [];
    const effect = (extra: number) => sabine(volume, A + extra) - reverb;
    const free = floor * 0.9 - rugArea;
    // a big rug is only suggested while there is none yet
    if (aFloor < RUG_ABSORPTION && rugArea < 4) {
      if (free >= 6.5) suggestions.push({ label: 'Teppich 200×300', delta: effect(6 * (RUG_ABSORPTION - aFloor)) });
      else if (free >= 2.5) suggestions.push({ label: 'Teppich 120×170', delta: effect(2.04 * (RUG_ABSORPTION - aFloor)) });
    }
    if (glass.length && curtainWidth === 0) {
      // a floor-length curtain 40 cm wider than the widest window replaces the glass as the surface seen by the room
      const w = Math.max(...glass.map((x) => Math.hypot(x.a.x - x.b.x, x.a.y - x.b.y))) + 0.4;
      suggestions.push({ label: 'Vorhang am Fenster', delta: effect(w * 2.4 * CURTAIN_ABSORPTION - glassArea * 0.5 * WINDOW_ABSORPTION) });
    }
    if (!inRoom.some((f) => shapeOf(f) === 'armchair' || shapeOf(f) === 'sofa' || shapeOf(f) === 'sofa-corner') && usage === 'living') suggestions.push({ label: 'Polstermöbel (Sofa oder Sessel)', delta: effect(3 * SEAT_AREA) });
    if (!inRoom.some((f) => shapeOf(f) === 'shelf')) suggestions.push({ label: 'gefülltes Bücherregal an einer Wand', delta: effect(0.8 * 1.9 * SHELF_ABSORPTION) });
    suggestions.push({ label: 'Akustikbild 120×80 an der Wand', delta: effect(1.2 * 0.8 * ACOUSTIC_PICTURE_ABSORPTION) });

    out.push({
      roomId: room.id,
      name: room.name,
      usage,
      volume,
      absorption: A,
      reverb,
      target,
      limit: target * bands.good,
      level,
      suggestions: suggestions.filter((s) => s.delta <= -0.05).sort((a, b) => a.delta - b.delta),
    });
  }
  return out;
}

/** "Teppich 200×300 bringt ca. −0,2 s" */
export const suggestionText = (s: AcousticSuggestion): string => `${s.label} bringt ca. −${formatSeconds(Math.abs(s.delta))}`;
