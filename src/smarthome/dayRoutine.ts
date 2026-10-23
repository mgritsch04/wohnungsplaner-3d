import type { DerivedPlan } from '../model/derived';
import type { Project, Room } from '../model/schema';
import { boundsOf, dist, pointInPolygon, polygonCentroid, type Vec2 } from '../model/vec';
import { shortestWalkPath } from '../model/walkPath';
import { formatSimHour, initialState, isDark, occludersOf, step, type Occluder, type SimEvent, type SimState } from './simulation';

/**
 * Day routine (#359)
 * ------------------
 * A virtual person walks through a typical day (get up, bathroom, kitchen, work, evening,
 * night) along the shortest walk paths (#67) while the smart-home simulation (#170) runs
 * with the plan's sensors and rules. The run reports where lights come on too late or
 * never, where they go out while somebody is still there, and where it stays needlessly
 * bright at night. Pure and deterministic; the UI only plays the result back.
 */

export type RoomRole = 'schlafen' | 'bad' | 'kueche' | 'arbeiten' | 'wohnen';

const ROLE_PATTERNS: [RoomRole, RegExp][] = [
  ['schlafen', /schlaf|bett|kinder/i],
  ['bad', /\bbad|\bwc\b|dusch|toilette|\bwc/i],
  ['kueche', /küche|kueche|koch/i],
  ['arbeiten', /arbeit|büro|buero|office|studio/i],
  ['wohnen', /wohn|ess|salon|stube|living/i],
];

/** Role of a room by its name (null for hall, storage and other rooms). */
export function roomRole(name: string): RoomRole | null {
  return ROLE_PATTERNS.find(([, re]) => re.test(name))?.[0] ?? null;
}

interface StationPlan {
  hour: number;
  role: RoomRole;
  label: string;
  sleeping?: boolean;
  /** use this role when the flat has no room for the first one */
  fallback?: RoomRole;
}

/** The typical day: the person is in bed until 06:30 (with a night-time trip to the bathroom). */
const DAY: StationPlan[] = [
  { hour: 0, role: 'schlafen', label: 'Schlafen', sleeping: true },
  { hour: 3.17, role: 'bad', label: 'Nächtlicher Toilettengang' },
  { hour: 3.33, role: 'schlafen', label: 'Schlafen', sleeping: true },
  { hour: 6.5, role: 'schlafen', label: 'Aufstehen' },
  { hour: 6.75, role: 'bad', label: 'Bad am Morgen' },
  { hour: 7.1, role: 'kueche', label: 'Frühstück' },
  { hour: 7.75, role: 'arbeiten', label: 'Arbeiten', fallback: 'wohnen' },
  { hour: 12.5, role: 'kueche', label: 'Mittagessen' },
  { hour: 13.1, role: 'arbeiten', label: 'Arbeiten', fallback: 'wohnen' },
  { hour: 18.5, role: 'kueche', label: 'Abendessen' },
  { hour: 19.5, role: 'wohnen', label: 'Abend' },
  { hour: 22, role: 'bad', label: 'Bad am Abend' },
  { hour: 22.5, role: 'schlafen', label: 'Schlafen', sleeping: true },
];

export const WALK_SPEED = 1.2; // m/s
const DT_WALK = 1;
const DT_STILL = 5;
/** the person still counts as moving for this long after arriving (settling in) */
const SETTLE_S = 30;
/** an awake person sitting or standing still moves a little (reaching, shifting) this often (s) */
const FIDGET_EVERY_S = 90;
const FIDGET_S = 5;
/** darkness in an occupied room shorter than this is not reported (a few steps) */
const DARK_GRACE_S = 3;
/** a light on in an empty room / over a sleeper this long at night is reported */
const BRIGHT_MIN_S = 300;
/** the sleeper counts as asleep this long after lying down */
const SLEEP_AFTER_S = 600;

export type FindingKind = 'never' | 'late' | 'cutoff' | 'bright';

export interface DayFinding {
  kind: FindingKind;
  roomId: string;
  room: string;
  hour: number;
  /** where it happened (for markers) */
  at: Vec2;
  text: string;
}

export interface DayStation {
  hour: number;
  label: string;
  room: string;
  at: Vec2;
}

export interface DaySegment {
  t0: number;
  t1: number;
  /** polyline walked in this segment (a single point while standing) */
  points: Vec2[];
  station: number;
  walking: boolean;
}

/** A device switched (sensor detected, lamp on/off) at second t of the routine. */
export interface DayChange {
  t: number;
  id: string;
  on: boolean;
  brightness?: number;
}

export interface DayResult {
  ok: true;
  /** all device state changes in order, for the playback */
  changes: DayChange[];
  log: SimEvent[];
  stations: DayStation[];
  segments: DaySegment[];
  findings: DayFinding[];
  /** rooms without a smart lamp that were not rated */
  unrated: string[];
  durationS: number;
}

export type DayRun = DayResult | { ok: false; reason: string };

/** Position at simulated second t (seconds since 00:00 of the routine). */
export function positionAt(segments: DaySegment[], t: number): { pos: Vec2; walking: boolean; station: number; sinceArrivalS: number } {
  const seg = segments.find((s) => t < s.t1) ?? segments[segments.length - 1];
  if (!seg.walking || seg.points.length < 2) return { pos: seg.points[seg.points.length - 1], walking: false, station: seg.station, sinceArrivalS: t - seg.t0 };
  const total = seg.points.slice(1).reduce((n, p, i) => n + dist(seg.points[i], p), 0);
  let d = total * Math.min(1, Math.max(0, (t - seg.t0) / (seg.t1 - seg.t0)));
  for (let i = 1; i < seg.points.length; i++) {
    const l = dist(seg.points[i - 1], seg.points[i]);
    if (d <= l || i === seg.points.length - 1) {
      const k = l > 0 ? Math.min(1, d / l) : 1;
      const a = seg.points[i - 1], b = seg.points[i];
      return { pos: { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }, walking: true, station: seg.station, sinceArrivalS: 0 };
    }
    d -= l;
  }
  return { pos: seg.points[seg.points.length - 1], walking: true, station: seg.station, sinceArrivalS: 0 };
}

/** Free standing spot in a room, as close to the middle as the walk grid allows. */
function standingSpot(project: Project, derived: DerivedPlan, room: Room, from: Vec2 | null): { at: Vec2; points: Vec2[] } | null {
  const g = derived.rooms.get(room.id);
  const b = g && boundsOf(g.interior);
  if (!g || !b) return null;
  const c = polygonCentroid(g.interior);
  const cands: Vec2[] = [c];
  for (let y = b.minY + 0.4; y < b.maxY; y += 0.4)
    for (let x = b.minX + 0.4; x < b.maxX; x += 0.4) if (pointInPolygon({ x, y }, g.interior)) cands.push({ x, y });
  cands.splice(1, cands.length, ...cands.slice(1).sort((p, q) => dist(p, c) - dist(q, c)).slice(0, 12));
  for (const at of cands) {
    if (!from) return { at, points: [at] };
    const r = shortestWalkPath(project, derived, from, at);
    // the walk path snaps blocked end points to a free cell; keep only spots inside the room
    if (r.ok && pointInPolygon(r.points[r.points.length - 1], g.interior)) return { at: r.points[r.points.length - 1], points: r.points };
  }
  return null;
}

/** Plan the day: stations in rooms by role and the paths between them. */
function planDay(project: Project, derived: DerivedPlan): { stations: DayStation[]; segments: DaySegment[]; sleeping: boolean[] } | string {
  const roomOf = (role: RoomRole) => project.rooms.find((r) => roomRole(r.name) === role);
  const stations: DayStation[] = [];
  const sleeping: boolean[] = [];
  const segments: DaySegment[] = [];
  let pos: Vec2 | null = null;
  let t = 0;
  for (let i = 0; i < DAY.length; i++) {
    const d = DAY[i];
    const room = roomOf(d.role) ?? (d.fallback && roomOf(d.fallback));
    if (!room) continue;
    const prevRoom = stations[stations.length - 1]?.room;
    if (prevRoom === room.name && pos) {
      // same room again (e.g. getting up): no walk, only a new label (and a new time span)
      const start = Math.max(t, d.hour * 3600);
      if (start > t) segments.push({ t0: t, t1: start, points: [pos], station: stations.length - 1, walking: false });
      t = start;
      stations.push({ hour: d.hour, label: d.label, room: room.name, at: pos });
      sleeping.push(!!d.sleeping);
      continue;
    }
    const spot = standingSpot(project, derived, room, pos);
    if (!spot) continue;
    const start = Math.max(t, d.hour * 3600);
    if (pos && spot.points.length > 1) {
      const len = spot.points.slice(1).reduce((n, p, k) => n + dist(spot.points[k], p), 0);
      const walkS = Math.max(1, Math.round(len / WALK_SPEED));
      if (start > t) segments.push({ t0: t, t1: start, points: [pos], station: stations.length - 1, walking: false });
      stations.push({ hour: d.hour, label: d.label, room: room.name, at: spot.at });
      sleeping.push(!!d.sleeping);
      segments.push({ t0: start, t1: start + walkS, points: spot.points, station: stations.length - 1, walking: true });
      t = start + walkS;
    } else {
      stations.push({ hour: d.hour, label: d.label, room: room.name, at: spot.at });
      sleeping.push(!!d.sleeping);
      if (!pos) t = start;
    }
    pos = spot.at;
  }
  if (new Set(stations.map((s) => s.room)).size < 2) return 'Für die Tagesablauf-Simulation braucht der Plan mindestens zwei Räume mit Namen wie Schlafzimmer, Bad, Küche, Wohnzimmer oder Arbeitszimmer.';
  const end = Math.max(t, 24 * 3600);
  segments.push({ t0: t, t1: end, points: [pos!], station: stations.length - 1, walking: false });
  return { stations, segments, sleeping };
}

const roomIdAt = (project: Project, derived: DerivedPlan, p: Vec2) => project.rooms.find((r) => {
  const g = derived.rooms.get(r.id);
  return !!g && pointInPolygon(p, g.interior);
})?.id ?? null;

/** Midnight state of the routine: everything starts dark, the test is about what sensors and rules switch on. */
export function dayInitialState(project: Project): SimState {
  const state = initialState(project, 0);
  for (const d of project.devices) if (d.kind === 'light' || d.kind === 'strip' || d.kind === 'plug') state.entities[d.id] = { ...state.entities[d.id], on: false };
  return state;
}

/** Run the typical day against the plan's devices and rules. */
export function runDayRoutine(project: Project, derived: DerivedPlan, occluders: Occluder[] = occludersOf(project, derived)): DayRun {
  if (!project.devices.length) return { ok: false, reason: 'Es sind noch keine Smart-Home-Geräte gesetzt.' };
  const planned = planDay(project, derived);
  if (typeof planned === 'string') return { ok: false, reason: planned };
  const { stations, segments, sleeping } = planned;

  const roomName = new Map(project.rooms.map((r) => [r.id, r.name]));
  // rooms with at least one smart lamp are rated; the lamp's room is where it hangs
  const lampsIn = new Map<string, string[]>();
  for (const d of project.devices) {
    if (d.kind !== 'light' && d.kind !== 'strip') continue;
    const rid = roomIdAt(project, derived, d);
    if (rid) lampsIn.set(rid, [...(lampsIn.get(rid) ?? []), d.id]);
  }
  const unrated = project.rooms.filter((r) => !lampsIn.has(r.id)).map((r) => r.name);

  let state: SimState = dayInitialState(project);

  const findings: DayFinding[] = [];
  const changes: DayChange[] = [];
  const log: SimEvent[] = [];
  const lampOn = (rid: string) => (lampsIn.get(rid) ?? []).some((id) => state.entities[id]?.on);

  // visit of a room by the person
  let visit: { station: number; rid: string; since: number; darkS: number; firstDarkAt?: Vec2; lit: boolean; lateS: number; cutS: number; startHour: number } | null = null;
  const closeVisit = () => {
    if (!visit) return;
    const v = visit;
    const name = roomName.get(v.rid) ?? '';
    if (v.darkS >= DARK_GRACE_S && lampsIn.has(v.rid)) {
      const at = v.firstDarkAt ?? { x: 0, y: 0 };
      if (!v.lit) findings.push({ kind: 'never', roomId: v.rid, room: name, hour: v.startHour, at, text: `${name}: Licht ging nie an, obwohl jemand ${Math.round(v.darkS / 60) || '<1'} min im Dunkeln war` });
      else {
        if (v.lateS >= DARK_GRACE_S) findings.push({ kind: 'late', roomId: v.rid, room: name, hour: v.startHour, at, text: `${name}: Licht ging erst ${Math.round(v.lateS)} s nach dem Betreten an` });
        if (v.cutS >= DARK_GRACE_S) findings.push({ kind: 'cutoff', roomId: v.rid, room: name, hour: v.startHour, at, text: `${name}: Licht ging aus, während noch jemand da war (${Math.round(v.cutS)} s dunkel)` });
      }
    }
    visit = null;
  };

  const bright = new Map<string, { since: number; hour: number; at: Vec2; empty: boolean }>();
  const closeBright = (rid: string, t: number) => {
    const b = bright.get(rid);
    bright.delete(rid);
    if (!b || t - b.since < BRIGHT_MIN_S) return;
    const name = roomName.get(rid) ?? '';
    findings.push({ kind: 'bright', roomId: rid, room: name, hour: b.hour, at: b.at, text: `${name}: nachts ${Math.round((t - b.since) / 60)} min unnötig hell (${b.empty ? 'niemand im Raum' : 'während des Schlafs'})` });
  };

  let arrivedAt = 0;
  let lastStation = -1;
  const end = segments[segments.length - 1].t1;
  for (let t = 0; t < end; ) {
    const cur = positionAt(segments, t);
    if (cur.station !== lastStation) {
      lastStation = cur.station;
      arrivedAt = t === 0 ? -SLEEP_AFTER_S : t; // the day starts with the person already settled in bed
    }
    const idle = t - arrivedAt;
    const fidget = !sleeping[cur.station] && idle % FIDGET_EVERY_S < FIDGET_S;
    const still = !cur.walking && idle >= SETTLE_S && !fidget;
    const dt = cur.walking ? DT_WALK : DT_STILL;
    const before = state.entities;
    state = step(project, occluders, state, dt, { person: cur.pos, moving: !still });
    t += dt;
    for (const [id, e] of Object.entries(state.entities)) {
      const b = before[id];
      if (!b || b.on !== e.on || (e.on && b.brightness !== e.brightness)) changes.push({ t, id, on: e.on, brightness: e.brightness });
    }
    for (const ev of state.events) if (ev.t === state.t) log.push(ev);
    const hour = state.hour;
    const dark = isDark(hour);
    const rid = roomIdAt(project, derived, cur.pos);

    if (visit && (visit.rid !== rid || visit.station !== cur.station)) closeVisit();
    if (rid && !visit) visit = { station: cur.station, rid, since: t, darkS: 0, lit: false, lateS: 0, cutS: 0, startHour: hour };
    const asleepNow = !!sleeping[cur.station] && !cur.walking && idle >= SETTLE_S;
    if (visit && lampsIn.has(visit.rid) && dark && !asleepNow) {
      if (lampOn(visit.rid)) visit.lit = true;
      else {
        visit.darkS += dt;
        visit.firstDarkAt ??= cur.pos;
        if (visit.lit) visit.cutS += dt;
        else visit.lateS += dt;
      }
    }

    const night = hour < 6 || hour >= 22;
    const asleep = sleeping[cur.station] && !cur.walking && t - arrivedAt > SLEEP_AFTER_S;
    for (const [lr] of lampsIn) {
      const onNow = lampOn(lr);
      const empty = lr !== rid;
      const unnecessary = onNow && dark && night && (empty || (lr === rid && asleep));
      if (unnecessary) {
        if (!bright.has(lr)) bright.set(lr, { since: t, hour, at: cur.pos, empty });
      } else closeBright(lr, t);
    }
  }
  closeVisit();
  for (const lr of [...bright.keys()]) closeBright(lr, end);

  // one finding per kind, room and hour
  const seen = new Set<string>();
  const unique = findings.filter((f) => {
    const k = `${f.kind}|${f.roomId}|${Math.floor(f.hour)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => a.hour - b.hour);
  return { ok: true, changes, log, stations, segments, findings: unique, unrated, durationS: end };
}

/** One-line summary for the panel. */
export function summarizeDay(r: DayResult): string {
  if (!r.findings.length) return 'Keine Lücken gefunden: Das Licht geht überall rechtzeitig an und nachts nicht unnötig.';
  const n = (k: FindingKind) => r.findings.filter((f) => f.kind === k).length;
  const parts = [
    [n('never') + n('late'), 'Licht zu spät/nie'],
    [n('cutoff'), 'Licht geht zu früh aus'],
    [n('bright'), 'nachts unnötig hell'],
  ].filter(([c]) => c) as [number, string][];
  return parts.map(([c, s]) => `${c}× ${s}`).join(' · ');
}

export { formatSimHour };
