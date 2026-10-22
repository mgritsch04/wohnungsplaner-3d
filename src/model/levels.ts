import { newId } from './ids';
import type { Furniture, Level, LevelPlan, Project } from './schema';

/**
 * Storeys (#54). The active storey's plan lives in the project's top-level fields, so the
 * editors, views and checks keep working on one storey as before; the plans of the other
 * storeys are stored in `Level.plan`. Switching storeys swaps the two (one draft change).
 */

/** Project fields that belong to a storey (see LevelPlanSchema). */
export const LEVEL_PLAN_KEYS = ['nodes', 'walls', 'openings', 'rooms', 'furniture', 'lights', 'groups', 'devices', 'fixtures', 'loads', 'notes', 'photos', 'underlay'] as const;

/** Height of a newly added storey above the one below when nothing else is known (m). */
export const DEFAULT_STOREY_HEIGHT = 2.8;

export function emptyLevelPlan(): LevelPlan {
  return { nodes: [], walls: [], openings: [], rooms: [], furniture: [], lights: [], groups: [], devices: [], fixtures: [], loads: [], notes: [], photos: [], underlay: null };
}

/** The active storey's plan, taken from the top-level fields (same objects, not copied). */
export function activePlan(p: Project): LevelPlan {
  const plan = {} as Record<string, unknown>;
  for (const k of LEVEL_PLAN_KEYS) plan[k] = p[k];
  return plan as LevelPlan;
}

/** Storeys from the lowest to the highest. */
export function sortedLevels(p: Pick<Project, 'levels'>): Level[] {
  return [...p.levels].sort((a, b) => a.elevation - b.elevation);
}

export function activeLevel(p: Pick<Project, 'levels' | 'activeLevelId'>): Level {
  return p.levels.find((l) => l.id === p.activeLevelId) ?? p.levels[0];
}

/** Plan of any storey: the top-level fields for the active one, else the stored plan. */
export function planOfLevel(p: Project, levelId: string): LevelPlan {
  if (levelId === p.activeLevelId) return activePlan(p);
  return p.levels.find((l) => l.id === levelId)?.plan ?? emptyLevelPlan();
}

/** The project as if `levelId` were the active storey – for drawing or checking another storey (read only). */
export function projectOnLevel(p: Project, levelId: string): Project {
  if (levelId === p.activeLevelId) return p;
  return { ...p, ...planOfLevel(p, levelId), activeLevelId: levelId };
}

/** Plans of all storeys (active first), e.g. to collect the assets they use. */
export function allLevelPlans(p: Project): LevelPlan[] {
  return [activePlan(p), ...p.levels.filter((l) => l.id !== p.activeLevelId && l.plan).map((l) => l.plan!)];
}

/**
 * Height of a storey: distance to the next storey above, else the highest wall of the storey
 * (or the default wall height when it has no walls).
 */
export function storeyHeight(p: Project, levelId: string): number {
  const levels = sortedLevels(p);
  const i = levels.findIndex((l) => l.id === levelId);
  if (i < 0) return p.settings.defaultWallHeight;
  if (i + 1 < levels.length) return levels[i + 1].elevation - levels[i].elevation;
  const walls = planOfLevel(p, levelId).walls;
  return walls.length ? Math.max(...walls.map((w) => w.height)) : p.settings.defaultWallHeight;
}

/** Storey directly above / below the active one, if any. */
export function neighbourLevel(p: Project, dir: 1 | -1, from = p.activeLevelId): Level | undefined {
  const levels = sortedLevels(p);
  const i = levels.findIndex((l) => l.id === from);
  return i < 0 ? undefined : levels[i + dir];
}

/** Usual German name of a storey by its position (0 = ground floor). */
export function defaultLevelName(index: number): string {
  if (index === 0) return 'Erdgeschoss';
  if (index > 0) return `${index}. Obergeschoss`;
  return index === -1 ? 'Keller' : `${-index}. Untergeschoss`;
}

/** Make `levelId` the active storey (in a draft): the plans of the two storeys swap places. */
export function switchLevel(d: Project, levelId: string): boolean {
  if (levelId === d.activeLevelId) return false;
  const target = d.levels.find((l) => l.id === levelId);
  const current = d.levels.find((l) => l.id === d.activeLevelId);
  if (!target) return false;
  const stored = target.plan ?? emptyLevelPlan();
  if (current) current.plan = activePlan(d);
  Object.assign(d, stored);
  delete target.plan;
  d.activeLevelId = levelId;
  return true;
}

export interface NewLevelOptions {
  /** Above (default) or below the existing storeys. */
  where?: 'above' | 'below';
  name?: string;
  /** Copy the outline of the active storey: walls, rooms and windows (doors are left out). */
  copyWalls?: boolean;
}

/** Add a storey (in a draft) above the highest or below the lowest one; returns its id. It does not become active. */
export function addLevel(d: Project, opts: NewLevelOptions = {}): string {
  const levels = sortedLevels(d);
  const where = opts.where ?? 'above';
  const edge = where === 'above' ? levels[levels.length - 1] : levels[0];
  const height = where === 'above' ? storeyHeight(d, edge.id) : DEFAULT_STOREY_HEIGHT;
  const elevation = Math.round((edge.elevation + (where === 'above' ? height : -height)) * 1000) / 1000;
  const groundIndex = levels.findIndex((l) => Math.abs(l.elevation) < 1e-6);
  const index = groundIndex < 0 ? (where === 'above' ? levels.length : -1) : where === 'above' ? levels.length - groundIndex : -groundIndex - 1;
  const id = newId('level');
  const plan = opts.copyWalls ? copyOutline(activePlan(d)) : emptyLevelPlan();
  d.levels.push({ id, name: (opts.name ?? defaultLevelName(index)).slice(0, 60), elevation, plan });
  d.levels = sortedLevels(d);
  return id;
}

/** Walls, rooms and windows of a plan with new ids (the start of a storey above or below). */
function copyOutline(src: LevelPlan): LevelPlan {
  const ids = new Map<string, string>();
  const map = (id: string, prefix: string) => {
    let n = ids.get(id);
    if (!n) ids.set(id, (n = newId(prefix)));
    return n;
  };
  const plan = emptyLevelPlan();
  plan.nodes = src.nodes.map((n) => ({ ...n, id: map(n.id, 'node') }));
  plan.walls = src.walls.map((w) => ({ ...structuredClone(w), id: map(w.id, 'wall'), a: map(w.a, 'node'), b: map(w.b, 'node') }));
  plan.rooms = src.rooms.map((r) => ({ ...structuredClone(r), id: map(r.id, 'room'), nodeIds: r.nodeIds.map((n) => map(n, 'node')) }));
  plan.openings = src.openings.filter((o) => o.kind === 'window').map((o) => ({ ...structuredClone(o), id: newId('opening'), wallId: map(o.wallId, 'wall') }));
  return plan;
}

export function renameLevel(d: Project, levelId: string, name: string): void {
  const l = d.levels.find((x) => x.id === levelId);
  if (l) l.name = name.slice(0, 60);
}

/** Change the floor height of a storey (m above the ground storey); the list stays sorted. */
export function setLevelElevation(d: Project, levelId: string, elevation: number): void {
  const l = d.levels.find((x) => x.id === levelId);
  if (!l || !Number.isFinite(elevation)) return;
  l.elevation = Math.round(Math.min(500, Math.max(-50, elevation)) * 1000) / 1000;
  d.levels = sortedLevels(d);
}

/** Remove a storey with its plan (in a draft). The last storey stays; removing the active one switches to a neighbour. */
export function deleteLevel(d: Project, levelId: string): boolean {
  if (d.levels.length <= 1 || !d.levels.some((l) => l.id === levelId)) return false;
  if (levelId === d.activeLevelId) {
    const next = neighbourLevel(d, -1, levelId) ?? neighbourLevel(d, 1, levelId);
    if (!next || !switchLevel(d, next.id)) return false;
  }
  d.levels = d.levels.filter((l) => l.id !== levelId);
  return true;
}

/**
 * Repair the storey list of a loaded project: the active id must name a storey and that storey
 * carries no stored plan (its plan is the top-level fields); storeys sorted by elevation.
 * Returns what was repaired.
 */
export function normalizeLevels(p: Project): string[] {
  const fixed: string[] = [];
  if (!p.levels.some((l) => l.id === p.activeLevelId)) {
    p.activeLevelId = (p.levels.find((l) => !l.plan) ?? p.levels[0]).id;
    fixed.push('Aktive Etage war unbekannt und wurde neu gesetzt.');
  }
  const active = p.levels.find((l) => l.id === p.activeLevelId)!;
  if (active.plan) {
    delete active.plan;
    fixed.push(`Doppelt gespeicherter Plan der Etage „${active.name}“ wurde verworfen.`);
  }
  p.levels = sortedLevels(p);
  return fixed;
}

/** Storey a piece of furniture stands on, or undefined when it is in none (#54). */
export function levelOfFurniture(p: Project, id: string): string | undefined {
  if (p.furniture.some((f) => f.id === id)) return p.activeLevelId;
  return p.levels.find((l) => l.plan?.furniture.some((f) => f.id === id))?.id;
}

/** A piece of furniture on any storey (in a draft it can be changed in place). */
export function furnitureOnAnyLevel(p: Project, id: string): Furniture | undefined {
  return p.furniture.find((f) => f.id === id) ?? p.levels.flatMap((l) => l.plan?.furniture ?? []).find((f) => f.id === id);
}
