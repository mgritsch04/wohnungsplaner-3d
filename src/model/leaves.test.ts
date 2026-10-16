import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addRectRoom, closestWall, setOpeningOpen } from './operations';
import { derivePlan } from './derived';
import { buildPlacementObstacles, collidingObstacles, constrainMove, issueLevel, placementIssues, type Pose } from './placement';
import { LEAF_OPEN_ANGLE, leafPolygon, leafTip } from './geometry/leaves';
import { doorSymbol } from '../editor2d/openingSymbols';
import { add, dot, normalize, perp, pointInPolygon, scale, sub } from './vec';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createSampleProject } from './sample';
import { parseProject, serializeProject } from '../formats/project/projectFile';
import { buildColliders, resolveCollisions } from '../view3d/collision';
import { useProjectStore } from '../store/projectStore';
import { toggleOpening } from '../ui/actions';
import type { Project } from './schema';

const T = 0.12;
const pose = (x: number, y: number, w = 1, d = 0.6, rotation = 0, height = 0.8, elevation = 0): Pose => ({ x, y, width: w, depth: d, rotation, height, elevation });

/** Room A (interior 0..4 × 0..3) and room B (4.12..7.12) with a 90 cm door in the shared wall. */
function twoRooms() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
  addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'B', thickness: T, height: 2.6 });
  const w = closestWall(p, { x: 4.06, y: 1.5 })!;
  const id = addOpening(p, w.wall.id, 'door', w.s, { width: 0.9, swing: 'left' })!;
  return { p, id };
}

/** Room A with a window in the north wall (centre x = 2, sill 90 cm, height 140 cm). */
function roomWithWindow(width: number, overrides: { hinge?: 'start' | 'end' } = {}) {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
  const w = closestWall(p, { x: 2, y: -0.06 })!;
  const id = addOpening(p, w.wall.id, 'window', w.s, { width, ...overrides })!;
  return { p, id };
}

const leafObstacles = (p: Project) => buildPlacementObstacles(derivePlan(p)).filter((o) => o.kind === 'door-leaf');

describe('open/closed state in the data model (#21)', () => {
  it('new doors are open (as drawn in the plan), windows closed; passages have no leaf', () => {
    const { p, id } = twoRooms();
    const w = closestWall(p, { x: 2, y: -0.06 })!;
    const win = addOpening(p, w.wall.id, 'window', 1.5)!;
    const pass = addOpening(p, w.wall.id, 'passage', 3.2)!;
    const byId = (x: string) => p.openings.find((o) => o.id === x)!;
    expect(byId(id).open).toBe(true);
    expect(byId(win).open).toBe(false);
    expect(setOpeningOpen(p, id)).toBe(false);
    expect(byId(id).open).toBe(false);
    expect(setOpeningOpen(p, win, true)).toBe(true);
    expect(setOpeningOpen(p, pass)).toBeNull();
    expect(setOpeningOpen(p, 'missing')).toBeNull();
    expect(derivePlan(p).leaves.has(pass)).toBe(false);
  });

  it('projects saved before #21 (no `open` field) load with doors open and windows closed; the state round-trips', () => {
    const sample = createSampleProject();
    const old = JSON.parse(serializeProject(sample)) as { openings: Record<string, unknown>[] };
    for (const o of old.openings) delete o.open;
    const loaded = parseProject(old).project;
    for (const o of loaded.openings) expect(o.open).toBe(o.kind === 'door');
    // an explicitly stored state is kept (also a closed door / an open window)
    const changed = structuredClone(loaded);
    for (const o of changed.openings) o.open = o.kind !== 'door';
    const back = parseProject(JSON.parse(serializeProject(changed))).project;
    expect(back.openings.map((o) => o.open)).toEqual(changed.openings.map((o) => o.open));
  });
});

describe('door leaves and window sashes (derived geometry)', () => {
  it('door leaf: hinge and swing side from the opening data, open tip = the plan symbol', () => {
    const { p, id } = twoRooms();
    const d = derivePlan(p);
    const [leaf] = d.leaves.get(id)!;
    const r = [...d.openings.values()].flat().find((x) => x.opening.id === id)!;
    const ds = doorSymbol(d.footprints.get(r.opening.wallId)!, r);
    expect(leaf.kind).toBe('door');
    expect(leaf.hinge.x).toBeCloseTo(ds.hinge.x, 9);
    expect(leaf.hinge.y).toBeCloseTo(ds.hinge.y, 9);
    const tip = leafTip(leaf, LEAF_OPEN_ANGLE);
    expect(tip.x).toBeCloseTo(ds.openTip.x, 9);
    expect(tip.y).toBeCloseTo(ds.openTip.y, 9);
    const closed = leafTip(leaf, 0);
    expect(closed.x).toBeCloseTo(ds.closedTip.x, 9);
    expect(closed.y).toBeCloseTo(ds.closedTip.y, 9);
  });

  it('a single-sash window opens into the room, hinged at the side given in the data', () => {
    for (const hinge of ['start', 'end'] as const) {
      const { p, id } = roomWithWindow(1.2, { hinge });
      const d = derivePlan(p);
      const leaves = d.leaves.get(id)!;
      expect(leaves).toHaveLength(1);
      const [s] = leaves;
      expect(s.kind).toBe('window');
      expect(s.swingDir.y).toBeCloseTo(1, 9); // room A lies at y > 0
      expect(s.width).toBeCloseTo(1.2 - 2 * 0.07, 9);
      expect(s.z0).toBeCloseTo(0.9 + 0.07, 9);
      expect(s.z1).toBeCloseTo(0.9 + 1.4 - 0.07, 9);
      const fp = d.footprints.get(p.openings[0].wallId)!;
      // hinge at the opening edge towards wall start (`start`) or end (`end`)
      const along = dot(sub(s.hinge, fp.a), fp.dir);
      expect(along).toBeCloseTo(hinge === 'start' ? 2 + 0.06 - 0.6 + 0.07 : 2 + 0.06 + 0.6 - 0.07, 6);
      expect(pointInPolygon(add(s.hinge, scale(s.swingDir, s.width / 2)), d.rooms.values().next().value!.interior)).toBe(true);
    }
  });

  it('a wide window gets two sashes hinged at the outer sides', () => {
    const { p, id } = roomWithWindow(1.8);
    const [a, b] = derivePlan(p).leaves.get(id)!;
    expect(a.width).toBeCloseTo((1.8 - 0.14) / 2, 9);
    expect(dot(a.closedDir, b.closedDir)).toBeCloseTo(-1, 9);
    // free edges meet in the middle
    const ta = leafTip(a, 0);
    const tb = leafTip(b, 0);
    expect(Math.hypot(ta.x - tb.x, ta.y - tb.y)).toBeLessThan(1e-9);
  });

  it('a window between two rooms (or outside any) follows the swing field', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
    addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'B', thickness: T, height: 2.6 });
    const w = closestWall(p, { x: 4.06, y: 1.5 })!;
    const left = addOpening(p, w.wall.id, 'window', 0.8, { width: 0.8, swing: 'left' })!;
    const right = addOpening(p, w.wall.id, 'window', 2.2, { width: 0.8, swing: 'right' })!;
    const d = derivePlan(p);
    const fp = d.footprints.get(w.wall.id)!;
    expect(dot(d.leaves.get(left)![0].swingDir, fp.normal)).toBeCloseTo(1, 9);
    expect(dot(d.leaves.get(right)![0].swingDir, fp.normal)).toBeCloseTo(-1, 9);
  });
});

describe('collision with opened leaves (#21)', () => {
  it('an open door keeps exactly the previous door-leaf obstacle (90°, 4.5 cm thick, above the undercut)', () => {
    const { p, id } = twoRooms();
    const d = derivePlan(p);
    const [leaf] = leafObstacles(p);
    expect(leaf.refId).toBe(id);
    const r = [...d.openings.values()].flat().find((x) => x.opening.id === id)!;
    const ds = doorSymbol(d.footprints.get(r.opening.wallId)!, r);
    const side = scale(perp(normalize(sub(ds.openTip, ds.hinge))), 0.045 / 2);
    const expected = [add(ds.hinge, side), add(ds.openTip, side), sub(ds.openTip, side), sub(ds.hinge, side)];
    leaf.polygon.forEach((q, i) => {
      expect(q.x).toBeCloseTo(expected[i].x, 9);
      expect(q.y).toBeCloseTo(expected[i].y, 9);
    });
    expect(leaf.z0).toBeCloseTo(r.bottom + 0.015, 9);
    expect(leaf.z1).toBeCloseTo(r.top, 9);
  });

  it('a closed door blocks nothing extra: no leaf error, the swing warning stays', () => {
    const { p, id } = twoRooms();
    const openObs = buildPlacementObstacles(derivePlan(p));
    const leaf = openObs.find((o) => o.kind === 'door-leaf')!;
    const lc = { x: leaf.polygon.reduce((s, q) => s + q.x, 0) / 4, y: leaf.polygon.reduce((s, q) => s + q.y, 0) / 4 };
    const sofa = createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: lc.x, y: lc.y, rotation: 0 });
    p.furniture.push(sofa);
    expect(placementIssues(p, derivePlan(p), sofa).map((i) => i.kind)).toContain('door-leaf');

    setOpeningOpen(p, id, false);
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    expect(obs.filter((o) => o.kind === 'door-leaf')).toEqual([]);
    expect(obs.length).toBe(openObs.length - 1); // walls unchanged
    const issues = placementIssues(p, d, sofa, obs);
    expect(issues.map((i) => i.kind)).not.toContain('door-leaf');
    const swing = issues.find((i) => i.kind === 'door-swing')!;
    expect(swing.refId).toBe(id);
    expect(issueLevel(swing.kind)).toBe('warn');
    // dragging an item across the (closed) leaf position is no longer stopped by the leaf
    const towardsMiddle = Math.sign(1.5 - lc.y);
    const start = pose(lc.x, lc.y + towardsMiddle * 0.6, 0.5, 0.4, 0, 0.8);
    const goal = { x: lc.x, y: lc.y - towardsMiddle * 0.25 };
    expect(collidingObstacles(start, openObs)).toHaveLength(0);
    expect(constrainMove(start, goal, obs).blocked).toBe(false);
    expect(constrainMove(start, goal, openObs).blocked).toBe(true);
  });

  it('a closed window adds no obstacle; an opened sash blocks tall furniture in front of it, not low furniture below the sill', () => {
    const { p, id } = roomWithWindow(1.2);
    expect(leafObstacles(p)).toEqual([]);
    setOpeningOpen(p, id, true);
    const d = derivePlan(p);
    const [sash] = d.leaves.get(id)!;
    const obs = buildPlacementObstacles(d);
    const [ob] = obs.filter((o) => o.kind === 'door-leaf');
    expect(ob.refId).toBe(id);
    expect(ob.z0).toBeCloseTo(0.97, 9);
    expect(ob.polygon).toEqual(leafPolygon(sash, LEAF_OPEN_ANGLE));
    // the opened sash reaches about its width into the room
    expect(Math.max(...ob.polygon.map((q) => q.y))).toBeGreaterThan(1);
    const at = add(sash.hinge, scale(sash.swingDir, 0.5));
    const wardrobe = createFurnitureFromCatalog(findCatalogItem('generic-wardrobe-150')!, { x: at.x, y: at.y, rotation: 0 });
    const sideboard = { ...wardrobe, id: 'low', height: 0.8, name: 'Sideboard' };
    p.furniture.push(wardrobe);
    const hit = placementIssues(p, d, wardrobe, obs).find((i) => i.kind === 'door-leaf')!;
    expect(hit.refId).toBe(id);
    expect(hit.message).toBe('Steht im geöffneten Fensterflügel – Fenster 120 cm (A).');
    expect(issueLevel(hit.kind)).toBe('error');
    expect(placementIssues(p, d, sideboard, obs).some((i) => i.kind === 'door-leaf')).toBe(false);
    // dragging a tall item sideways into the opened sash stops at it
    const tall = pose(at.x + 1.2, at.y, 0.6, 0.4, 0, 2.0);
    expect(constrainMove(tall, { x: at.x - 0.4, y: at.y }, obs).blocked).toBe(true);
    // closed again: the wardrobe is free
    setOpeningOpen(p, id, false);
    expect(placementIssues(p, derivePlan(p), wardrobe).some((i) => i.kind === 'door-leaf')).toBe(false);
  });
});

describe('walkthrough through doors (#21)', () => {
  it('an open door is passable, a closed one blocks the way', () => {
    const { p, id } = twoRooms();
    const door = p.openings.find((o) => o.id === id)!;
    const fp = derivePlan(p).footprints.get(door.wallId)!;
    const doorY = fp.a.y + fp.dir.y * door.offset;
    const walk = () => {
      const colliders = buildColliders(derivePlan(p), []);
      let pos = { x: 3.0, y: doorY };
      for (let i = 0; i < 80; i++) pos = resolveCollisions({ x: pos.x + 0.04, y: pos.y }, colliders);
      return pos;
    };
    expect(walk().x).toBeGreaterThan(4.5); // through the doorway into room B
    setOpeningOpen(p, id, false);
    expect(walk().x).toBeLessThan(4.0 - 0.2 + 1e-6); // stopped in front of the closed door
  });
});

describe('toggling in the app: one undo step each (#21)', () => {
  beforeEach(() => useProjectStore.getState().load(createSampleProject()));

  it('toggles a door, undo restores it; passages are left alone', () => {
    const s = useProjectStore.getState;
    const door = s().project.openings.find((o) => o.kind === 'door')!;
    const past = s().past.length;
    expect(toggleOpening(door.id)).toBe(false);
    expect(s().project.openings.find((o) => o.id === door.id)!.open).toBe(false);
    expect(s().past.length).toBe(past + 1);
    expect(toggleOpening(door.id)).toBe(true);
    expect(s().past.length).toBe(past + 2);
    s().undo();
    expect(s().project.openings.find((o) => o.id === door.id)!.open).toBe(false);
    s().undo();
    expect(s().project.openings.find((o) => o.id === door.id)!.open).toBe(true);
    s().apply((d) => void (d.openings.find((o) => o.id === door.id)!.kind = 'passage'));
    const before = s().past.length;
    expect(toggleOpening(door.id)).toBeNull();
    expect(s().past.length).toBe(before);
  });
});
