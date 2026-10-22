import type { DerivedPlan } from '../model/derived';
import { defaultLeafOpen, type Project, type SmartDevice } from '../model/schema';
import { boundsOf, pointInPolygon, type Vec2 } from '../model/vec';

/**
 * WLAN coverage estimate (#253)
 * ------------------------------
 * Simple indoor model: path loss after ITU-R P.1238 (L = 20·log10 f[MHz] + N·log10 d[m] − 28,
 * residential N = 28) plus an explicit loss for every wall, closed door and closed window the
 * straight line from the router to the point crosses (multi-wall model in the style of COST 231).
 * ITU-R P.1238 itself folds walls into N; the explicit wall losses make the plan matter, so the
 * result is an ESTIMATE, not a measurement. The wall values are rough guide values (see `WALL_SOURCES`),
 * they depend on material, moisture and metal content.
 */

export type WifiBand = '2.4' | '5';
export const BAND_LABEL: Record<WifiBand, string> = { '2.4': '2,4 GHz', '5': '5 GHz' };
const FREQ_MHZ: Record<WifiBand, number> = { '2.4': 2437, '5': 5200 };

/** Distance loss coefficient N for residential buildings (ITU-R P.1238). */
export const ITU_N = 28;
/** Assumed radiated power (EIRP, dBm) of a device without datasheet value: the EU limit of 100 mW at 2.4 GHz. */
export const ASSUMED_TX_DBM = 20;
/** Receiver antenna gain (dBi): a phone is assumed to have none. */
const RX_GAIN_DBI = 0;

/** Guide values for the loss (dB) of one crossing. */
export const WALL_LOSS = {
  light: { '2.4': 3, '5': 4, label: 'Leichtbauwand (bis 12,5 cm)' },
  masonry: { '2.4': 10, '5': 12, label: 'Mauerwerk (bis 20 cm)' },
  concrete: { '2.4': 20, '5': 25, label: 'Massivwand/Beton (über 20 cm)' },
  door: { '2.4': 3, '5': 4, label: 'Tür (geschlossen)' },
  window: { '2.4': 3, '5': 4, label: 'Fenster (geschlossen)' },
} as const;

export const WALL_SOURCES: { label: string; url: string }[] = [
  { label: 'ITU-R P.1238 (Übersicht, Formel und Koeffizient N)', url: 'https://en.wikipedia.org/wiki/ITU_model_for_indoor_attenuation' },
  { label: 'Keenetic: Dämpfung im 2,4-GHz-Band je Material (Fenster ca. 3 dB, Innenwand 15 cm 15–20 dB, Tragwand 30 cm 20–25 dB)', url: 'https://support.keenetic.com/titan/kn-1811/en/20207.html' },
];

export type WifiLevel = 'good' | 'medium' | 'weak' | 'none';
export const LEVEL_LABEL: Record<WifiLevel, string> = { good: 'gut', medium: 'mittel', weak: 'schwach', none: 'kein Empfang' };
export const LEVEL_COLOR: Record<WifiLevel, string> = { good: '#16a34a', medium: '#eab308', weak: '#f97316', none: '#dc2626' };
export const LEVEL_ORDER: WifiLevel[] = ['good', 'medium', 'weak', 'none'];
/** Lower limits (dBm) of the levels. */
export const LEVEL_MIN_DBM: Record<Exclude<WifiLevel, 'none'>, number> = { good: -60, medium: -70, weak: -80 };

export const levelOf = (dbm: number): WifiLevel => (dbm >= LEVEL_MIN_DBM.good ? 'good' : dbm >= LEVEL_MIN_DBM.medium ? 'medium' : dbm >= LEVEL_MIN_DBM.weak ? 'weak' : 'none');

export const isRouter = (d: SmartDevice) => d.kind === 'router';

/** Loss of a wall of this thickness (m), by guide class. */
export function wallLossDb(thickness: number, band: WifiBand): number {
  const c = thickness <= 0.125 ? WALL_LOSS.light : thickness <= 0.2 ? WALL_LOSS.masonry : WALL_LOSS.concrete;
  return c[band];
}

interface Barrier {
  a: Vec2;
  dir: Vec2;
  length: number;
  thickness: number;
  openings: { s0: number; s1: number; loss: number }[];
}

/** Wall centre lines with the loss of their openings (open door leaves, open windows and passages cost nothing). */
function barriersOf(project: Project, derived: DerivedPlan, band: WifiBand): Barrier[] {
  const out: Barrier[] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    const openings = (derived.openings.get(w.id) ?? []).map((r) => {
      const open = r.opening.open ?? defaultLeafOpen(r.opening.kind);
      const loss = r.opening.kind === 'passage' || open ? 0 : r.opening.kind === 'door' ? WALL_LOSS.door[band] : WALL_LOSS.window[band];
      return { s0: r.s0, s1: r.s1, loss };
    });
    out.push({ a: fp.a, dir: fp.dir, length: fp.length, thickness: fp.thickness, openings });
  }
  return out;
}

/** Sum of the losses (dB) of all barriers the segment from→to crosses. */
function crossingLossDb(from: Vec2, to: Vec2, barriers: Barrier[], band: WifiBand): number {
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  let loss = 0;
  for (const b of barriers) {
    const ex = b.dir.x * b.length;
    const ey = b.dir.y * b.length;
    const den = rx * ey - ry * ex;
    if (Math.abs(den) < 1e-12) continue;
    const ax = b.a.x - from.x;
    const ay = b.a.y - from.y;
    const t = (ax * ey - ay * ex) / den; // along the ray
    const u = (ax * ry - ay * rx) / den; // along the wall
    if (t <= 1e-9 || t > 1 || u < 0 || u >= 1) continue;
    const s = u * b.length;
    const hit = b.openings.find((o) => s >= o.s0 && s <= o.s1);
    loss += hit ? hit.loss : wallLossDb(b.thickness, band);
  }
  return loss;
}

/** Path loss (dB) over `dist` metres without walls (ITU-R P.1238). */
export function freeLossDb(dist: number, band: WifiBand): number {
  return 20 * Math.log10(FREQ_MHZ[band]) + ITU_N * Math.log10(Math.max(dist, 1)) - 28;
}

export interface WifiSource {
  id: string;
  name: string;
  x: number;
  y: number;
  txDbm: number;
}

export function wifiSources(project: Project): WifiSource[] {
  return project.devices.filter(isRouter).map((d) => ({ id: d.id, name: d.name, x: d.x, y: d.y, txDbm: ASSUMED_TX_DBM }));
}

export interface WifiGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** Row-major signal (dBm); NaN outside every room. */
  dbm: Float32Array;
  /** Room id per cell ('' outside). */
  room: string[];
}

/**
 * Signal strength (dBm, strongest router counts) on a grid over all rooms. A point reaches the
 * router through the straight line only; no reflections, no floors above or below.
 */
export function wifiGrid(project: Project, derived: DerivedPlan, band: WifiBand, cell = 0.25): WifiGrid | null {
  const sources = wifiSources(project);
  const rooms = project.rooms.map((r) => ({ id: r.id, poly: derived.rooms.get(r.id)?.interior })).filter((r): r is { id: string; poly: Vec2[] } => !!r.poly);
  const b = boundsOf(rooms.flatMap((r) => r.poly));
  if (!sources.length || !b) return null;
  const barriers = barriersOf(project, derived, band);
  const cols = Math.ceil((b.maxX - b.minX) / cell);
  const rows = Math.ceil((b.maxY - b.minY) / cell);
  const dbm = new Float32Array(cols * rows).fill(NaN);
  const room: string[] = new Array(cols * rows).fill('');
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: b.minX + (i + 0.5) * cell, y: b.minY + (j + 0.5) * cell };
      const r = rooms.find((x) => pointInPolygon(p, x.poly));
      if (!r) continue;
      let best = -Infinity;
      for (const s of sources) {
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        const rssi = s.txDbm + RX_GAIN_DBI - freeLossDb(d, band) - crossingLossDb(s, p, barriers, band);
        if (rssi > best) best = rssi;
      }
      dbm[j * cols + i] = best;
      room[j * cols + i] = r.id;
    }
  }
  return { cell, minX: b.minX, minY: b.minY, cols, rows, dbm, room };
}

export interface RoomWifi {
  roomId: string;
  /** typical value: median of the room's cells (dBm) */
  dbm: number;
  level: WifiLevel;
  /** weakest 10 % of the floor (dBm), shows dead corners */
  weakDbm: number;
}

export function roomWifi(grid: WifiGrid | null, project: Project): RoomWifi[] {
  if (!grid) return [];
  const out: RoomWifi[] = [];
  for (const r of project.rooms) {
    const v: number[] = [];
    grid.room.forEach((id, k) => id === r.id && v.push(grid.dbm[k]));
    if (!v.length) continue;
    v.sort((a, b) => a - b);
    const dbm = v[Math.floor(v.length / 2)];
    out.push({ roomId: r.id, dbm, level: levelOf(dbm), weakDbm: v[Math.floor(v.length * 0.1)] });
  }
  return out;
}
