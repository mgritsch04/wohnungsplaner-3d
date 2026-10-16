import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addOpening, addPolygonRoom, addRectRoom, closestWall } from './operations';
import { derivePlan } from './derived';
import { buildPlacementObstacles, collidingObstacles, constrainMove, placementIssues, snapToWalls, type Pose } from './placement';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { pointInPolygon, rotate } from './vec';

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
