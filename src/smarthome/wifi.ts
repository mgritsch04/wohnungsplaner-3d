import type { DerivedPlan } from '../model/derived';
import { defaultLeafOpen, type Project, type SmartDevice, type Wall, type WifiAp, type WifiStandard } from '../model/schema';
import { boundsOf, pointInPolygon, type Vec2 } from '../model/vec';

/**
 * WLAN coverage estimate (#253, #354, #492)
 * -----------------------------------------
 * Simple indoor model: path loss after ITU-R P.1238 (L = 20·log10 f[MHz] + N·log10 d[m] − 28,
 * residential N = 28) plus an explicit loss for every wall, closed door and closed window the
 * straight line from the access point to the point crosses (multi-wall model in the style of COST 231).
 * A wall hit at a slant is crossed on a longer way and costs more (up to twice). ITU-R P.1238 itself
 * folds walls into N; the explicit wall losses make the plan matter, so the result is an ESTIMATE,
 * not a measurement. The wall values are rough guide values (see `WALL_SOURCES`), they depend on
 * material, moisture and metal content. The construction of a wall (Gipskarton, Ziegel, Beton …)
 * is used when it is entered, otherwise it is guessed from the thickness.
 */

export type WifiBand = '2.4' | '5' | '6';
export const BANDS: WifiBand[] = ['2.4', '5', '6'];
export const BAND_LABEL: Record<WifiBand, string> = { '2.4': '2,4 GHz', '5': '5 GHz', '6': '6 GHz' };
const FREQ_MHZ: Record<WifiBand, number> = { '2.4': 2437, '5': 5200, '6': 6100 };

/** Distance loss coefficient N for residential buildings (ITU-R P.1238). */
export const ITU_N = 28;
/** Assumed radiated power (EIRP, dBm) of a device without datasheet value: the EU limit at 2.4 GHz (100 mW). */
export const ASSUMED_TX_DBM = 20;
/**
 * EU limits of the radiated power (EIRP, dBm) used when no datasheet value is entered: 2.4 GHz 100 mW,
 * 5 GHz 200 mW (channels 36–64; 100–140 would allow more, most devices stay lower), 6 GHz indoor 200 mW.
 */
export const EU_EIRP_DBM: Record<WifiBand, number> = { '2.4': 20, '5': 23, '6': 23 };
/** Receiver antenna gain (dBi): a phone is assumed to have none. */
const RX_GAIN_DBI = 0;

/** Guide values for the loss (dB) of one crossing at a right angle. */
export const WALL_LOSS = {
  light: { '2.4': 3, '5': 4, '6': 5, label: 'Leichtbauwand/Gipskarton (bis 12,5 cm)' },
  aerated: { '2.4': 7, '5': 9, '6': 10, label: 'Porenbeton' },
  masonry: { '2.4': 10, '5': 12, '6': 14, label: 'Mauerwerk/Ziegel (bis 20 cm)' },
  masonryThick: { '2.4': 15, '5': 18, '6': 21, label: 'Mauerwerk/Ziegel (über 25 cm)' },
  concrete: { '2.4': 20, '5': 25, '6': 30, label: 'Massivwand/Stahlbeton (über 20 cm)' },
  door: { '2.4': 3, '5': 4, '6': 5, label: 'Tür (geschlossen)' },
  window: { '2.4': 3, '5': 4, '6': 5, label: 'Fenster (geschlossen)' },
  ceiling: { '2.4': 20, '5': 25, '6': 30, label: 'Geschossdecke (Stahlbeton)' },
} as const;
export type WallClass = keyof typeof WALL_LOSS;

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

/** Guide class of a wall: its construction when entered, else guessed from the thickness (m). */
export function wallClass(thickness: number, assembly?: Wall['assembly']): WallClass {
  if (assembly === 'drywall') return 'light';
  if (assembly === 'aerated') return 'aerated';
  if (assembly === 'concrete') return 'concrete';
  if (assembly === 'brick') return thickness > 0.25 ? 'masonryThick' : 'masonry';
  return thickness <= 0.125 ? 'light' : thickness <= 0.2 ? 'masonry' : 'concrete';
}

/** Loss of a wall of this thickness (m) and construction, crossed at a right angle. */
export function wallLossDb(thickness: number, band: WifiBand, assembly?: Wall['assembly']): number {
  return WALL_LOSS[wallClass(thickness, assembly)][band];
}

export interface Barrier {
  a: Vec2;
  dir: Vec2;
  length: number;
  /** loss of the solid wall per band */
  loss: Record<WifiBand, number>;
  openings: { s0: number; s1: number; loss: Record<WifiBand, number> }[];
}

const zero: Record<WifiBand, number> = { '2.4': 0, '5': 0, '6': 0 };
const bandsOf = (c: { '2.4': number; '5': number; '6': number }): Record<WifiBand, number> => ({ '2.4': c['2.4'], '5': c['5'], '6': c['6'] });

/** Wall centre lines with the loss of their openings (open door leaves, open windows and passages cost nothing). */
export function barriersOf(project: Project, derived: DerivedPlan): Barrier[] {
  const out: Barrier[] = [];
  for (const w of project.walls) {
    const fp = derived.footprints.get(w.id);
    if (!fp) continue;
    const openings = (derived.openings.get(w.id) ?? []).map((r) => {
      const open = r.opening.open ?? defaultLeafOpen(r.opening.kind);
      const loss = r.opening.kind === 'passage' || open ? zero : bandsOf(r.opening.kind === 'door' ? WALL_LOSS.door : WALL_LOSS.window);
      return { s0: r.s0, s1: r.s1, loss };
    });
    out.push({ a: fp.a, dir: fp.dir, length: fp.length, loss: bandsOf(WALL_LOSS[wallClass(fp.thickness, w.assembly)]), openings });
  }
  return out;
}

/** A wall hit at a slant is crossed on a longer way: loss × 1/cos, at most twice the loss. */
const MAX_SLANT = 2;

/** Sum of the losses (dB) of all barriers the segment from→to crosses. */
export function crossingLossDb(from: Vec2, to: Vec2, barriers: Barrier[], band: WifiBand): number {
  const rx = to.x - from.x;
  const ry = to.y - from.y;
  const rl = Math.hypot(rx, ry);
  if (rl < 1e-9) return 0;
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
    const base = hit ? hit.loss[band] : b.loss[band];
    if (!base) continue;
    // cos of the angle between ray and wall normal = |ray × wallDir| / |ray|
    const cos = Math.abs(rx * b.dir.y - ry * b.dir.x) / rl;
    loss += base * Math.min(MAX_SLANT, 1 / Math.max(cos, 1 / MAX_SLANT));
  }
  return loss;
}

/** Path loss (dB) over `dist` metres without walls (ITU-R P.1238). */
export function freeLossDb(dist: number, band: WifiBand): number {
  return 20 * Math.log10(FREQ_MHZ[band]) + ITU_N * Math.log10(Math.max(dist, 1)) - 28;
}

// ---------------------------------------------------------------------------------------------
// Access points: role, WLAN standard, bands, channels (#492)
// ---------------------------------------------------------------------------------------------

export type ApRole = NonNullable<WifiAp['role']>;
export type Backhaul = NonNullable<WifiAp['backhaul']>;
export const ROLE_LABEL: Record<ApRole, string> = { router: 'Hauptrouter (Internet)', ap: 'Access Point (LAN-Kabel)', mesh: 'Mesh-Knoten', repeater: 'Repeater (Steckdose)' };
export const BACKHAUL_LABEL: Record<Backhaul, string> = {
  wired: 'LAN-Kabel (oder Powerline)',
  'wireless-dedicated': 'Funk, eigenes Band (Tri-Band-Mesh)',
  'wireless-shared': 'Funk, gleiches Band wie die Geräte (Repeater, Dual-Band-Mesh)',
};

export interface StandardInfo {
  label: string;
  bands: WifiBand[];
  /** highest modulation step (index into MCS_TABLE) */
  maxMcs: number;
  /** PHY rate factor against 802.11ax at the same MCS (older coding, longer guard interval) */
  factor: number;
  /** widest channel (MHz) per band */
  maxWidth: Record<WifiBand, number>;
}
/**
 * Device classes by WLAN standard (no products): bands, highest modulation and widest channel
 * after IEEE 802.11n/ac/ax/be. A WLAN 5 router uses WLAN 4 at 2.4 GHz.
 */
export const STANDARDS: Record<WifiStandard, StandardInfo> = {
  wifi4: { label: 'WLAN 4 (802.11n, älteres Gerät, nur 2,4 GHz)', bands: ['2.4'], maxMcs: 7, factor: 0.84, maxWidth: { '2.4': 20, '5': 40, '6': 0 } },
  wifi5: { label: 'WLAN 5 (802.11ac, 2,4 + 5 GHz)', bands: ['2.4', '5'], maxMcs: 9, factor: 0.88, maxWidth: { '2.4': 20, '5': 80, '6': 0 } },
  wifi6: { label: 'WLAN 6 (802.11ax, 2,4 + 5 GHz)', bands: ['2.4', '5'], maxMcs: 11, factor: 1, maxWidth: { '2.4': 20, '5': 160, '6': 0 } },
  wifi6e: { label: 'WLAN 6E (802.11ax, 2,4 + 5 + 6 GHz)', bands: ['2.4', '5', '6'], maxMcs: 11, factor: 1, maxWidth: { '2.4': 20, '5': 160, '6': 160 } },
  wifi7: { label: 'WLAN 7 (802.11be, 2,4 + 5 + 6 GHz)', bands: ['2.4', '5', '6'], maxMcs: 13, factor: 1, maxWidth: { '2.4': 20, '5': 160, '6': 320 } },
};
export const DEFAULT_STANDARD: WifiStandard = 'wifi6';

/** Default channel width (MHz) of a band when the user sets none. */
const DEFAULT_WIDTH: Record<WifiBand, number> = { '2.4': 20, '5': 80, '6': 160 };

export interface AccessPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  role: ApRole;
  standard: WifiStandard;
  streams: number;
  bands: WifiBand[];
  tx: Record<WifiBand, number>;
  /** entered channel per band (undefined = automatic) */
  channel: Partial<Record<WifiBand, number>>;
  width: Record<WifiBand, number>;
  backhaul: Backhaul;
  uplinkId?: string;
  model?: string;
}

export const defaultBackhaul = (role: ApRole): Backhaul => (role === 'router' || role === 'ap' ? 'wired' : 'wireless-shared');

export function accessPoint(d: SmartDevice): AccessPoint {
  const w = d.wifi ?? {};
  const role = w.role ?? 'router';
  const standard = w.standard ?? DEFAULT_STANDARD;
  const info = STANDARDS[standard];
  const tx = { '2.4': EU_EIRP_DBM['2.4'], '5': EU_EIRP_DBM['5'], '6': EU_EIRP_DBM['6'] };
  if (w.txDbm !== undefined) for (const b of BANDS) tx[b] = Math.min(w.txDbm, EU_EIRP_DBM[b] + 10);
  const width = { '2.4': 20, '5': Math.min(w.width5 ?? DEFAULT_WIDTH['5'], info.maxWidth['5'] || 20), '6': Math.min(DEFAULT_WIDTH['6'], info.maxWidth['6'] || 20) };
  return {
    id: d.id,
    name: d.name,
    x: d.x,
    y: d.y,
    role,
    standard,
    streams: w.streams ?? 2,
    bands: info.bands,
    tx,
    channel: { '2.4': w.ch24, '5': w.ch5, '6': w.ch6 },
    width,
    backhaul: role === 'router' ? 'wired' : (w.backhaul ?? defaultBackhaul(role)),
    uplinkId: role === 'router' ? undefined : w.uplinkId,
    model: w.model,
  };
}

export const accessPoints = (project: Project): AccessPoint[] => project.devices.filter(isRouter).map(accessPoint);

export interface WifiSource {
  id: string;
  name: string;
  x: number;
  y: number;
  txDbm: number;
}

/** Access points that send on `band` (default 2.4 GHz), with their power there. */
export function wifiSources(project: Project, band: WifiBand = '2.4'): WifiSource[] {
  return accessPoints(project)
    .filter((a) => a.bands.includes(band))
    .map((a) => ({ id: a.id, name: a.name, x: a.x, y: a.y, txDbm: a.tx[band] }));
}

/** Received signal (dBm) of a source with `txDbm` at `to`. */
export function signalDbm(from: Vec2, txDbm: number, to: Vec2, barriers: Barrier[], band: WifiBand): number {
  return txDbm + RX_GAIN_DBI - freeLossDb(Math.hypot(to.x - from.x, to.y - from.y), band) - crossingLossDb(from, to, barriers, band);
}

export interface RoomCells {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  /** cell index → room id ('' outside) */
  room: string[];
  /** indices of the cells inside a room */
  inside: number[];
}

/** Grid over all rooms of the storey. */
export function roomCells(project: Project, derived: DerivedPlan, cell = 0.25): RoomCells | null {
  const rooms = project.rooms.map((r) => ({ id: r.id, poly: derived.rooms.get(r.id)?.interior })).filter((r): r is { id: string; poly: Vec2[] } => !!r.poly);
  const b = boundsOf(rooms.flatMap((r) => r.poly));
  if (!b) return null;
  const cols = Math.max(1, Math.ceil((b.maxX - b.minX) / cell));
  const rows = Math.max(1, Math.ceil((b.maxY - b.minY) / cell));
  const room: string[] = new Array(cols * rows).fill('');
  const inside: number[] = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = { x: b.minX + (i + 0.5) * cell, y: b.minY + (j + 0.5) * cell };
      const r = rooms.find((x) => pointInPolygon(p, x.poly));
      if (!r) continue;
      room[j * cols + i] = r.id;
      inside.push(j * cols + i);
    }
  }
  return { cell, minX: b.minX, minY: b.minY, cols, rows, room, inside };
}

export const cellCentre = (g: Pick<RoomCells, 'cell' | 'minX' | 'minY' | 'cols'>, k: number): Vec2 => ({ x: g.minX + ((k % g.cols) + 0.5) * g.cell, y: g.minY + (Math.floor(k / g.cols) + 0.5) * g.cell });

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
 * Signal strength (dBm, strongest access point counts) on a grid over all rooms. A point reaches the
 * access point through the straight line only; no reflections, no floors above or below.
 */
export function wifiGrid(project: Project, derived: DerivedPlan, band: WifiBand, cell = 0.25): WifiGrid | null {
  const sources = wifiSources(project, band);
  if (!sources.length) return null;
  const cells = roomCells(project, derived, cell);
  if (!cells) return null;
  const barriers = barriersOf(project, derived);
  const dbm = new Float32Array(cells.cols * cells.rows).fill(NaN);
  for (const k of cells.inside) {
    const p = cellCentre(cells, k);
    let best = -Infinity;
    for (const s of sources) best = Math.max(best, signalDbm(s, s.txDbm, p, barriers, band));
    dbm[k] = best;
  }
  return { cell, minX: cells.minX, minY: cells.minY, cols: cells.cols, rows: cells.rows, dbm, room: cells.room };
}

export interface RoomWifi {
  roomId: string;
  /** typical value: median of the room's cells (dBm) */
  dbm: number;
  level: WifiLevel;
  /** weakest 10 % of the floor (dBm), shows dead corners */
  weakDbm: number;
}

/** Median and weakest tenth of a value per room. */
export function perRoom(grid: { room: string[]; values: ArrayLike<number> }, project: Project): { roomId: string; median: number; low: number }[] {
  const out: { roomId: string; median: number; low: number }[] = [];
  for (const r of project.rooms) {
    const v: number[] = [];
    grid.room.forEach((id, k) => id === r.id && !Number.isNaN(grid.values[k]) && v.push(grid.values[k]));
    if (!v.length) continue;
    v.sort((a, b) => a - b);
    out.push({ roomId: r.id, median: v[Math.floor(v.length / 2)], low: v[Math.floor(v.length * 0.1)] });
  }
  return out;
}

export function roomWifi(grid: WifiGrid | null, project: Project): RoomWifi[] {
  if (!grid) return [];
  return perRoom({ room: grid.room, values: grid.dbm }, project).map((r) => ({ roomId: r.roomId, dbm: r.median, level: levelOf(r.median), weakDbm: r.low }));
}

/** A 5 GHz signal from this level on carries the higher speed; below it 2.4 GHz is the safer choice. */
export const BAND5_MIN_DBM = -67;
export const BAND_COLOR: Record<WifiBand, string> = { '2.4': '#8b5cf6', '5': '#0ea5e9', '6': '#14b8a6' };

export interface BandRecommendation {
  roomId: string;
  band: WifiBand;
  dbm24: number;
  dbm5: number;
  /** Distance (m) and wall loss (dB) from the nearest access point to a typical point of the room. */
  dist: number;
  wallDb24: number;
  wallDb5: number;
  reason: string;
}

/**
 * Which band is better in each room? 5 GHz when it still gets at least BAND5_MIN_DBM there
 * (more speed), otherwise 2.4 GHz (more range, less wall loss). The reason names distance and walls.
 */
export function recommendBands(project: Project, derived: DerivedPlan): BandRecommendation[] {
  const g24 = wifiGrid(project, derived, '2.4');
  const g5 = wifiGrid(project, derived, '5');
  if (!g24 || !g5) return [];
  const r24 = roomWifi(g24, project);
  const r5 = roomWifi(g5, project);
  const sources = wifiSources(project, '5');
  const barriers = barriersOf(project, derived);
  const out: BandRecommendation[] = [];
  for (const a of r24) {
    const b = r5.find((x) => x.roomId === a.roomId);
    if (!b) continue;
    // typical point: the room cell closest to the mean of the room's cells
    const cells: Vec2[] = [];
    g24.room.forEach((id, k) => id === a.roomId && cells.push(cellCentre(g24, k)));
    const mx = cells.reduce((t, c) => t + c.x, 0) / cells.length;
    const my = cells.reduce((t, c) => t + c.y, 0) / cells.length;
    const pt = cells.reduce((best, c) => (Math.hypot(c.x - mx, c.y - my) < Math.hypot(best.x - mx, best.y - my) ? c : best));
    const src = sources.reduce((best, s) => (Math.hypot(s.x - pt.x, s.y - pt.y) < Math.hypot(best.x - pt.x, best.y - pt.y) ? s : best));
    const dist = Math.hypot(src.x - pt.x, src.y - pt.y);
    const wallDb24 = crossingLossDb(src, pt, barriers, '2.4');
    const wallDb5 = crossingLossDb(src, pt, barriers, '5');
    const use5 = b.dbm >= BAND5_MIN_DBM;
    const where = `${dist.toFixed(1).replace('.', ',')} m Abstand, Wände auf dem Weg ${Math.round(wallDb5)} dB bei 5 GHz (${Math.round(wallDb24)} dB bei 2,4 GHz)`;
    const reason = use5
      ? `5 GHz reicht hier (${Math.round(b.dbm)} dBm) und ist schneller. ${where}.`
      : `5 GHz ist hier zu schwach (${Math.round(b.dbm)} dBm), 2,4 GHz kommt mit ${Math.round(a.dbm)} dBm besser an. ${where}.`;
    out.push({ roomId: a.roomId, band: use5 ? '5' : '2.4', dbm24: a.dbm, dbm5: b.dbm, dist, wallDb24, wallDb5, reason });
  }
  return out;
}
