import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addPolygonRoom, addRectRoom, closestWall, insertWall } from './operations';
import { derivePlan } from './derived';
import { buildPlacementObstacles, clipConvex, moveFurnitureTo, rotateFurnitureTo, mtv, collidingObstacles, constrainMove, furnitureConflicts, placementIssues, snapToWalls, type Pose } from './placement';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { pointInPolygon, polygonArea, rotate } from './vec';

const T = 0.12;
function roomProject() {
  const p = createEmptyProject();
  // clear interior 0..4 × 0..3
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
  return p;
}
const pose = (x: number, y: number, w = 1, d = 0.6, rotation = 0, height = 0.8, elevation = 0): Pose => ({ x, y, width: w, depth: d, rotation, height, elevation });

describe('furniture collision with walls', () => {
  it('stops flush at a wall instead of entering it', () => {
    const p = roomProject();
    const obs = buildPlacementObstacles(derivePlan(p));
    const r = constrainMove(pose(2, 1.5), { x: 3.9, y: 1.5 }, obs);
    expect(r.blocked).toBe(true);
    expect(r.x + 0.5).toBeCloseTo(4, 2); // right side touches the inner wall face
  });

  it('cannot tunnel through a wall with a very fast drag', () => {
    const p = roomProject();
    const obs = buildPlacementObstacles(derivePlan(p));
    const r = constrainMove(pose(2, 1.5), { x: 12, y: 1.5 }, obs);
    expect(r.x).toBeLessThan(4);
    expect(collidingObstacles({ ...pose(2, 1.5), x: r.x, y: r.y }, obs)).toHaveLength(0);
  });

  it('slides along a wall when dragged diagonally into it', () => {
    const p = roomProject();
    const obs = buildPlacementObstacles(derivePlan(p));
    const r = constrainMove(pose(2, 1.5), { x: 4.5, y: 2.0 }, obs);
    expect(r.x + 0.5).toBeCloseTo(4, 2);
    expect(r.y).toBeCloseTo(2.0, 2); // kept the free component
  });

  it('ends in a corner flush to both walls', () => {
    const p = roomProject();
    const obs = buildPlacementObstacles(derivePlan(p));
    const r = constrainMove(pose(2, 1.5), { x: 6, y: 6 }, obs);
    expect(r.x + 0.5).toBeCloseTo(4, 2);
    expect(r.y + 0.3).toBeCloseTo(3, 2);
  });

  it('handles rotated items and rotated rooms', () => {
    const p = createEmptyProject();
    const ang = Math.PI / 6;
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
    ].map((q) => rotate(q, ang));
    addPolygonRoom(p, pts, 'R', { thickness: T, height: 2.6 });
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const start = { ...pose(0, 0, 1.2, 0.5, ang), ...rotate({ x: 2, y: 1.5 }, ang) };
    const far = rotate({ x: 9, y: 1.5 }, ang);
    const r = constrainMove(start, far, obs);
    const g = [...d.rooms.values()][0];
    for (const c of furnitureCorners({ ...start, x: r.x, y: r.y })) expect(pointInPolygon(c, g.interior)).toBe(true);
  });
});

describe('doors', () => {
  function twoRooms() {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', thickness: T, height: 2.6 });
    addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'B', thickness: T, height: 2.6 });
    const w = closestWall(p, { x: 4.06, y: 1.5 })!;
    addOpening(p, w.wall.id, 'door', w.s, { width: 0.9, swing: 'left' });
    return p;
  }

  it('lets a narrow item pass through the clear door opening', () => {
    const p = twoRooms();
    const obs = buildPlacementObstacles(derivePlan(p));
    const door = p.openings[0];
    // the open leaf hangs on one side; start the move on the side without the leaf
    const d = derivePlan(p);
    const leaf = obs.find((o) => o.kind === 'door-leaf')!;
    const leafOnRight = leaf.polygon.every((q) => q.x >= 4.06 - 0.01);
    const startX = leafOnRight ? 3.5 : 5.0;
    const endX = leafOnRight ? 5.0 : 3.5;
    const fp = d.footprints.get(door.wallId)!;
    const doorY = fp.a.y + fp.dir.y * door.offset;
    // a narrow item (40 cm) centred on the opening axis, moving across the wall
    const start = pose(startX, doorY, 0.6, 0.35, Math.PI / 2, 0.4);
    const r = constrainMove(start, { x: endX, y: doorY }, obs);
    expect(Math.abs(r.x - endX)).toBeLessThan(0.45); // passed the wall line
    expect(Math.sign(r.x - 4.06)).toBe(Math.sign(endX - 4.06));
  });

  it('blocks an item wider than the opening (door frame / wall beside it is solid)', () => {
    const p = twoRooms();
    const obs = buildPlacementObstacles(derivePlan(p));
    const door = p.openings[0];
    const fp = derivePlan(p).footprints.get(door.wallId)!;
    const doorY = fp.a.y + fp.dir.y * door.offset;
    const r = constrainMove(pose(3.0, doorY, 1.4, 0.5, Math.PI / 2), { x: 5.5, y: doorY }, obs);
    expect(r.x).toBeLessThan(4.06);
  });

  it('sofa cannot be pushed into the opened door leaf and warns about the door swing', () => {
    const p = twoRooms();
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const leaf = obs.find((o) => o.kind === 'door-leaf')!;
    const leafX = leaf.polygon.reduce((s, q) => s + q.x, 0) / 4;
    const leafY = leaf.polygon.reduce((s, q) => s + q.y, 0) / 4;
    const sofaItem = findCatalogItem('generic-sofa-3')!;
    // sofa (2.1 m wide) standing free in the room the leaf opens into, dragged sideways into the leaf
    const inRoomA = leafX < 4.06;
    const startX = inRoomA ? 1.2 : 6.3;
    const start = pose(startX, leafY, sofaItem.width, sofaItem.depth, 0, sofaItem.height);
    expect(collidingObstacles(start, obs)).toHaveLength(0);
    const r = constrainMove(start, { x: leafX, y: leafY }, obs);
    expect(collidingObstacles({ ...start, x: r.x, y: r.y }, obs)).toHaveLength(0);
    expect(r.blocked).toBe(true);
    expect(Math.abs(r.y - leafY)).toBeLessThan(0.01); // stopped by the leaf, not pushed around it
    // a sofa placed inside the swing area is flagged
    const sofa = createFurnitureFromCatalog(sofaItem, { x: leafX, y: leafY + 0.9, rotation: Math.PI / 2 });
    const issues = placementIssues(p, d, sofa, obs);
    expect(issues.some((i) => i.kind === 'door-swing' || i.kind === 'door-leaf')).toBe(true);
  });
});

describe('items that already intersect an obstacle', () => {
  it('mtv pushes far enough when one projection contains the other', () => {
    const thin = [
      { x: 1.68, y: 3 },
      { x: 1.72, y: 3 },
      { x: 1.72, y: 4 },
      { x: 1.68, y: 4 },
    ];
    const m = mtv(furnitureCorners(pose(1.7, 3.5, 2.1, 0.5)), thin)!;
    const moved = furnitureCorners(pose(1.7 + m.x, 3.5 + m.y, 2.1, 0.5));
    expect(mtv(moved, thin)).toBeNull();
  });

  it('can be dragged out of a door leaf it stands in, without jumping', () => {
    const p = roomProject();
    const obs = buildPlacementObstacles(derivePlan(p));
    // a thin vertical "leaf" through the middle of the item
    const leaf = { polygon: [{ x: 1.98, y: 1 }, { x: 2.02, y: 1 }, { x: 2.02, y: 2 }, { x: 1.98, y: 2 }], z0: 0.015, z1: 2.0, kind: 'door-leaf' as const, refId: 'd' };
    const start = pose(2, 1.5, 1.6, 0.6);
    const small = constrainMove(start, { x: 2.01, y: 1.5 }, [...obs, leaf]);
    expect(small.x).toBeCloseTo(2.01, 6); // no jump on a tiny move
    const out = constrainMove(start, { x: 3.1, y: 1.5 }, [...obs, leaf]);
    expect(out.x).toBeCloseTo(3.1, 3);
    expect(collidingObstacles({ ...start, x: out.x }, [leaf])).toHaveLength(0);
    // once clear, the leaf blocks again
    const back = constrainMove({ ...start, x: 3.1 }, { x: 2, y: 1.5 }, [...obs, leaf]);
    expect(back.x - 0.8).toBeGreaterThanOrEqual(2.02 - 1e-3);
  });
});

describe('wall snapping', () => {
  it('snaps the rear side flush to a nearby wall and aligns rotation', () => {
    const p = roomProject();
    const d = derivePlan(p);
    // near the north wall (inner face y=0), slightly rotated, rear side 8 cm away
    const s = snapToWalls(pose(2, 0.3 + 0.08, 1.6, 0.6, 0.15), d);
    expect(s.rotation).toBeCloseTo(0, 6);
    expect(s.y - 0.3).toBeCloseTo(0.003, 6);
  });

  it('snaps to walls of any orientation and size', () => {
    const p = roomProject();
    const d = derivePlan(p);
    // east wall (inner face x=4): rear (local −y) must face +x → rotation +90° (clockwise on screen)
    const s = snapToWalls(pose(4 - 0.45 - 0.06, 1.5, 2.0, 0.9, Math.PI / 2 - 0.1), d);
    expect(s.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(s.x + 0.45).toBeCloseTo(4 - 0.003, 6);
    // south wall (inner face y=3): rear faces +y → rotation 180°
    const t = snapToWalls(pose(1.5, 3 - 0.2 - 0.05, 0.6, 0.4, Math.PI - 0.1), d);
    expect(Math.abs(t.rotation)).toBeCloseTo(Math.PI, 6);
    expect(t.y + 0.2).toBeCloseTo(3 - 0.003, 6);
  });

  it('does not snap from far away, to a wall it faces away from, or through a wall', () => {
    const p = roomProject();
    const d = derivePlan(p);
    const far = snapToWalls(pose(2, 1.5, 1, 0.6, 0), d);
    expect(far.wallIds).toHaveLength(0);
    // rear side points into the room (front faces the wall) → no snap
    const away = snapToWalls(pose(2, 0.35, 1, 0.6, Math.PI), d);
    expect(away.wallIds).toHaveLength(0);
  });

  it('snaps into a corner against both walls', () => {
    const p = roomProject();
    const d = derivePlan(p);
    const s = snapToWalls(pose(0.55, 0.36, 1.0, 0.6, 0), d);
    expect(s.wallIds).toHaveLength(2);
    expect(s.x - 0.5).toBeCloseTo(0.003, 6);
    expect(s.y - 0.3).toBeCloseTo(0.003, 6);
  });
});

describe('collision feedback regions', () => {
  it('clips convex polygons in either winding and ignores mere contact', () => {
    const sq = (x: number, y: number, s: number) => [
      { x, y },
      { x: x + s, y },
      { x: x + s, y: y + s },
      { x, y: y + s },
    ];
    const a = sq(0, 0, 2);
    const b = sq(1, 1, 2);
    expect(polygonArea(clipConvex(a, b))).toBeCloseTo(1, 9);
    expect(polygonArea(clipConvex(a, [...b].reverse()))).toBeCloseTo(1, 9);
    expect(clipConvex(a, sq(2, 0, 1))).toEqual([]); // touching edge
    expect(clipConvex(a, sq(5, 5, 1))).toEqual([]);
  });

  it('reports intersection region and responsible door leaf for a sofa in the opened door', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Wohnen', thickness: T, height: 2.6 });
    addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'Flur', thickness: T, height: 2.6 });
    const w = closestWall(p, { x: 4.06, y: 1.5 })!;
    addOpening(p, w.wall.id, 'door', w.s, { width: 0.9, swing: 'left' });
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const leaf = obs.find((o) => o.kind === 'door-leaf')!;
    const lc = { x: leaf.polygon.reduce((s, q) => s + q.x, 0) / 4, y: leaf.polygon.reduce((s, q) => s + q.y, 0) / 4 };
    const sofa = createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: lc.x, y: lc.y, rotation: 0 });
    p.furniture.push(sofa);
    const issues = placementIssues(p, d, sofa, obs);
    const hit = issues.find((i) => i.kind === 'door-leaf')!;
    expect(hit.refId).toBe(p.openings[0].id);
    expect(hit.message).toMatch(/Tür 90 cm \((Wohnen|Flur)\)/);
    // the region lies inside both the leaf and the sofa footprint
    expect(polygonArea(hit.region!.polygon)).toBeGreaterThan(0.01);
    const bx = leaf.polygon.map((q) => q.x);
    const by = leaf.polygon.map((q) => q.y);
    for (const q of hit.region!.polygon) {
      expect(q.x).toBeGreaterThanOrEqual(Math.min(...bx) - 1e-6);
      expect(q.x).toBeLessThanOrEqual(Math.max(...bx) + 1e-6);
      expect(q.y).toBeGreaterThanOrEqual(Math.min(...by) - 1e-6);
      expect(q.y).toBeLessThanOrEqual(Math.max(...by) + 1e-6);
    }
    expect(hit.region!.z0).toBeCloseTo(0.015, 6);
    expect(hit.region!.z1).toBeCloseTo(sofa.height, 6);
    expect(hit.culprit!.polygon).toBe(leaf.polygon);
    const conflicts = furnitureConflicts(p, d, obs);
    expect(conflicts.get(sofa.id)?.level).toBe('error');
    // moved away into the free room: no conflict left
    const free = { ...sofa, x: 1.5, y: 1.5 };
    p.furniture[0] = free;
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('does not flag items standing flush against a wall or in a corner (no false positives)', () => {
    const p = roomProject();
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const item = createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: 2, y: 1.5, rotation: 0 });
    const s = snapToWalls({ ...item, y: item.depth / 2 + 0.05 }, d);
    p.furniture.push({ ...item, x: s.x, y: s.y, rotation: s.rotation });
    const small = { ...item, id: 'corner', width: 1 };
    const c = snapToWalls({ ...small, x: 0.55, y: item.depth / 2 + 0.05 }, d);
    expect(c.wallIds).toHaveLength(2);
    p.furniture[0] = { ...p.furniture[0], x: 4 - item.width / 2 - 0.003 };
    p.furniture.push({ ...small, x: c.x, y: c.y, rotation: c.rotation });
    expect(placementIssues(p, d, p.furniture[1], obs)).toEqual([]);
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });
});

describe('wall penetration and snapping robustness', () => {
  it('cannot tunnel through a very thin (2 cm) partition with a fast drag', () => {
    const p = roomProject();
    insertWall(p, { x: 2, y: 0 }, { x: 2, y: 3 }, { thickness: 0.02, height: 2.6 });
    const obs = buildPlacementObstacles(derivePlan(p));
    for (const target of [3.5, 2.6, 2.45, 2.31]) {
      const r = constrainMove(pose(1.0, 1.5, 1.2, 0.5), { x: target, y: 1.5 }, obs);
      expect(r.x + 0.6).toBeLessThanOrEqual(1.99 + 1e-3);
    }
    // also when the item is rotated and moved diagonally
    const r = constrainMove(pose(1.0, 1.5, 1.2, 0.5, 0.4), { x: 3.4, y: 2.2 }, obs);
    for (const c of furnitureCorners({ ...pose(0, 0, 1.2, 0.5, 0.4), x: r.x, y: r.y })) expect(c.x).toBeLessThan(2.0);
  });

  it('does not snap to the open part of a wall (door opening / passage)', () => {
    const p = roomProject();
    const w = closestWall(p, { x: 2, y: -0.06 })!;
    addOpening(p, w.wall.id, 'passage', w.s, { width: 2.4 });
    const d = derivePlan(p);
    // a 60 cm cabinet in front of the 2.4 m wide passage: no wall behind it
    const s = snapToWalls(pose(2, 0.2 + 0.06, 0.6, 0.4, 0), d);
    expect(s.wallIds).toHaveLength(0);
    // a 1.6 m item overlapping the remaining wall on one side still snaps
    const s2 = snapToWalls(pose(1.0, 0.2 + 0.06, 1.6, 0.4, 0), d);
    expect(s2.wallIds).toHaveLength(1);
  });

  it('keeps a snapped item attached until it is pulled clearly away (no flicker at the threshold)', () => {
    const p = roomProject();
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    p.furniture.push(createFurnitureFromCatalog(findCatalogItem('generic-tv-sideboard')!, { x: 2, y: 1.5, rotation: 0.1 }));
    const id = p.furniture[0].id;
    const depth = p.furniture[0].depth;
    // approach the wall: snaps flush and aligns
    moveFurnitureTo(p, d, obs, id, { x: 2, y: depth / 2 + 0.1 }, { snap: true, collide: true });
    expect(p.furniture[0].y - depth / 2).toBeCloseTo(0.003, 4);
    expect(p.furniture[0].rotation).toBeCloseTo(0, 6);
    // moving the pointer just past the snap distance keeps it at the wall
    moveFurnitureTo(p, d, obs, id, { x: 2.2, y: depth / 2 + 0.14 }, { snap: true, collide: true });
    expect(p.furniture[0].y - depth / 2).toBeCloseTo(0.003, 4);
    expect(p.furniture[0].x).toBeCloseTo(2.2, 6);
    // pulled clearly away: released, follows the pointer
    moveFurnitureTo(p, d, obs, id, { x: 2.2, y: depth / 2 + 0.4 }, { snap: true, collide: true });
    expect(p.furniture[0].y - depth / 2).toBeCloseTo(0.4, 4);
    // and the same pointer position near the threshold does not snap back when approaching from far
    moveFurnitureTo(p, d, obs, id, { x: 2.2, y: depth / 2 + 0.14 }, { snap: true, collide: true });
    expect(p.furniture[0].y - depth / 2).toBeCloseTo(0.14, 4);
  });
});

describe('unified furniture rules', () => {
  const cat = (id: string) => findCatalogItem(id)!;
  function room() {
    const p = roomProject();
    const d = derivePlan(p);
    return { p, d, obs: buildPlacementObstacles(d) };
  }

  it('a floor lamp inside a sofa is a real overlap on both items (error, shown in 2D/3D)', () => {
    const { p, d, obs } = room();
    const sofa = createFurnitureFromCatalog(cat('generic-sofa-3'), { x: 2, y: 1.5 });
    const lamp = createFurnitureFromCatalog(cat('generic-floor-lamp'), { x: 2.2, y: 1.5 });
    p.furniture.push(sofa, lamp);
    const c = furnitureConflicts(p, d, obs);
    expect(c.get(lamp.id)?.level).toBe('error');
    expect(c.get(sofa.id)?.issues.some((i) => i.kind === 'overlap' && i.refId === lamp.id)).toBe(true);
  });

  it('intended combinations are no conflict: chair under table, rug under sofa, table lamp on table', () => {
    const { p, d, obs } = room();
    const table = createFurnitureFromCatalog(cat('generic-dining-table-4'), { x: 2, y: 1.5 });
    const chair = createFurnitureFromCatalog(cat('generic-chair'), { x: 2, y: 1.2 });
    const rug = createFurnitureFromCatalog(cat('generic-rug-160'), { x: 2, y: 1.5 });
    const lamp = { ...createFurnitureFromCatalog(cat('generic-table-lamp'), { x: 2.4, y: 1.6 }), elevation: 0.75 };
    p.furniture.push(table, chair, rug, lamp);
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('dragging a table lamp onto a coffee table puts it on the table top, off it back to the floor', () => {
    const { p, d, obs } = room();
    const table = createFurnitureFromCatalog(cat('generic-coffee-table'), { x: 2, y: 1.5 });
    const lamp = createFurnitureFromCatalog(cat('generic-table-lamp'), { x: 0.6, y: 0.6 });
    p.furniture.push(table, lamp);
    moveFurnitureTo(p, d, obs, lamp.id, { x: 2.1, y: 1.5 }, { snap: true, collide: true });
    const l = p.furniture.find((f) => f.id === lamp.id)!;
    expect(l.x).toBeCloseTo(2.1, 3);
    expect(l.elevation).toBeCloseTo(table.height, 6);
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
    moveFurnitureTo(p, d, obs, lamp.id, { x: 3.4, y: 2.5 }, { snap: true, collide: true });
    expect(p.furniture.find((f) => f.id === lamp.id)!.elevation).toBe(0);
  });

  it('dragging a floor lamp into a sofa stops at the sofa (same blocking as walls)', () => {
    const { p, d, obs } = room();
    const sofa = createFurnitureFromCatalog(cat('generic-sofa-3'), { x: 2, y: 1.5 });
    const lamp = createFurnitureFromCatalog(cat('generic-floor-lamp'), { x: 0.4, y: 1.5 });
    p.furniture.push(sofa, lamp);
    moveFurnitureTo(p, d, obs, lamp.id, { x: 2, y: 1.5 }, { snap: true, collide: true });
    const l = p.furniture.find((f) => f.id === lamp.id)!;
    expect(l.x + l.width / 2).toBeLessThanOrEqual(2 - sofa.width / 2 + 1e-3);
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('warns when doors/drawers have no room to open, not when there is enough space', () => {
    const { p, d, obs } = room();
    const wardrobe = createFurnitureFromCatalog(cat('generic-wardrobe-100'), { x: 2, y: 0.3 });
    const chair = createFurnitureFromCatalog(cat('generic-armchair'), { x: 2, y: 0.6 + 0.3 + 0.41 });
    p.furniture.push(wardrobe, chair);
    const c = furnitureConflicts(p, d, obs).get(wardrobe.id);
    expect(c?.level).toBe('warn');
    expect(c?.issues[0].message).toMatch(/nur 30 cm frei/);
    p.furniture[1] = { ...chair, y: 0.6 + 0.8 + 0.41 };
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('a generated kitchen run with countertop has no conflicts', async () => {
    const { placeKitchenRun, generateCountertops } = await import('../kitchen/kitchen');
    const p = roomProject();
    const w = closestWall(p, { x: 2, y: -0.06 })!;
    placeKitchenRun(p, { wallId: w.wall.id, side: 1, start: 0.5, modules: [{ catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-dishwasher' }, { catalogId: 'generic-k-wall-60' }] });
    generateCountertops(p);
    const d = derivePlan(p);
    expect([...furnitureConflicts(p, d, buildPlacementObstacles(d))].map(([, c]) => c.issues.map((i) => i.message))).toEqual([]);
  });
});

describe('rotating furniture (#5)', () => {
  const cat = (id: string) => findCatalogItem(id)!;
  function setup() {
    const p = roomProject();
    const d = derivePlan(p);
    return { p, d, obs: buildPlacementObstacles(d) };
  }

  it('a wardrobe turned at a wall is pushed back into the room instead of into the wall', () => {
    const { p, d, obs } = setup();
    // 150 × 60 cm, back flush against the north wall (inner face y = 0)
    const w = createFurnitureFromCatalog(cat('generic-wardrobe-150'), { x: 2, y: 0.3 });
    p.furniture.push(w);
    expect(collidingObstacles(w, obs)).toHaveLength(0);
    expect(rotateFurnitureTo(p, d, obs, w.id, Math.PI / 2)).toBe('moved');
    const r = p.furniture.find((f) => f.id === w.id)!;
    expect(r.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(collidingObstacles(r, obs)).toHaveLength(0);
    expect(r.y).toBeCloseTo(0.75, 2); // now 150 cm deep along y → centre 75 cm from the wall
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('free rotation in the open room stays in place', () => {
    const { p, d, obs } = setup();
    const t = createFurnitureFromCatalog(cat('generic-coffee-table'), { x: 2, y: 1.5 });
    p.furniture.push(t);
    expect(rotateFurnitureTo(p, d, obs, t.id, Math.PI / 12)).toBe('ok');
    expect(p.furniture[0]).toMatchObject({ x: 2, y: 1.5 });
  });

  it('turning into another piece of furniture pushes it clear of it', () => {
    const { p, d, obs } = setup();
    const sofa = createFurnitureFromCatalog(cat('generic-sofa-3'), { x: 2, y: 2.5 });
    const sofaFront = sofa.y - sofa.depth / 2;
    // shelf 80 × 30 cm just in front of the sofa; turned, it would reach 25 cm into it
    const board = createFurnitureFromCatalog(cat('generic-shelf-80'), { x: 2, y: sofaFront - 0.2, rotation: 0 });
    p.furniture.push(sofa, board);
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
    expect(rotateFurnitureTo(p, d, obs, board.id, Math.PI / 2)).toBe('moved');
    expect(furnitureConflicts(p, d, obs).size).toBe(0);
  });

  it('no free spot nearby: rotated anyway and reported as conflict (never through the wall)', () => {
    const p = createEmptyProject();
    // narrow 1.0 × 3 m corridor; a 1.5 m wardrobe cannot turn across it
    addRectRoom(p, { x: 0, y: 0, width: 1, depth: 3, name: 'Gang', thickness: T, height: 2.6 });
    const d = derivePlan(p);
    const obs = buildPlacementObstacles(d);
    const w = createFurnitureFromCatalog(cat('generic-wardrobe-150'), { x: 0.3, y: 1.5, rotation: Math.PI / 2 });
    p.furniture.push(w);
    expect(collidingObstacles(w, obs)).toHaveLength(0);
    expect(rotateFurnitureTo(p, d, obs, w.id, 0)).toBe('conflict');
    const r = p.furniture[0];
    expect(r.rotation).toBe(0);
    expect(r.x).toBeCloseTo(0.3, 6); // not pushed through a wall into the void
    expect(furnitureConflicts(p, d, obs).get(w.id)?.level).toBe('error');
  });

  it('locked items do not turn', () => {
    const { p, d, obs } = setup();
    const t = { ...createFurnitureFromCatalog(cat('generic-coffee-table'), { x: 2, y: 1.5 }), locked: true };
    p.furniture.push(t);
    rotateFurnitureTo(p, d, obs, t.id, 1);
    expect(p.furniture[0].rotation).toBe(0);
  });
});

