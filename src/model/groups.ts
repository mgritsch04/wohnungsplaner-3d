/**
 * Permanent furniture groups (#65), e.g. a kitchen run or a dining set.
 *
 * Data model: an item names its group in `Furniture.groupId`; `Project.groups` only holds
 * the group names. An item can therefore never be in two groups, and deleting or copying
 * items needs no member-list upkeep – `pruneGroups` drops groups with fewer than two
 * members afterwards.
 *
 * A group moves and turns rigidly: the collision check applies to the group as a whole
 * (members never block each other; the group stops – or slides along a wall – as soon as
 * one member would run into a wall, door leaf or other furniture).
 */
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { newId } from './ids';
import { collidingObstacles, constrainMove, moveCollision, type Obstacle, type Pose } from './placement';
import type { Furniture, FurnitureGroup, Project } from './schema';
import { normalizeAngle } from './units';
import { add, boundsOf, rotate, sub, type Bounds, type Vec2 } from './vec';

type Groupable = Pick<Project, 'furniture' | 'groups'>;

const mm = (v: number) => Math.round(v * 1000) / 1000;

/** Ids of the members of group `groupId` (project order). */
export function groupMemberIds(p: Pick<Project, 'furniture'>, groupId: string): string[] {
  return p.furniture.filter((f) => f.groupId === groupId).map((f) => f.id);
}

/** Group of item `id` – only if it really is a group (at least two members). */
export function groupOf(p: Pick<Project, 'furniture'>, id: string): string | null {
  const gid = p.furniture.find((f) => f.id === id)?.groupId;
  if (!gid) return null;
  return groupMemberIds(p, gid).length >= 2 ? gid : null;
}

/** Display name of a group (falls back to „Gruppe“ for a group without a name entry). */
export function groupName(p: Pick<Project, 'groups'>, groupId: string): string {
  return p.groups.find((g) => g.id === groupId)?.name.trim() || 'Gruppe';
}

/** First free „Gruppe N“. */
export function defaultGroupName(p: Pick<Project, 'groups'>): string {
  const used = new Set(p.groups.map((g) => g.name.trim()));
  let n = 1;
  while (used.has(`Gruppe ${n}`)) n++;
  return `Gruppe ${n}`;
}

/** `base`, or `base 2`, `base 3` … if the name is taken. */
function uniqueGroupName(p: Pick<Project, 'groups'>, base: string): string {
  const used = new Set(p.groups.map((g) => g.name.trim()));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Every id pulls in its whole group: the given ids keep their order (the first stays the
 * primary selection), missing group members follow in project order.
 */
export function expandToGroups(p: Pick<Project, 'furniture'>, ids: string[]): string[] {
  const out = [...new Set(ids)];
  const seen = new Set(out);
  for (const id of [...out]) {
    const gid = groupOf(p, id);
    if (!gid) continue;
    for (const m of groupMemberIds(p, gid)) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
  }
  return out;
}

/** The group that exactly these ids form (all members, nothing else), or null. */
export function selectedGroup(p: Pick<Project, 'furniture'>, ids: string[]): string | null {
  if (ids.length < 2) return null;
  const gid = groupOf(p, ids[0]);
  if (!gid) return null;
  const members = groupMemberIds(p, gid);
  const set = new Set(ids);
  return set.size === members.length && members.every((m) => set.has(m)) ? gid : null;
}

export interface PressResult {
  /** New furniture selection, primary first. */
  ids: string[];
  /**
   * Set when the whole group was already selected: a click on member `drill` without
   * dragging then selects just that item (second click = single item).
   */
  drill: string | null;
}

/**
 * Selection after pressing on furniture `hit` (2D and 3D share this rule):
 * - first click on a group member selects the whole group (the clicked item is primary);
 * - pressing on a member of the selected group keeps the group (so it can be dragged) –
 *   released without dragging, only that member is selected (`drill`);
 * - while a single member is selected, a click on another member selects that one;
 * - Shift toggles a whole group (or a single item) in or out of the selection;
 * - pressing on an item of a multi-selection keeps the selection (drag moves all).
 */
export function pressFurniture(p: Pick<Project, 'furniture'>, current: string[], hit: string, shift: boolean): PressResult {
  const gid = groupOf(p, hit);
  const unit = gid ? groupMemberIds(p, gid) : [hit];
  if (shift) {
    const allIn = unit.every((id) => current.includes(id));
    const ids = allIn ? current.filter((id) => !unit.includes(id)) : [...current, ...unit.filter((id) => !current.includes(id))];
    return { ids, drill: null };
  }
  if (current.length > 1 && current.includes(hit)) {
    return { ids: current, drill: gid && selectedGroup(p, current) === gid ? hit : null };
  }
  if (gid) {
    if (current.length === 1 && groupOf(p, current[0]) === gid) return { ids: [hit], drill: null };
    return { ids: [hit, ...unit.filter((id) => id !== hit)], drill: null };
  }
  return { ids: [hit], drill: null };
}

/**
 * Remove groups with fewer than two members (their last member becomes a normal item) and
 * give member ids without a name entry one – keeps `groups` and `groupId` consistent after
 * deleting, copying or importing items.
 */
export function pruneGroups(d: Groupable): void {
  const count = new Map<string, number>();
  for (const f of d.furniture) if (f.groupId) count.set(f.groupId, (count.get(f.groupId) ?? 0) + 1);
  for (const f of d.furniture) if (f.groupId && (count.get(f.groupId) ?? 0) < 2) delete f.groupId;
  d.groups = d.groups.filter((g) => (count.get(g.id) ?? 0) >= 2);
  for (const [id, n] of count) if (n >= 2 && !d.groups.some((g) => g.id === id)) d.groups.push({ id, name: defaultGroupName(d) });
}

/**
 * Group the items `ids` (at least two) under `name` (default „Gruppe N“). Items that were in
 * another group leave it. Returns the new group id, or null if fewer than two items exist.
 */
export function createGroup(d: Groupable, ids: string[], name?: string): string | null {
  const set = new Set(ids);
  const items = d.furniture.filter((f) => set.has(f.id));
  if (items.length < 2) return null;
  const id = newId('group');
  const label = name?.trim().slice(0, 100) || defaultGroupName(d);
  for (const f of items) f.groupId = id;
  d.groups.push({ id, name: label });
  pruneGroups(d);
  return id;
}

/** Dissolve the groups `groupIds`: their items stay where they are. Returns the number of items released. */
export function dissolveGroups(d: Groupable, groupIds: string[]): number {
  const set = new Set(groupIds);
  let n = 0;
  for (const f of d.furniture) {
    if (f.groupId && set.has(f.groupId)) {
      delete f.groupId;
      n++;
    }
  }
  d.groups = d.groups.filter((g) => !set.has(g.id));
  return n;
}

/** Take item `id` out of its group (a group left with one item dissolves). */
export function removeFromGroup(d: Groupable, id: string): boolean {
  const f = d.furniture.find((x) => x.id === id);
  if (!f?.groupId) return false;
  delete f.groupId;
  pruneGroups(d);
  return true;
}

/** Rename a group (trimmed, max. 100 characters; empty names are ignored). */
export function renameGroup(d: Pick<Project, 'groups'>, groupId: string, name: string): boolean {
  const g = d.groups.find((x) => x.id === groupId);
  const v = name.trim().slice(0, 100);
  if (!g || !v || v === g.name) return false;
  g.name = v;
  return true;
}

/**
 * Copies of grouped items (paste, duplicate): copies of at least two members of one group
 * form a NEW group („Name (Kopie)“); a lone copied member is not grouped.
 * `copies` maps each new item id to the source's group id; `sourceGroups` are the group
 * names at copy time (the source group may be gone by now).
 */
export function regroupCopies(d: Groupable, copies: { id: string; sourceGroupId?: string }[], sourceGroups: FurnitureGroup[]): void {
  const bySource = new Map<string, string[]>();
  for (const c of copies) if (c.sourceGroupId) bySource.set(c.sourceGroupId, [...(bySource.get(c.sourceGroupId) ?? []), c.id]);
  for (const [src, ids] of bySource) {
    const items = d.furniture.filter((f) => ids.includes(f.id));
    if (items.length < 2) {
      for (const f of items) delete f.groupId;
      continue;
    }
    const id = newId('group');
    const base = sourceGroups.find((g) => g.id === src)?.name.trim() || 'Gruppe';
    d.groups.push({ id, name: uniqueGroupName(d, `${base} (Kopie)`) });
    for (const f of items) f.groupId = id;
  }
  pruneGroups(d);
}

/**
 * Pivot of a group: centre of its footprints weighted by footprint area (a table counts more
 * than a chair). Turning the group about it keeps it in place: unlike the bounding-box
 * centre it does not change when the group is rotated, so 24 × 15° returns to the start.
 */
export function groupCenter(items: Pick<Furniture, 'x' | 'y' | 'width' | 'depth'>[]): Vec2 {
  let w = 0;
  let x = 0;
  let y = 0;
  for (const f of items) {
    const a = Math.max(f.width * f.depth, 1e-6);
    w += a;
    x += f.x * a;
    y += f.y * a;
  }
  return w > 0 ? { x: x / w, y: y / w } : { x: 0, y: 0 };
}

/** Axis-aligned bounds of the footprints of `items` (2D outline). */
export function groupBounds(items: Pick<Furniture, 'x' | 'y' | 'width' | 'depth' | 'rotation'>[]): Bounds | null {
  return boundsOf(items.flatMap((f) => furnitureCorners(f)));
}

const members = (d: Pick<Project, 'furniture'>, ids: string[]) => {
  const set = new Set(ids);
  return d.furniture.filter((f) => set.has(f.id));
};

/** Obstacles a member must not run into: everything but the other members of the moving set. */
function memberObstacles(d: Project, f: Furniture, obstacles: Obstacle[], set: Set<string>) {
  const m = moveCollision(d, f, obstacles);
  return { ...m, obstacles: m.obstacles.filter((o) => !(o.kind === 'furniture' && set.has(o.refId))) };
}

/**
 * Move the items `ids` rigidly by `delta` (plan metres). With `collide`, the whole group
 * stops where its first member would hit a wall, door leaf or other furniture, and slides
 * along it if the move is diagonal (each axis is limited by the most blocked member).
 * Locked members keep the whole group in place. Returns the delta actually applied.
 */
export function moveGroupBy(d: Project, obstacles: Obstacle[], ids: string[], delta: Vec2, opts: { collide: boolean }): Vec2 {
  const items = members(d, ids);
  if (!items.length || items.some((f) => f.locked)) return { x: 0, y: 0 };
  let step = delta;
  if (opts.collide) {
    const set = new Set(items.map((f) => f.id));
    const checks = items.map((f) => {
      const m = memberObstacles(d, f, obstacles, set);
      // free items (rugs) are tested with a 1 m tall pose against walls only
      const current: Pose = m.free ? { ...f, elevation: 0, height: 1 } : f;
      // obstacles a member already overlaps (placed with Alt) do not hold the group
      const stuck = new Set(collidingObstacles(current, m.obstacles));
      return { f, m, current, active: m.obstacles.filter((o) => !stuck.has(o)) };
    });
    // how far each member alone could go (sliding along walls) → per axis the most limited one
    let sx = delta.x;
    let sy = delta.y;
    for (const c of checks) {
      const r = constrainMove(c.m.pose, { x: c.f.x + delta.x, y: c.f.y + delta.y }, c.m.obstacles, undefined, c.current);
      const ax = r.x - c.f.x;
      const ay = r.y - c.f.y;
      sx = delta.x >= 0 ? Math.min(sx, Math.max(0, ax)) : Math.max(sx, Math.min(0, ax));
      sy = delta.y >= 0 ? Math.min(sy, Math.max(0, ay)) : Math.max(sy, Math.min(0, ay));
    }
    const free = (s: Vec2) => checks.every((c) => !collidingObstacles({ ...c.current, x: c.f.x + s.x, y: c.f.y + s.y }, c.active).length);
    step = { x: sx, y: sy };
    if (!free(step)) {
      // the combined step still collides (e.g. at a corner): largest free fraction of it
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (free({ x: step.x * mid, y: step.y * mid })) lo = mid;
        else hi = mid;
      }
      step = { x: step.x * lo, y: step.y * lo };
    }
  }
  for (const f of items) {
    f.x = mm(f.x + step.x);
    f.y = mm(f.y + step.y);
  }
  return step;
}

/** Turn the items `ids` by `deltaRad` about `center` (no collision check – used while dragging the handle). */
export function rotateGroupPoses(d: Pick<Project, 'furniture'>, ids: string[], deltaRad: number, center: Vec2): void {
  for (const f of members(d, ids)) {
    const p = add(center, rotate(sub({ x: f.x, y: f.y }, center), deltaRad));
    f.x = mm(p.x);
    f.y = mm(p.y);
    f.rotation = normalizeAngle(f.rotation + deltaRad);
  }
}

/**
 * Turn the items `ids` rigidly by `deltaRad` about their area-weighted centre. Like turning
 * a single item into an obstacle with no free spot nearby, the group is turned anyway and a
 * new collision reported ('conflict', marked red; Strg+Z reverts it). 'locked' = a member
 * is locked, nothing changed.
 */
export function rotateGroupBy(d: Project, obstacles: Obstacle[], ids: string[], deltaRad: number): 'ok' | 'conflict' | 'locked' {
  const items = members(d, ids);
  if (!items.length) return 'ok';
  if (items.some((f) => f.locked)) return 'locked';
  const set = new Set(items.map((f) => f.id));
  const before = items.map((f) => {
    const m = memberObstacles(d, f, obstacles, set);
    const pose: Pose = m.free ? { ...f, elevation: 0, height: 1 } : { ...f };
    return { id: f.id, free: m.free, obstacles: m.obstacles, stuck: new Set(collidingObstacles(pose, m.obstacles)) };
  });
  rotateGroupPoses(d, ids, deltaRad, groupCenter(items));
  for (const b of before) {
    const f = d.furniture.find((x) => x.id === b.id)!;
    const pose: Pose = b.free ? { ...f, elevation: 0, height: 1 } : f;
    if (collidingObstacles(pose, b.obstacles.filter((o) => !b.stuck.has(o))).length) return 'conflict';
  }
  return 'ok';
}
