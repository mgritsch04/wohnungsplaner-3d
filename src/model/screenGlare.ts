import type { DerivedPlan } from './derived';
import { type Season, SEASONS, formatClock, sunPosition, MIN_ELEVATION, DEFAULT_LATITUDE } from './sunPath';
import { windowLights, type WindowLight } from './windowLight';
import type { Furniture, Project } from './schema';
import { add, dist, dot, normalize, pointInPolygon, scale, sub, closestPointOnSegment, type Vec2 } from './vec';

/**
 * Glare on screens (#495): reflections of sun and windows in a TV or monitor, and backlight from a
 * window behind the screen. Uses the sun path of #475 and the windows of the daylight model.
 *
 * A rough estimate for the planner, not a light simulation: no neighbouring buildings, balconies or
 * reveals, no weather, a flat screen without tilt. Clock times are local wall-clock times of Vienna.
 */

export type GlareKind = 'reflection' | 'backlight';

export const GLARE_KIND_LABEL: Record<GlareKind, string> = { reflection: 'Spiegelung', backlight: 'Gegenlicht' };

export const GLARE_SEASON_LABEL: Record<Season, string> = { winter: 'Winter', equinox: 'Frühling/Herbst', summer: 'Sommer' };

/** The sun mirrors in the screen when it is at most this far (degrees, in 3D) from the mirror direction of the viewer. */
export const REFLECTION_CONE = 40;
/** Backlight: a window within this angle (degrees) of the line of sight behind the screen. */
export const BACKLIGHT_CONE = 12;
/** A window with a curtain or blind that lets less than this through is treated as covered. */
export const COVERED_BELOW = 0.35;
/** Default distance (m) of the viewer to a TV when no sofa or armchair faces it. */
const TV_VIEW_DISTANCE = 2.5;
/** Distance (m) of the eyes to a desk screen and its centre height above the floor (m). */
const DESK_VIEW_DISTANCE = 0.7;
const DESK_SCREEN_HEIGHT = 1.1;
/** Vertical slack (m): the screen is not a point. */
const SCREEN_HALF_HEIGHT = 0.3;
const STEP = 0.25;
/** Shortest reflection (hours) that is reported. */
const MIN_SPAN = 0.5;

const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export type ScreenKind = 'tv' | 'monitor' | 'desk';

export interface Screen {
  furniture: Furniture;
  kind: ScreenKind;
  roomId: string;
  /** Centre of the screen (plan) and its height above the floor (m). */
  pos: Vec2;
  height: number;
  /** Unit vector the screen faces (towards the viewer). */
  normal: Vec2;
  /** Position of the viewer's eyes (plan). */
  viewer: Vec2;
  /** A seat of the room is the viewing position (otherwise an assumed spot). */
  seatId?: string;
}

export interface GlareSpan {
  season: Season;
  /** Decimal clock hours. */
  from: number;
  to: number;
}

export interface ScreenGlare {
  furnitureId: string;
  name: string;
  kind: GlareKind;
  screenKind: ScreenKind;
  roomId: string;
  /** Plan point of the screen. */
  at: Vec2;
  /** Times with glare per season (sun); empty for sky-only findings. */
  spans: GlareSpan[];
  /** Longest total span over the three days, hours. */
  hours: number;
  /** Window ids that cause it. */
  openingIds: string[];
}

const shapeOf = (f: Furniture): string => (f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape);
const frontVec = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });
const SEAT_SHAPES = new Set(['sofa', 'armchair']);

/** Plan direction of a compass bearing. */
export function bearingDir(bearing: number, north: number): Vec2 {
  const a = rad(bearing - north);
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/** First hit (distance and point) of the ray with the outline of the room. */
function rayToWall(from: Vec2, dir: Vec2, outline: Vec2[]): { t: number; point: Vec2 } | null {
  let best: { t: number; point: Vec2 } | null = null;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const e = sub(b, a);
    const den = dir.x * e.y - dir.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const w = sub(a, from);
    const t = (w.x * e.y - w.y * e.x) / den;
    const u = (w.x * dir.y - w.y * dir.x) / den;
    if (t > 0.02 && u >= -1e-6 && u <= 1 + 1e-6 && (!best || t < best.t)) best = { t, point: add(from, scale(dir, t)) };
  }
  return best;
}

/** The window of `windows` that the wall point `point` lies in (within 15 cm of its glass), if any. */
function windowAtPoint(point: Vec2, windows: WindowLight[]): WindowLight | undefined {
  return windows.find((w) => closestPointOnSegment(point, w.a, w.b).distance <= 0.15);
}

/** Screens of the plan: TVs and monitors (facing their front) and desks (screen assumed on the desk, user sits at the front). */
export function findScreens(project: Project, plan: DerivedPlan): Screen[] {
  const rooms = project.rooms
    .map((r) => ({ id: r.id, poly: plan.rooms.get(r.id)?.interior }))
    .filter((r): r is { id: string; poly: Vec2[] } => !!r.poly && r.poly.length >= 3);
  const roomOf = (p: Vec2) => rooms.find((r) => pointInPolygon(p, r.poly))?.id;
  const seats = project.furniture.filter((f) => SEAT_SHAPES.has(shapeOf(f)));
  const out: Screen[] = [];
  const monitors: Furniture[] = [];
  for (const f of project.furniture) {
    const isScreen = shapeOf(f) === 'tv' || (/monitor|bildschirm/i.test(f.name) && f.category !== 'storage' && f.category !== 'desk');
    if (isScreen) monitors.push(f);
  }
  for (const f of monitors) {
    const pos = { x: f.x, y: f.y };
    const roomId = roomOf(pos);
    if (!roomId) continue;
    const normal = frontVec(f.rotation);
    // the viewer sits on a sofa or armchair in front of the screen, otherwise an assumed spot
    const seat = seats
      .filter((s) => {
        const to = sub({ x: s.x, y: s.y }, pos);
        const d = Math.hypot(to.x, to.y);
        return d > 0.8 && d < 7 && dot(normalize(to), normal) > Math.cos(rad(60)) && roomOf({ x: s.x, y: s.y }) === roomId;
      })
      .sort((a, b) => dist(a, pos) - dist(b, pos))[0];
    const viewer = seat ? { x: seat.x, y: seat.y } : add(pos, scale(normal, TV_VIEW_DISTANCE));
    out.push({ furniture: f, kind: shapeOf(f) === 'tv' ? 'tv' : 'monitor', roomId, pos, height: f.elevation + f.height / 2, normal, viewer, seatId: seat?.id });
  }
  for (const f of project.furniture) {
    if (f.category !== 'desk') continue;
    // a separate monitor on the desk already stands for it
    const front = frontVec(f.rotation);
    const right = { x: front.y, y: -front.x };
    const hasMonitor = monitors.some((m) => {
      const local = sub({ x: m.x, y: m.y }, { x: f.x, y: f.y });
      return Math.abs(dot(local, right)) <= f.width / 2 && Math.abs(dot(local, front)) <= f.depth / 2;
    });
    if (hasMonitor) continue;
    const normal = frontVec(f.rotation);
    const centre = { x: f.x, y: f.y };
    const roomId = roomOf(centre);
    if (!roomId) continue;
    // the monitor stands in the back half of the desk, the eyes sit in front of the desk
    const pos = sub(centre, scale(normal, f.depth * 0.25));
    out.push({ furniture: f, kind: 'desk', roomId, pos, height: DESK_SCREEN_HEIGHT, normal, viewer: add(centre, scale(normal, f.depth / 2 + DESK_VIEW_DISTANCE - 0.3)) });
  }
  return out;
}

/** Contiguous clock ranges (decimal hours) out of the sampled hours. */
function ranges(hours: number[]): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const h of hours) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.to - h) < 1e-6) last.to = h + STEP;
    else out.push({ from: h, to: h + STEP });
  }
  return out;
}

/** Angle (degrees) between two 3D directions. */
const angle3 = (a: [number, number, number], b: [number, number, number]): number => {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return deg(Math.acos(Math.max(-1, Math.min(1, d))));
};

/** Glare of the screens: sun reflections with times and backlight from windows behind the screen. */
export function findScreenGlare(project: Project, plan: DerivedPlan, latitude = DEFAULT_LATITUDE): ScreenGlare[] {
  const north = project.settings.northDirection;
  const windows = windowLights(project, plan).filter((w) => w.transmission >= COVERED_BELOW);
  const out: ScreenGlare[] = [];
  for (const s of findScreens(project, plan)) {
    const outline = plan.rooms.get(s.roomId)?.interior;
    const roomWindows = windows.filter((w) => w.roomId === s.roomId);
    if (!outline || !roomWindows.length) continue;
    const base = { furnitureId: s.furniture.id, name: s.furniture.name, screenKind: s.kind, roomId: s.roomId, at: s.pos };

    // reflection: the sun shines through a window onto the screen and is mirrored towards the viewer
    const toViewer = normalize(sub(s.viewer, s.pos));
    const along = dot(toViewer, s.normal);
    if (along > 0.2) {
      const mirror = normalize(sub(scale(s.normal, 2 * along), toViewer));
      const mirror3: [number, number, number] = [mirror.x, mirror.y, 0];
      const spans: GlareSpan[] = [];
      const causes = new Set<string>();
      for (const season of SEASONS) {
        const hours: number[] = [];
        for (let h = 5; h < 22; h += STEP) {
          const sun = sunPosition(season, h + STEP / 2, latitude);
          if (sun.elevation < MIN_ELEVATION) continue;
          const dir = bearingDir(sun.azimuth, north);
          const el = rad(sun.elevation);
          if (angle3([dir.x * Math.cos(el), dir.y * Math.cos(el), Math.sin(el)], mirror3) > REFLECTION_CONE) continue;
          // the ray from the screen to the sun must leave through a window at the right height
          const hit = rayToWall(s.pos, dir, outline);
          const win = hit && windowAtPoint(hit.point, roomWindows);
          if (!hit || !win) continue;
          const z = s.height + hit.t * Math.tan(el);
          if (z + SCREEN_HALF_HEIGHT < win.bottom || z - SCREEN_HALF_HEIGHT > win.top) continue;
          hours.push(h);
          causes.add(win.openingId);
        }
        // a flash of a few minutes is no problem: only count 30 minutes and more
        for (const r of ranges(hours)) if (r.to - r.from >= MIN_SPAN) spans.push({ season, from: r.from, to: r.to });
      }
      if (spans.length) {
        const perSeason = SEASONS.map((season) => spans.filter((x) => x.season === season).reduce((sum, x) => sum + (x.to - x.from), 0));
        out.push({ ...base, kind: 'reflection', spans, hours: Math.max(...perSeason), openingIds: [...causes] });
      }
    }

    // backlight: a window lies behind the screen, seen from the viewer
    const view = normalize(sub(s.pos, s.viewer));
    const behind = new Map<string, WindowLight>();
    for (const off of [-BACKLIGHT_CONE, 0, BACKLIGHT_CONE]) {
      const a = rad(off);
      const dir = { x: view.x * Math.cos(a) - view.y * Math.sin(a), y: view.x * Math.sin(a) + view.y * Math.cos(a) };
      const hit = rayToWall(s.pos, dir, outline);
      const win = hit && windowAtPoint(hit.point, roomWindows);
      // a window is only in the way when the screen stands in front of the glass, not far away from it
      if (hit && win && win.bottom < 1.7 && win.top > 0.8) behind.set(win.openingId, win);
    }
    if (behind.size) {
      // glare is strongest while the sun shines onto these windows
      const spans: GlareSpan[] = [];
      for (const season of SEASONS) {
        const hours: number[] = [];
        for (let h = 5; h < 22; h += STEP) {
          const sun = sunPosition(season, h + STEP / 2, latitude);
          if (sun.elevation < MIN_ELEVATION) continue;
          if ([...behind.values()].some((w) => angleBetween(sun.azimuth, w.bearing) <= 80)) hours.push(h);
        }
        for (const r of ranges(hours)) spans.push({ season, from: r.from, to: r.to });
      }
      const perSeason = SEASONS.map((season) => spans.filter((x) => x.season === season).reduce((sum, x) => sum + (x.to - x.from), 0));
      out.push({ ...base, kind: 'backlight', spans, hours: Math.max(...perSeason), openingIds: [...behind.keys()] });
    }
  }
  return out;
}

const angleBetween = (a: number, b: number): number => {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
};

/** "Winter 14:30–16:15 Uhr · Sommer 17:45–18:30 Uhr". */
export function glareSpansLabel(spans: GlareSpan[]): string {
  return SEASONS.map((season) => {
    const list = spans.filter((x) => x.season === season);
    return list.length ? `${GLARE_SEASON_LABEL[season]} ${list.map((x) => `${formatClock(x.from)}–${formatClock(x.to)}`).join(', ')} Uhr` : null;
  })
    .filter(Boolean)
    .join(' · ');
}

