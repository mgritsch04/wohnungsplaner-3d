import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { buildIndex } from './graph';
import { computeRoomGeometry, rectangularRoomSize } from './geometry/rooms';
import { buildWallPieces, computeWallFootprint, resolveOpenings } from './geometry/walls';
import { addOpening, addRectRoom, closestWall, deleteWalls, insertWall, setRectRoomSize, splitWall } from './operations';
import { detectFaces } from './roomDetection';
import { createSampleProject } from './sample';
import { ProjectSchema } from './schema';
import { validateModel } from './validation';
import { pointInPolygon, polygonArea } from './vec';
import { derivePlan } from './derived';
import { formatLength, normalizeAngle, planRotationToWorldY, roundMm } from './units';

const props = { thickness: 0.2, height: 2.5 };

describe('units', () => {
  it('rounds to millimetres and normalizes angles', () => {
    expect(roundMm(1.23456)).toBe(1.235);
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(planRotationToWorldY(0.5)).toBe(-0.5);
    expect(formatLength(0.12)).toBe('12 cm');
  });
});

describe('rect room', () => {
  it('creates 4 walls, 4 nodes and correct interior area', () => {
    const p = createEmptyProject();
    const id = addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'R', ...props });
    expect(p.walls).toHaveLength(4);
    expect(p.nodes).toHaveLength(4);
    const geo = computeRoomGeometry(p.rooms.find((r) => r.id === id)!, buildIndex(p))!;
    expect(geo.area).toBeCloseTo(12, 6);
    expect(geo.closed).toBe(true);
    const size = rectangularRoomSize(geo)!;
    expect([size.width, size.depth].sort()).toEqual([3, 4].map((x) => expect.closeTo(x, 6)).sort());
    expect(validateModel(p)).toEqual([]);
  });

  it('adjacent rooms share the wall and split at T-junctions', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', ...props });
    addRectRoom(p, { x: 4.2, y: 0, width: 3, depth: 5, name: 'B', ...props });
    const index = buildIndex(p);
    for (const r of p.rooms) {
      const geo = computeRoomGeometry(r, index)!;
      expect(geo.closed).toBe(true);
    }
    const areas = p.rooms.map((r) => computeRoomGeometry(r, index)!.area);
    expect(areas[0]).toBeCloseTo(12, 6);
    expect(areas[1]).toBeCloseTo(15, 6);
    // shared wall x=4.1 between y=-0.1..3.1 exists once
    const sharedWalls = p.walls.filter((w) => {
      const a = index.nodes.get(w.a)!;
      const b = index.nodes.get(w.b)!;
      return Math.abs(a.x - 4.1) < 1e-6 && Math.abs(b.x - 4.1) < 1e-6;
    });
    expect(sharedWalls).toHaveLength(2); // split at the T-junction y=3.1
    expect(validateModel(p)).toEqual([]);
  });

  it('resizes a rectangular room by moving wall lines', () => {
    const p = createEmptyProject();
    const id = addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'R', ...props });
    expect(setRectRoomSize(p, id, 5, 3.5)).toBe(true);
    const geo = computeRoomGeometry(p.rooms[0], buildIndex(p))!;
    expect(geo.area).toBeCloseTo(17.5, 6);
    void id;
  });
});

describe('wall joins', () => {
  it('miters L-corners so wall faces meet exactly', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props);
    insertWall(p, { x: 4, y: 0 }, { x: 4, y: 3 }, props);
    const index = buildIndex(p);
    const fps = p.walls.map((w) => computeWallFootprint(w, index)!);
    const corners = fps.flatMap((f) => f.polygon);
    // outer corner (4.1, -0.1) and inner corner (3.9, 0.1) appear in both walls
    const count = (x: number, y: number) => corners.filter((c) => Math.abs(c.x - x) < 1e-9 && Math.abs(c.y - y) < 1e-9).length;
    expect(count(4.1, -0.1)).toBe(2);
    expect(count(3.9, 0.1)).toBe(2);
  });

  it('T-junction stem ends flush at the through wall face', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props);
    insertWall(p, { x: 2, y: 0 }, { x: 2, y: 3 }, props);
    expect(p.walls).toHaveLength(3);
    const index = buildIndex(p);
    const stem = p.walls.find((w) => {
      const a = index.nodes.get(w.a)!;
      const b = index.nodes.get(w.b)!;
      return a.x === 2 && b.x === 2;
    })!;
    const fp = computeWallFootprint(stem, index)!;
    const ys = fp.polygon.map((c) => c.y).sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(0.1, 9);
  });

  it('fills the junction area of a T-junction so no gap remains', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props);
    insertWall(p, { x: 2, y: 0 }, { x: 2, y: 3 }, props);
    const d = derivePlan(p);
    expect(d.hubs).toHaveLength(1);
    // the point just inside the junction (on the stem axis, inside the through wall) is covered
    const probe = { x: 2, y: 0.09 };
    const covered = [...d.footprints.values()].some((f) => pointInPolygon(probe, f.polygon)) || d.hubs.some((h) => pointInPolygon(probe, h.polygon));
    expect(covered).toBe(true);
  });

  it('splits crossing walls into an X junction', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props);
    insertWall(p, { x: 2, y: -2 }, { x: 2, y: 2 }, props);
    expect(p.walls).toHaveLength(4);
    expect(p.nodes).toHaveLength(5);
  });
});

describe('openings', () => {
  it('cuts openings into wall pieces (sill + lintel)', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, props);
    const wall = p.walls[0];
    addOpening(p, wall.id, 'window', 2);
    const index = buildIndex(p);
    const fp = computeWallFootprint(wall, index)!;
    const res = resolveOpenings(wall, fp, p.openings);
    expect(res[0].s0).toBeCloseTo(1.4);
    expect(res[0].s1).toBeCloseTo(2.6);
    const pieces = buildWallPieces(wall, fp, res);
    expect(pieces).toHaveLength(4); // left, sill, lintel, right
    const totalVolume = pieces.reduce((acc, pc) => acc + polygonArea(pc.polygon) * (pc.z1 - pc.z0), 0);
    expect(totalVolume).toBeCloseTo(4 * 0.2 * 2.5 - 1.2 * 1.4 * 0.2, 6);
  });

  it('clamps openings into short walls', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 1, y: 0 }, props);
    const id = addOpening(p, p.walls[0].id, 'door', 0.1)!;
    const o = p.openings.find((x) => x.id === id)!;
    expect(o.offset - o.width / 2).toBeGreaterThanOrEqual(0);
  });

  it('keeps openings on the right half when splitting a wall', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 6, y: 0 }, props);
    addOpening(p, p.walls[0].id, 'door', 4.5);
    splitWall(p, p.walls[0].id, { x: 3, y: 0 });
    const o = p.openings[0];
    const w = p.walls.find((x) => x.id === o.wallId)!;
    const index = buildIndex(p);
    expect(index.nodes.get(w.a)!.x).toBe(3);
    expect(o.offset).toBeCloseTo(1.5);
  });

  it('deleting a wall removes its openings and rooms using it', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'R', ...props });
    const hit = closestWall(p, { x: 2, y: -0.1 })!;
    addOpening(p, hit.wall.id, 'window', hit.s);
    deleteWalls(p, [hit.wall.id]);
    expect(p.openings).toHaveLength(0);
    expect(p.rooms).toHaveLength(0);
    expect(p.walls).toHaveLength(3);
  });
});

describe('room detection', () => {
  it('finds bounded faces of the wall graph', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'A', ...props });
    addRectRoom(p, { x: 4.2, y: 0, width: 3, depth: 3, name: 'B', ...props });
    insertWall(p, { x: 1, y: 1 }, { x: 2, y: 1 }, props); // dangling wall is ignored
    const faces = detectFaces(p);
    expect(faces).toHaveLength(2);
  });
});

describe('sample project', () => {
  it('is schema-valid and has no model issues', () => {
    const p = createSampleProject();
    expect(() => ProjectSchema.parse(p)).not.toThrow();
    expect(validateModel(p)).toEqual([]);
    expect(p.openings.length).toBeGreaterThanOrEqual(4);
    expect(p.furniture.length).toBeGreaterThan(3);
  });
});
