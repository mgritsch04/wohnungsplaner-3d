import type { DerivedPlan } from '../model/derived';
import type { Project, WifiClient, WifiClientType, WifiNeighbor } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { productById } from './catalog';
import {
  accessPoints,
  barriersOf,
  BANDS,
  BAND_LABEL,
  cellCentre,
  EU_EIRP_DBM,
  freeLossDb,
  perRoom,
  roomCells,
  signalDbm,
  STANDARDS,
  WALL_LOSS,
  type AccessPoint,
  type Barrier,
  type RoomCells,
  type WifiBand,
} from './wifi';

/**
 * WLAN planning (#492): data rate, neighbour networks, channels, mesh/repeater links, own devices
 * and suggestions where a repeater or mesh node helps. Builds on the signal model in `wifi.ts`.
 * Everything is an ESTIMATE; the assumptions are named in the panel ("Wie wird gerechnet?").
 */

// ---------------------------------------------------------------------------------------------
// Data rate
// ---------------------------------------------------------------------------------------------

/**
 * Modulation steps (MCS 0–13): needed signal-to-noise ratio (dB, rough guide values) and PHY rate per
 * spatial stream at 20 MHz after IEEE 802.11ax (0,8 µs guard interval). MCS 12/13 only with WLAN 7.
 */
export const MCS_TABLE: { snr: number; mbps: number }[] = [
  { snr: 5, mbps: 8.6 },
  { snr: 8, mbps: 17.2 },
  { snr: 11, mbps: 25.8 },
  { snr: 14, mbps: 34.4 },
  { snr: 17, mbps: 51.6 },
  { snr: 21, mbps: 68.8 },
  { snr: 23, mbps: 77.4 },
  { snr: 25, mbps: 86 },
  { snr: 29, mbps: 103.2 },
  { snr: 31, mbps: 114.7 },
  { snr: 34, mbps: 129 },
  { snr: 37, mbps: 143.4 },
  { snr: 40, mbps: 154.9 },
  { snr: 42, mbps: 172.1 },
];
/** PHY rate of a wider channel against 20 MHz (802.11ax tone counts). */
const WIDTH_SCALE: Record<number, number> = { 20: 1, 40: 2, 80: 4.19, 160: 8.37, 320: 16.74 };
/** Share of the PHY rate that arrives as usable data (protocol overhead), assumption. */
export const MAC_EFFICIENCY = 0.65;
/** Thermal noise of a 20 MHz channel plus 7 dB receiver noise figure. */
export const NOISE_20_DBM = -94;
export const noiseFloorDbm = (width: number) => NOISE_20_DBM + 10 * Math.log10(width / 20);

/** Usable rate (Mbit/s) at this signal-to-noise ratio, before sharing the air time. */
export function usableMbps(sinr: number, width: number, streams: number, standard: AccessPoint['standard'], band: WifiBand): number {
  const std = standard === 'wifi5' && band === '2.4' ? STANDARDS.wifi4 : STANDARDS[standard];
  let rate = 0;
  for (let i = 0; i <= std.maxMcs; i++) if (sinr >= MCS_TABLE[i].snr) rate = MCS_TABLE[i].mbps;
  return rate * (WIDTH_SCALE[width] ?? width / 20) * streams * std.factor * MAC_EFFICIENCY;
}

// ---------------------------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------------------------

/** Channels without overlap a router can pick from, per band and width (EU). */
export function channelChoices(band: WifiBand, width: number): number[] {
  if (band === '2.4') return [1, 6, 11];
  if (band === '5') {
    if (width >= 160) return [36, 100];
    if (width >= 80) return [36, 52, 100, 116];
    if (width >= 40) return [36, 44, 52, 60, 100, 108, 116, 124, 132];
    return [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140];
  }
  if (width >= 160) return [1, 33, 65];
  if (width >= 80) return [1, 17, 33, 49, 65, 81];
  const out: number[] = [];
  for (let c = 1; c <= 93; c += 4) out.push(c);
  return out;
}

/** 5 GHz channels 52–144 need radar detection (DFS): a router may switch away for a minute. */
export const isDfs = (band: WifiBand, ch: number) => band === '5' && ch >= 52 && ch <= 144;

/** Frequency range (MHz) a channel of this width occupies. */
export function channelRange(band: WifiBand, ch: number, width: number): [number, number] {
  if (band === '2.4') {
    const c = 2407 + 5 * ch;
    return [c - 10, c + 10];
  }
  const k = Math.max(1, Math.round(width / 20));
  if (band === '5') {
    const base = ch >= 149 ? 149 : 36;
    const first = base + Math.floor(Math.floor((ch - base) / 4) / k) * k * 4;
    const lo = 5000 + 5 * first - 10;
    return [lo, lo + width];
  }
  const first = 1 + Math.floor(Math.floor((ch - 1) / 4) / k) * k * 4;
  const lo = 5950 + 5 * first - 10;
  return [lo, lo + width];
}

/** Share of channel a's range that channel b covers (0 = no overlap, 1 = same range). */
export function channelOverlap(band: WifiBand, a: { ch: number; width: number }, b: { ch: number; width: number }): number {
  const [a0, a1] = channelRange(band, a.ch, a.width);
  const [b0, b1] = channelRange(band, b.ch, b.width);
  return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / (a1 - a0);
}

// ---------------------------------------------------------------------------------------------
// Neighbour networks
// ---------------------------------------------------------------------------------------------

export const LOAD_SHARE: Record<WifiNeighbor['load'], number> = { low: 0.1, medium: 0.25, high: 0.5 };
export const LOAD_LABEL: Record<WifiNeighbor['load'], string> = { low: 'wenig genutzt', medium: 'normal genutzt', high: 'stark genutzt (Streaming, Homeoffice)' };
export const FLOOR_LABEL: Record<WifiNeighbor['floor'], string> = { same: 'gleiches Stockwerk', above: 'Wohnung darüber', below: 'Wohnung darunter' };
/** Assumption without a measurement: one more wall or piece of furniture on the neighbour's side. */
export const NEIGHBOR_EXTRA_DB = 5;
/** Height between storeys (m) for a neighbour above or below. */
const STOREY_M = 2.8;
/** A WLAN receiver waits for a foreign network on the same channel from this strength on (preamble detection). */
export const CCA_PREAMBLE_DBM = -82;
/** … and for any energy on a partly overlapping channel from this strength on. */
export const CCA_ENERGY_DBM = -62;

export interface NeighborSource {
  id: string;
  name: string;
  x: number;
  y: number;
  band: WifiBand;
  channel: number;
  width: number;
  floor: WifiNeighbor['floor'];
  load: number;
  /** correction (dB) from the measurement, 0 without one */
  offsetDb: number;
  measured: boolean;
}

function neighborRaw(n: Pick<NeighborSource, 'x' | 'y' | 'band' | 'floor'>, p: Vec2, barriers: Barrier[]): number {
  const tx = EU_EIRP_DBM[n.band];
  if (n.floor !== 'same') {
    // through the ceiling, the walls of this storey are not on the way
    const d = Math.hypot(p.x - n.x, p.y - n.y, STOREY_M);
    return tx - freeLossDb(d, n.band) - WALL_LOSS.ceiling[n.band];
  }
  return signalDbm(n, tx, p, barriers, n.band) - NEIGHBOR_EXTRA_DB;
}

export const neighborDbm = (n: NeighborSource, p: Vec2, barriers: Barrier[]) => neighborRaw(n, p, barriers) + n.offsetDb;

/** Closest point inside a room to `p` (cell centre). */
function nearestInside(cells: RoomCells | null, p: Vec2): Vec2 {
  if (!cells || !cells.inside.length) return p;
  let best = cellCentre(cells, cells.inside[0]);
  for (const k of cells.inside) {
    const c = cellCentre(cells, k);
    if (Math.hypot(c.x - p.x, c.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = c;
  }
  return best;
}

export function neighborSources(project: Project, barriers: Barrier[], cells: RoomCells | null): NeighborSource[] {
  return project.wifiNeighbors.map((n) => {
    const src = { id: n.id, name: n.name, x: n.x, y: n.y, band: n.band, channel: n.channel, width: n.band === '2.4' ? 20 : n.width, floor: n.floor, load: LOAD_SHARE[n.load], offsetDb: 0, measured: false };
    if (n.measuredDbm === undefined) return src;
    const at = n.measuredAt ?? nearestInside(cells, n);
    return { ...src, offsetDb: n.measuredDbm - neighborRaw(src, at, barriers), measured: true };
  });
}

// ---------------------------------------------------------------------------------------------
// Network: channels, links between access points
// ---------------------------------------------------------------------------------------------

export interface ApChannel {
  ch: number;
  width: number;
  /** chosen by the estimate (router on "automatisch") */
  auto: boolean;
  /** best channel by the estimate and its cost against the used one */
  best: number;
  cost: number;
  bestCost: number;
}

export interface ApLink {
  uplinkId: string;
  /** band of the connection (dedicated: one band; shared: per band, see `perBand`) */
  band: WifiBand;
  dbm: number;
  mbps: number;
  perBand: Partial<Record<WifiBand, { dbm: number; mbps: number }>>;
}

export interface WifiNet {
  project: Project;
  barriers: Barrier[];
  cells: RoomCells | null;
  aps: AccessPoint[];
  neighbors: NeighborSource[];
  channels: Map<string, Partial<Record<WifiBand, ApChannel>>>;
  links: Map<string, ApLink>;
  /** highest rate (Mbit/s) that reaches each access point from the internet (Infinity = no limit known) */
  cap: Map<string, number>;
  internetMbps: number;
}

/** Own access points other than `a` that also send on band `b` and are not the same radio as `a`. */
const OWN_LOAD = 0.15;

function contention(net: Pick<WifiNet, 'neighbors' | 'barriers'>, band: WifiBand, chan: { ch: number; width: number }, p: Vec2, own: { ap: AccessPoint; ch: ApChannel }[], skip: Set<string>, withNeighbors = true) {
  let busy = 0;
  let interMw = 0;
  const add = (dbm: number, ch: number, width: number, load: number) => {
    const ov = channelOverlap(band, chan, { ch, width });
    if (ov <= 0) return;
    const same = band === '2.4' ? ch === chan.ch : true;
    if (same) {
      if (dbm >= CCA_PREAMBLE_DBM) busy += load * ov;
    } else {
      // partly overlapping 2.4 GHz channel: its energy counts as noise, strong ones also block
      interMw += Math.pow(10, (dbm + 10 * Math.log10(ov)) / 10);
      if (dbm >= CCA_ENERGY_DBM) busy += load * ov;
    }
  };
  if (withNeighbors) for (const n of net.neighbors) if (n.band === band) add(neighborDbm(n, p, net.barriers), n.channel, n.width, n.load);
  for (const o of own) if (!skip.has(o.ap.id)) add(signalDbm(o.ap, o.ap.tx[band], p, net.barriers, band), o.ch.ch, o.ch.width, OWN_LOAD);
  return { busy: Math.min(busy, 0.9), interMw };
}

function channelCost(net: Pick<WifiNet, 'neighbors' | 'barriers'>, band: WifiBand, ch: number, width: number, at: Vec2, own: { ap: AccessPoint; ch: ApChannel }[], skip: Set<string>): number {
  const c = contention(net, band, { ch, width }, at, own, skip);
  return c.busy + 10 * Math.log10(1 + c.interMw / Math.pow(10, noiseFloorDbm(width) / 10)) / 10 + (isDfs(band, ch) ? 0.005 : 0);
}

/** Own APs that share the radio channel with `a` (a shared repeater and the AP it repeats). */
function sameRadio(aps: AccessPoint[], links: Map<string, ApLink>, a: AccessPoint): Set<string> {
  const out = new Set([a.id]);
  const shared = (x: AccessPoint) => x.backhaul === 'wireless-shared';
  let grew = true;
  while (grew) {
    grew = false;
    for (const x of aps) {
      if (out.has(x.id)) continue;
      const up = links.get(x.id)?.uplinkId;
      if ((shared(x) && up && out.has(up)) || [...out].some((id) => { const y = aps.find((z) => z.id === id)!; return shared(y) && links.get(y.id)?.uplinkId === x.id; })) {
        out.add(x.id);
        grew = true;
      }
    }
  }
  return out;
}

export function buildNet(project: Project, derived: DerivedPlan, cell = 0.25, reuse?: Pick<WifiNet, 'barriers' | 'cells'>): WifiNet {
  const barriers = reuse?.barriers ?? barriersOf(project, derived);
  const cells = reuse ? reuse.cells : roomCells(project, derived, cell);
  const aps = accessPoints(project);
  const neighbors = neighborSources(project, barriers, cells);
  const internetMbps = project.wifiInternetMbps ?? Infinity;
  const net: WifiNet = { project, barriers, cells, aps, neighbors, channels: new Map(), links: new Map(), cap: new Map(), internetMbps };

  // 1. links: wired APs hang on the internet, wireless ones on their uplink (chosen or the strongest reachable)
  const roots = aps.filter((a) => a.backhaul === 'wired');
  for (const a of roots) net.cap.set(a.id, internetMbps);
  let pending = aps.filter((a) => a.backhaul !== 'wired');
  for (let guard = 0; pending.length && guard < aps.length + 1; guard++) {
    const left: AccessPoint[] = [];
    for (const a of pending) {
      const placed = aps.filter((x) => x.id !== a.id && net.cap.has(x.id));
      const wanted = a.uplinkId ? placed.find((x) => x.id === a.uplinkId) : undefined;
      if (a.uplinkId && !wanted && aps.some((x) => x.id === a.uplinkId && x.id !== a.id) && guard < aps.length) {
        left.push(a); // its uplink is not resolved yet
        continue;
      }
      const up = wanted ?? strongestUplink(net, a, placed);
      if (!up) continue;
      const link = linkOf(net, a, up);
      net.links.set(a.id, link);
      net.cap.set(a.id, Math.min(net.cap.get(up.id) ?? Infinity, a.backhaul === 'wireless-dedicated' ? link.mbps : Infinity));
    }
    pending = left;
  }

  // 2. channels: entered or automatic (freest at the AP); a shared repeater uses its uplink's channel
  const assigned: { ap: AccessPoint; band: WifiBand; ch: ApChannel }[] = [];
  const order = [...aps].sort((a, b) => Number(a.backhaul === 'wireless-shared') - Number(b.backhaul === 'wireless-shared'));
  for (const a of order) {
    const per: Partial<Record<WifiBand, ApChannel>> = {};
    const radio = sameRadio(aps, net.links, a);
    for (const band of a.bands) {
      const width = a.width[band];
      const own = assigned.filter((x) => x.band === band).map((x) => ({ ap: x.ap, ch: x.ch }));
      const choices = channelChoices(band, width);
      const costs = choices.map((ch) => channelCost(net, band, ch, width, a, own, radio));
      const bi = costs.indexOf(Math.min(...costs));
      const upCh = a.backhaul === 'wireless-shared' ? net.channels.get(net.links.get(a.id)?.uplinkId ?? '')?.[band] : undefined;
      const entered = a.channel[band];
      const ch = upCh ? upCh.ch : (entered ?? choices[bi]);
      const cost = upCh || entered !== undefined ? channelCost(net, band, ch, width, a, own, radio) : costs[bi];
      per[band] = { ch, width, auto: !upCh && entered === undefined, best: choices[bi], cost, bestCost: costs[bi] };
      assigned.push({ ap: a, band, ch: per[band]! });
    }
    net.channels.set(a.id, per);
  }
  // links of shared repeaters: now with the contention on their channel
  for (const a of aps) {
    const l = net.links.get(a.id);
    const up = l && aps.find((x) => x.id === l.uplinkId);
    if (l && up) net.links.set(a.id, linkOf(net, a, up));
  }
  return net;
}

function strongestUplink(net: WifiNet, a: AccessPoint, placed: AccessPoint[]): AccessPoint | undefined {
  let best: AccessPoint | undefined;
  let bestDbm = -Infinity;
  for (const u of placed) {
    for (const band of u.bands.filter((b) => a.bands.includes(b))) {
      const d = signalDbm(u, u.tx[band], a, net.barriers, band) + (band === '2.4' ? -6 : 0); // prefer the fast bands
      if (d > bestDbm) {
        bestDbm = d;
        best = u;
      }
    }
  }
  return best;
}

/** Radio link between an access point and its uplink. */
function linkOf(net: WifiNet, a: AccessPoint, up: AccessPoint): ApLink {
  const perBand: ApLink['perBand'] = {};
  const own = net.aps.flatMap((x) => Object.entries(net.channels.get(x.id) ?? {}).map(([band, ch]) => ({ ap: x, band: band as WifiBand, ch: ch! })));
  for (const band of up.bands.filter((b) => a.bands.includes(b))) {
    const dbm = signalDbm(up, up.tx[band], a, net.barriers, band);
    const width = Math.min(a.width[band], up.width[band]);
    const ch = net.channels.get(up.id)?.[band];
    const c = ch ? contention(net, band, { ch: ch.ch, width }, a, own.filter((o) => o.band === band), new Set([a.id, up.id])) : { busy: 0, interMw: 0 };
    const sinr = dbm - 10 * Math.log10(Math.pow(10, noiseFloorDbm(width) / 10) + c.interMw);
    const std = STANDARDS[a.standard].maxMcs < STANDARDS[up.standard].maxMcs ? a.standard : up.standard;
    const mbps = usableMbps(sinr, width, Math.min(a.streams, up.streams), std, band) * (1 - c.busy);
    perBand[band] = { dbm, mbps };
  }
  const bands = Object.keys(perBand) as WifiBand[];
  const band = bands.reduce((b, x) => (perBand[x]!.mbps > perBand[b]!.mbps ? x : b), bands[0] ?? '2.4');
  return { uplinkId: up.id, band, dbm: perBand[band]?.dbm ?? -Infinity, mbps: perBand[band]?.mbps ?? 0, perBand };
}

// ---------------------------------------------------------------------------------------------
// Evaluation at a point
// ---------------------------------------------------------------------------------------------

export interface ClientProfile {
  bands: WifiBand[];
  streams: number;
}
export const ANY_CLIENT: ClientProfile = { bands: ['2.4', '5', '6'], streams: 2 };

export interface PointWifi {
  apId: string | null;
  band: WifiBand | null;
  dbm: number;
  mbps: number;
  /** air time taken by neighbours on the used channel (0..0.9) */
  busy: number;
}

/** Rate (Mbit/s) a client at `p` gets from access point `a` on `band` with signal `dbm`. */
function rateVia(net: WifiNet, a: AccessPoint, band: WifiBand, p: Vec2, dbm: number, streams: number, withNeighbors = true): { mbps: number; busy: number } {
  const ch = net.channels.get(a.id)?.[band];
  if (!ch) return { mbps: 0, busy: 0 };
  const own = net.aps.flatMap((x) => (x.id === a.id ? [] : [{ ap: x, ch: net.channels.get(x.id)?.[band] }])).filter((o): o is { ap: AccessPoint; ch: ApChannel } => !!o.ch);
  const c = contention(net, band, ch, p, own, sameRadio(net.aps, net.links, a), withNeighbors);
  const sinr = dbm - 10 * Math.log10(Math.pow(10, noiseFloorDbm(ch.width) / 10) + c.interMw);
  let mbps = usableMbps(sinr, ch.width, Math.min(streams, a.streams), a.standard, band) * (1 - c.busy);
  const link = net.links.get(a.id);
  if (link && a.backhaul === 'wireless-shared') {
    const up = link.perBand[band]?.mbps ?? 0;
    // the same radio carries every packet twice: to the uplink and to the client
    mbps = up > 0 && mbps > 0 ? 1 / (1 / up + 1 / mbps) : 0;
    const upCap = net.cap.get(link.uplinkId) ?? Infinity;
    mbps = Math.min(mbps, upCap);
  } else mbps = Math.min(mbps, net.cap.get(a.id) ?? (a.backhaul === 'wired' ? net.internetMbps : 0));
  return { mbps, busy: c.busy };
}

/** Best connection a client with `profile` gets at `p` (the strongest rate over access points and bands). */
export function wifiAt(net: WifiNet, p: Vec2, profile: ClientProfile = ANY_CLIENT, only?: WifiBand, withNeighbors = true): PointWifi {
  let best: PointWifi = { apId: null, band: null, dbm: -Infinity, mbps: 0, busy: 0 };
  for (const a of net.aps) {
    for (const band of a.bands) {
      if (!profile.bands.includes(band) || (only && band !== only)) continue;
      const dbm = signalDbm(a, a.tx[band], p, net.barriers, band);
      if (dbm < -92) {
        if (dbm > best.dbm && !best.apId) best = { ...best, dbm };
        continue;
      }
      const r = rateVia(net, a, band, p, dbm, profile.streams, withNeighbors);
      if (r.mbps > best.mbps || (r.mbps === best.mbps && dbm > best.dbm)) best = { apId: a.id, band, dbm, mbps: r.mbps, busy: r.busy };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Grids for the plan
// ---------------------------------------------------------------------------------------------

export type HeatBand = WifiBand | 'best';
export type HeatMode = 'signal' | 'rate' | 'interference';

export interface RateGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  room: string[];
  /** usable rate (Mbit/s), NaN outside */
  mbps: Float32Array;
  /** share of the rate lost to neighbour networks (0..1), NaN outside */
  loss: Float32Array;
  /** strongest signal (dBm) of the used band, NaN outside */
  dbm: Float32Array;
}

export function rateGrid(net: WifiNet, band: HeatBand, withLoss = false): RateGrid | null {
  const c = net.cells;
  if (!c || !net.aps.length) return null;
  const n = c.cols * c.rows;
  const mbps = new Float32Array(n).fill(NaN);
  const loss = new Float32Array(n).fill(NaN);
  const dbm = new Float32Array(n).fill(NaN);
  const only = band === 'best' ? undefined : band;
  for (const k of c.inside) {
    const p = cellCentre(c, k);
    const w = wifiAt(net, p, ANY_CLIENT, only);
    mbps[k] = w.mbps;
    dbm[k] = w.dbm;
    if (withLoss) {
      const free = net.neighbors.length ? wifiAt(net, p, ANY_CLIENT, only, false).mbps : w.mbps;
      loss[k] = free > 0 ? Math.max(0, 1 - w.mbps / free) : 0;
    }
  }
  return { cell: c.cell, minX: c.minX, minY: c.minY, cols: c.cols, rows: c.rows, room: c.room, mbps, loss, dbm };
}

export type RateLevel = 'fast' | 'good' | 'ok' | 'slow' | 'none';
export const RATE_ORDER: RateLevel[] = ['fast', 'good', 'ok', 'slow', 'none'];
export const RATE_MIN: Record<Exclude<RateLevel, 'none'>, number> = { fast: 200, good: 50, ok: 20, slow: 5 };
export const RATE_LABEL: Record<RateLevel, string> = { fast: 'sehr schnell', good: 'schnell', ok: 'reicht für Video', slow: 'langsam', none: 'kaum nutzbar' };
export const RATE_COLOR: Record<RateLevel, string> = { fast: '#15803d', good: '#4ade80', ok: '#eab308', slow: '#f97316', none: '#dc2626' };
export const rateLevel = (m: number): RateLevel => (m >= RATE_MIN.fast ? 'fast' : m >= RATE_MIN.good ? 'good' : m >= RATE_MIN.ok ? 'ok' : m >= RATE_MIN.slow ? 'slow' : 'none');

export type LossLevel = 'low' | 'some' | 'strong' | 'severe';
export const LOSS_ORDER: LossLevel[] = ['low', 'some', 'strong', 'severe'];
export const LOSS_LABEL: Record<LossLevel, string> = { low: 'kaum gestört', some: 'spürbar gestört (bis 30 %)', strong: 'stark gestört (bis 60 %)', severe: 'sehr stark gestört' };
export const LOSS_COLOR: Record<LossLevel, string> = { low: '#e2e8f0', some: '#fde047', strong: '#fb923c', severe: '#dc2626' };
export const lossLevel = (l: number): LossLevel => (l < 0.1 ? 'low' : l < 0.3 ? 'some' : l < 0.6 ? 'strong' : 'severe');

export const fmtMbps = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} Gbit/s` : m >= 10 ? `${Math.round(m)} Mbit/s` : m > 0 ? `${m.toFixed(1).replace('.', ',')} Mbit/s` : '0 Mbit/s');

export interface RoomRate {
  roomId: string;
  mbps: number;
  weakMbps: number;
  dbm: number;
  level: RateLevel;
}

export function roomRates(grid: RateGrid | null, project: Project): RoomRate[] {
  if (!grid) return [];
  const sig = new Map(perRoom({ room: grid.room, values: grid.dbm }, project).map((r) => [r.roomId, r.median]));
  return perRoom({ room: grid.room, values: grid.mbps }, project).map((r) => ({ roomId: r.roomId, mbps: r.median, weakMbps: r.low, dbm: sig.get(r.roomId) ?? NaN, level: rateLevel(r.median) }));
}

// ---------------------------------------------------------------------------------------------
// Own devices
// ---------------------------------------------------------------------------------------------

export interface ClientTypeInfo {
  label: string;
  needMbps: number;
  bands: NonNullable<WifiClient['bands']>;
  streams: number;
  /** usually stays in one place (a LAN cable is an option) */
  stationary: boolean;
}
/** Typical values per device type (assumptions, can be changed per device). */
export const CLIENT_TYPES: Record<WifiClientType, ClientTypeInfo> = {
  phone: { label: 'Handy', needMbps: 25, bands: '2.4+5', streams: 2, stationary: false },
  laptop: { label: 'Laptop', needMbps: 50, bands: '2.4+5', streams: 2, stationary: false },
  tablet: { label: 'Tablet', needMbps: 25, bands: '2.4+5', streams: 2, stationary: false },
  pc: { label: 'PC', needMbps: 100, bands: '2.4+5', streams: 2, stationary: true },
  tv: { label: 'Fernseher / Streaming-Box', needMbps: 25, bands: '2.4+5', streams: 2, stationary: true },
  console: { label: 'Spielkonsole', needMbps: 50, bands: '2.4+5', streams: 2, stationary: true },
  smart: { label: 'Smart-Home-Gerät (WLAN)', needMbps: 1, bands: '2.4', streams: 1, stationary: true },
  other: { label: 'Sonstiges Gerät', needMbps: 10, bands: '2.4+5', streams: 1, stationary: false },
};
export const CLIENT_BANDS: Record<NonNullable<WifiClient['bands']>, WifiBand[]> = { '2.4': ['2.4'], '2.4+5': ['2.4', '5'], '2.4+5+6': ['2.4', '5', '6'] };
/** A smart-home device needs little speed but a stable link. */
export const SMART_MIN_DBM = -75;

export interface ClientCheck {
  id: string;
  name: string;
  type: WifiClientType;
  x: number;
  y: number;
  /** placed in the WLAN list (false = a smart-home device from the device list) */
  own: boolean;
  needMbps: number;
  apId: string | null;
  apName: string | null;
  band: WifiBand | null;
  dbm: number;
  mbps: number;
  ok: boolean;
  advice: string;
}

/** The WLAN devices: placed ones plus smart-home devices that use WLAN. */
export function wifiClients(project: Project): (WifiClient & { own: boolean })[] {
  const own = project.wifiClients.map((c) => ({ ...c, own: true }));
  const smart = project.devices.filter((d) => d.kind !== 'router' && productById(d.productId)?.protocol === 'Wi-Fi').map((d) => ({ id: `dev:${d.id}`, name: d.name, type: 'smart' as const, x: d.x, y: d.y, own: false }));
  return [...own, ...smart];
}

export function profileOf(c: Pick<WifiClient, 'type' | 'bands' | 'streams'>): ClientProfile {
  const t = CLIENT_TYPES[c.type];
  return { bands: CLIENT_BANDS[c.bands ?? t.bands], streams: c.streams ?? t.streams };
}

export function checkClients(net: WifiNet): ClientCheck[] {
  return wifiClients(net.project).map((c) => {
    const t = CLIENT_TYPES[c.type];
    const need = c.needMbps ?? t.needMbps;
    const w = wifiAt(net, c, profileOf(c));
    const ap = net.aps.find((a) => a.id === w.apId) ?? null;
    const ok = w.mbps >= need && (c.type !== 'smart' || w.dbm >= SMART_MIN_DBM);
    const via = ap && w.band ? ` über „${ap.name}“ (${BAND_LABEL[w.band]}, ${Math.round(w.dbm)} dBm)` : '';
    let advice: string;
    if (!net.aps.length) advice = 'Noch kein Router im Plan.';
    else if (!ap) advice = `Kein Empfang (${Math.round(w.dbm)} dBm). ${t.stationary ? 'LAN-Kabel oder ein Access Point in der Nähe.' : 'Repeater oder Mesh-Knoten näher an diesem Platz.'}`;
    else if (ok) advice = `Reicht: ca. ${fmtMbps(w.mbps)}${via}, gebraucht ${fmtMbps(need)}.`;
    else if (c.type === 'smart' && w.mbps >= need) advice = `Empfang zu wackelig für ein Smart-Home-Gerät (${Math.round(w.dbm)} dBm, stabil ab ca. ${SMART_MIN_DBM} dBm)${via}. Repeater/Mesh näher oder ein Zigbee-Gerät.`;
    else advice = `Reicht nicht: ca. ${fmtMbps(w.mbps)}${via}, gebraucht ${fmtMbps(need)}. ${t.stationary ? 'Am sichersten ein LAN-Kabel (oder Powerline); sonst ein Mesh-Knoten nahe dran.' : 'Ein Repeater oder Mesh-Knoten auf dem Weg hilft (Vorschlag unten).'}`;
    return { id: c.id, name: c.name, type: c.type, x: c.x, y: c.y, own: c.own, needMbps: need, apId: ap?.id ?? null, apName: ap?.name ?? null, band: w.band, dbm: w.dbm, mbps: w.mbps, ok, advice };
  });
}

// ---------------------------------------------------------------------------------------------
// Suggestions: repeater / mesh / access point, router position, channels
// ---------------------------------------------------------------------------------------------

/** Rate a flat counts as "well covered" (Mbit/s) unless the internet line is slower. */
export const TARGET_MBPS = 50;

export interface Coverage {
  /** share of the floor with at least the target rate */
  share: number;
  clientsOk: number;
  clients: number;
  score: number;
}

export interface NodeSuggestion {
  x: number;
  y: number;
  roomId: string;
  role: 'mesh' | 'repeater' | 'ap';
  uplinkId: string;
  uplinkName: string;
  linkDbm: number;
  linkMbps: number;
  before: Coverage;
  after: Coverage;
  reason: string;
}

const COARSE = 0.5;

function coverage(rates: Float32Array, clientRates: number[], clientNeeds: number[], target: number): Coverage {
  let sum = 0;
  let good = 0;
  for (const r of rates) {
    sum += Math.min(r, target) / target;
    if (r >= target) good++;
  }
  const area = rates.length ? sum / rates.length : 0;
  let clientsOk = 0;
  let cs = 0;
  clientRates.forEach((r, i) => {
    if (r >= clientNeeds[i]) clientsOk++;
    cs += Math.min(r / clientNeeds[i], 1);
  });
  return { share: rates.length ? good / rates.length : 0, clientsOk, clients: clientRates.length, score: area + 0.2 * cs };
}

/** Rates on the coarse cells and at the devices for a network. */
function measure(net: WifiNet, pts: Vec2[], clients: ClientCheckInput[]): { rates: Float32Array; clientRates: number[] } {
  const rates = new Float32Array(pts.length);
  pts.forEach((p, i) => (rates[i] = wifiAt(net, p).mbps));
  return { rates, clientRates: clients.map((c) => wifiAt(net, c.p, c.profile).mbps) };
}

interface ClientCheckInput {
  p: Vec2;
  profile: ClientProfile;
  need: number;
  smart: boolean;
}

function clientInputs(project: Project): ClientCheckInput[] {
  return wifiClients(project).map((c) => ({ p: c, profile: profileOf(c), need: c.needMbps ?? CLIENT_TYPES[c.type].needMbps, smart: c.type === 'smart' }));
}

/** Project with one more access point (for trying positions). */
function withNode(project: Project, id: string, at: Vec2, role: NodeSuggestion['role'], uplinkId?: string): Project {
  const standard = project.devices.find((d) => d.kind === 'router' && (d.wifi?.role ?? 'router') === 'router')?.wifi?.standard;
  return {
    ...project,
    devices: [...project.devices, { id, name: role === 'repeater' ? 'Repeater (Vorschlag)' : role === 'ap' ? 'Access Point (Vorschlag)' : 'Mesh-Knoten (Vorschlag)', kind: 'router', x: at.x, y: at.y, elevation: 1, rotation: 0, wifi: { role, standard, uplinkId, backhaul: role === 'ap' ? 'wired' : role === 'mesh' && (standard === 'wifi6e' || standard === 'wifi7') ? 'wireless-dedicated' : 'wireless-shared' } }],
  };
}

export const SUGGEST_ID = '__wifi_suggest__';

/**
 * Where does one more node help most? Tries every free spot on a 0,5-m grid (or the sockets of the plan
 * for a plug-in repeater) and keeps the one with the most floor at the target rate and the most devices
 * that get what they need. The link to the uplink is part of it: a repeater too far away gets too little.
 */
export function suggestNodes(project: Project, derived: DerivedPlan, role: NodeSuggestion['role'] = 'mesh', count = 1): NodeSuggestion[] {
  const out: NodeSuggestion[] = [];
  let p = project;
  for (let n = 0; n < count; n++) {
    const s = suggestOne(p, derived, role);
    if (!s) break;
    out.push(s);
    p = withNode(p, `${SUGGEST_ID}${n}`, s, role);
  }
  return out;
}

function suggestOne(project: Project, derived: DerivedPlan, role: NodeSuggestion['role']): NodeSuggestion | null {
  const base = buildNet(project, derived, COARSE);
  if (!base.aps.length || !base.cells) return null;
  const target = Math.min(TARGET_MBPS, base.internetMbps * 0.9);
  const pts = base.cells.inside.map((k) => cellCentre(base.cells!, k));
  const clients = clientInputs(project);
  const needs = clients.map((c) => c.need);
  const m0 = measure(base, pts, clients);
  const before = coverage(m0.rates, m0.clientRates, needs, target);
  if (before.share >= 0.98 && before.clientsOk === before.clients) return null;
  // candidates: sockets for a plug-in repeater (when the plan has enough of them), else the grid
  const sockets = project.fixtures.filter((f) => f.kind === 'socket');
  let cands: Vec2[] = role === 'repeater' && sockets.length >= 3 ? sockets.map((s) => ({ x: s.x, y: s.y })) : pts;
  // keep it quick on large plans: every other cell
  if (cands.length > 260) cands = cands.filter((_, i) => i % Math.ceil(cands.length / 260) === 0);
  let best: { at: Vec2; cov: Coverage; net: WifiNet } | null = null;
  for (const at of cands) {
    if (base.aps.some((a) => Math.hypot(a.x - at.x, a.y - at.y) < 1.5)) continue;
    const net = buildNet(withNode(project, SUGGEST_ID, at, role), derived, COARSE, base);
    const m = measure(net, pts, clients);
    const cov = coverage(m.rates, m.clientRates, needs, target);
    if (!best || cov.score > best.cov.score) best = { at, cov, net };
  }
  if (!best || best.cov.score < before.score + 0.02) return null;
  const link = best.net.links.get(SUGGEST_ID);
  const up = best.net.aps.find((a) => a.id === link?.uplinkId);
  const roomId = base.cells.room[base.cells.inside[pts.findIndex((q) => q.x === best!.at.x && q.y === best!.at.y)]] ?? roomIdAt(project, derived, best.at);
  const pc = (v: number) => `${Math.round(v * 100)} %`;
  const reason =
    `Fläche mit mindestens ${fmtMbps(target)}: ${pc(before.share)} → ${pc(best.cov.share)}` +
    (clients.length ? `, Geräte versorgt: ${before.clientsOk} → ${best.cov.clientsOk} von ${clients.length}` : '') +
    (link && up ? `. Verbindung zu „${up.name}“: ${Math.round(link.dbm)} dBm, ca. ${fmtMbps(link.mbps)}${role === 'ap' ? ' (per Kabel)' : ''}.` : '.');
  return { x: best.at.x, y: best.at.y, roomId, role, uplinkId: up?.id ?? '', uplinkName: up?.name ?? '', linkDbm: link?.dbm ?? NaN, linkMbps: link?.mbps ?? NaN, before, after: best.cov, reason };
}

function roomIdAt(project: Project, derived: DerivedPlan, p: Vec2): string {
  const c = roomCells(project, derived, COARSE);
  if (!c) return '';
  let bestK = -1;
  let bestD = Infinity;
  for (const k of c.inside) {
    const q = cellCentre(c, k);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      bestK = k;
    }
  }
  return bestK >= 0 ? c.room[bestK] : '';
}

export interface RouterHint {
  x: number;
  y: number;
  roomId: string;
  before: number;
  after: number;
  text: string;
}

/** With only one router: would another spot cover clearly more (at least 15 points)? */
export function routerHint(project: Project, derived: DerivedPlan): RouterHint | null {
  const aps = accessPoints(project);
  if (aps.length !== 1) return null;
  const base = buildNet(project, derived, COARSE);
  if (!base.cells) return null;
  const target = Math.min(TARGET_MBPS, base.internetMbps * 0.9);
  const pts = base.cells.inside.map((k) => cellCentre(base.cells!, k));
  const clients = clientInputs(project);
  const needs = clients.map((c) => c.need);
  const m0 = measure(base, pts, clients);
  const before = coverage(m0.rates, m0.clientRates, needs, target);
  let best: { at: Vec2; cov: Coverage; k: number } | null = null;
  const id = aps[0].id;
  pts.forEach((at, i) => {
    if (i % 2) return;
    const moved = { ...project, devices: project.devices.map((d) => (d.id === id ? { ...d, x: at.x, y: at.y } : d)) };
    const net = buildNet(moved, derived, COARSE, base);
    const m = measure(net, pts, clients);
    const cov = coverage(m.rates, m.clientRates, needs, target);
    if (!best || cov.score > best.cov.score) best = { at, cov, k: base.cells!.inside[i] };
  });
  const b = best as { at: Vec2; cov: Coverage; k: number } | null;
  if (!b || b.cov.share < before.share + 0.15) return null;
  const roomId = base.cells.room[b.k];
  const room = project.rooms.find((r) => r.id === roomId)?.name ?? 'Mitte';
  return {
    x: b.at.x,
    y: b.at.y,
    roomId,
    before: before.share,
    after: b.cov.share,
    text: `Stünde der Router in „${room}“, hätten ${Math.round(b.cov.share * 100)} % statt ${Math.round(before.share * 100)} % der Fläche mindestens ${fmtMbps(target)}. Nur sinnvoll, wenn dort der Anschluss hinkommt oder ein LAN-Kabel hinführt; sonst lieber einen Mesh-Knoten.`,
  };
}

export interface ChannelAdvice {
  apId: string;
  apName: string;
  band: WifiBand;
  current: number;
  auto: boolean;
  best: number;
  better: boolean;
  text: string;
}

/** Per access point and band: is the used channel fine, or would another one be clearly freer? */
export function channelAdvice(net: WifiNet): ChannelAdvice[] {
  const out: ChannelAdvice[] = [];
  for (const a of net.aps) {
    const per = net.channels.get(a.id) ?? {};
    for (const band of BANDS) {
      const c = per[band];
      if (!c) continue;
      const shared = a.backhaul === 'wireless-shared' && net.links.has(a.id);
      const better = !c.auto && !shared && c.best !== c.ch && c.bestCost < c.cost - 0.05;
      const dfs = isDfs(band, c.best) ? ' (DFS-Kanal: der Router prüft beim Start ca. 1 Minute auf Radar)' : '';
      const text = shared
        ? `Kanal ${c.ch} – folgt „${net.aps.find((x) => x.id === net.links.get(a.id)?.uplinkId)?.name ?? 'Uplink'}“ (ein Repeater sendet auf demselben Funkkanal wie das Gerät, an dem er hängt).`
        : c.auto
          ? `Automatisch – angenommen: freiester Kanal ${c.ch}${isDfs(band, c.ch) ? ' (DFS)' : ''}${c.cost > 0.05 ? `, trotzdem ca. ${Math.round(c.cost * 100)} % Störung` : ''}.`
          : better
            ? `Kanal ${c.ch} ist belegt (ca. ${Math.round(c.cost * 100)} % Störung). Besser Kanal ${c.best}${dfs} (ca. ${Math.round(c.bestCost * 100)} %).`
            : `Kanal ${c.ch} passt${c.cost > 0.05 ? ` (ca. ${Math.round(c.cost * 100)} % Störung, kein freierer Kanal)` : ''}.`;
      out.push({ apId: a.id, apName: a.name, band, current: c.ch, auto: c.auto, best: c.best, better, text });
    }
  }
  return out;
}

/** Links between access points: is each repeater/mesh node close enough to its uplink? */
export interface LinkCheck {
  apId: string;
  apName: string;
  uplinkName: string;
  dbm: number;
  mbps: number;
  quality: 'good' | 'ok' | 'weak';
  text: string;
}

export function linkChecks(net: WifiNet): LinkCheck[] {
  const out: LinkCheck[] = [];
  for (const a of net.aps) {
    const l = net.links.get(a.id);
    if (!l) continue;
    const up = net.aps.find((x) => x.id === l.uplinkId);
    const quality = l.dbm >= -65 ? 'good' : l.dbm >= -72 ? 'ok' : 'weak';
    const text =
      quality === 'good'
        ? `Gute Verbindung zu „${up?.name}“ (${Math.round(l.dbm)} dBm, ${BAND_LABEL[l.band]}, ca. ${fmtMbps(l.mbps)}).`
        : quality === 'ok'
          ? `Verbindung zu „${up?.name}“ reicht knapp (${Math.round(l.dbm)} dBm, ca. ${fmtMbps(l.mbps)}). Etwas näher heran wäre besser.`
          : `Zu weit von „${up?.name}“ (${Math.round(l.dbm)} dBm, ca. ${fmtMbps(l.mbps)}): Ein Repeater bringt nur weiter, was er selbst gut empfängt. Näher an „${up?.name}“ stellen, etwa auf halbem Weg.`;
    out.push({ apId: a.id, apName: a.name, uplinkName: up?.name ?? '', dbm: l.dbm, mbps: l.mbps, quality, text });
  }
  return out;
}

/** Neighbour networks with their estimated strength in the flat (strongest point). */
export function neighborReach(net: WifiNet): { id: string; name: string; band: WifiBand; channel: number; maxDbm: number; measured: boolean }[] {
  return net.neighbors.map((n) => {
    let max = -Infinity;
    if (net.cells) for (const k of net.cells.inside) max = Math.max(max, neighborDbm(n, cellCentre(net.cells, k), net.barriers));
    return { id: n.id, name: n.name, band: n.band, channel: n.channel, maxDbm: max, measured: n.measured };
  });
}
