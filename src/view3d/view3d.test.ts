import { describe, expect, it } from 'vitest';
import { regionGeometry } from './CollisionMarkers';
import { createSampleProject } from '../model/sample';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { addOpening, insertWall } from '../model/operations';
import { buildWallGeometry, buildFlatPolygon } from './prismGeometry';
import { buildColliders, resolveCollisions, PLAYER_RADIUS } from './collision';
import { sunDirection, kelvinToColor } from './lighting';

describe('2D → 3D geometry', () => {
  it('builds wall meshes whose bounds match the 2D footprint and height', () => {
    const p = createSampleProject();
    const d = derivePlan(p);
    for (const w of p.walls) {
      const fp = d.footprints.get(w.id)!;
      const g = buildWallGeometry(fp, d.pieces.get(w.id)!);
      const bb = g.boundingBox!;
      const xs = fp.polygon.map((q) => q.x);
      const ys = fp.polygon.map((q) => q.y);
      expect(bb.min.x).toBeCloseTo(Math.min(...xs), 5);
      expect(bb.max.x).toBeCloseTo(Math.max(...xs), 5);
      expect(bb.min.z).toBeCloseTo(Math.min(...ys), 5);
      expect(bb.max.z).toBeCloseTo(Math.max(...ys), 5);
      expect(bb.min.y).toBeCloseTo(0, 6);
      expect(bb.max.y).toBeCloseTo(w.height, 6);
      // every triangle faces along its stored normal
      const pos = g.getAttribute('position');
      const nor = g.getAttribute('normal');
      for (let i = 0; i < pos.count; i += 3) {
        const ax = pos.getX(i), ay = pos.getY(i), az = pos.getZ(i);
        const ux = pos.getX(i + 1) - ax, uy = pos.getY(i + 1) - ay, uz = pos.getZ(i + 1) - az;
        const vx = pos.getX(i + 2) - ax, vy = pos.getY(i + 2) - ay, vz = pos.getZ(i + 2) - az;
        const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
        expect(cx * nor.getX(i) + cy * nor.getY(i) + cz * nor.getZ(i)).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it('leaves a hole in the mesh where a door is', () => {
    const p = createEmptyProject();
    insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2, height: 2.5 });
    addOpening(p, p.walls[0].id, 'door', 2);
    const d = derivePlan(p);
    const pieces = d.pieces.get(p.walls[0].id)!;
    // nothing solid between x 1.55..2.45 below 2.1 m
    for (const pc of pieces) {
      const minX = Math.min(...pc.polygon.map((q) => q.x));
      const maxX = Math.max(...pc.polygon.map((q) => q.x));
      if (maxX > 1.56 && minX < 2.44) expect(pc.z0).toBeGreaterThanOrEqual(2.1 - 1e-9);
    }
  });

  it('builds upward-facing floors and downward-facing ceilings', () => {
    const poly = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 2 },
      { x: 0, y: 2 },
    ];
    for (const [up, sign] of [
      [true, 1],
      [false, -1],
    ] as const) {
      const g = buildFlatPolygon(poly, 0, up);
      const pos = g.getAttribute('position');
      const idx = g.getIndex()!;
      for (let i = 0; i < idx.count; i += 3) {
        const a = idx.getX(i), b = idx.getX(i + 1), c = idx.getX(i + 2);
        const ux = pos.getX(b) - pos.getX(a), uz = pos.getZ(b) - pos.getZ(a);
        const vx = pos.getX(c) - pos.getX(a), vz = pos.getZ(c) - pos.getZ(a);
        const ny = uz * vx - ux * vz;
        expect(Math.sign(ny)).toBe(sign);
      }
    }
  });
});

describe('first-person collision', () => {
  const p = createEmptyProject();
  insertWall(p, { x: 0, y: 0 }, { x: 4, y: 0 }, { thickness: 0.2, height: 2.5 });
  const wallId = p.walls[0].id;
  addOpening(p, wallId, 'door', 2, { width: 1.0 });
  const colliders = buildColliders(derivePlan(p), []);

  it('blocks walking through a solid wall', () => {
    const r = resolveCollisions({ x: 0.8, y: 0.05 }, colliders);
    expect(Math.abs(r.y)).toBeGreaterThanOrEqual(0.1 + PLAYER_RADIUS - 1e-6);
  });

  it('lets the player pass through a door opening', () => {
    const r = resolveCollisions({ x: 2, y: 0 }, colliders);
    expect(r.x).toBeCloseTo(2, 6);
    expect(r.y).toBeCloseTo(0, 6);
  });

  it('treats solid furniture as obstacles but not rugs', () => {
    const base = { id: 'f', name: 'x', category: 'table', x: 5, y: 5, elevation: 0, rotation: 0, width: 1, depth: 1, height: 0.75, color: '#ffffff', model: { type: 'procedural' as const, shape: 'box' }, quantity: 1, approximate: true, solid: true, locked: false };
    expect(buildColliders(derivePlan(p), [base])).toHaveLength(colliders.length + 1);
    expect(buildColliders(derivePlan(p), [{ ...base, solid: false }])).toHaveLength(colliders.length);
    expect(buildColliders(derivePlan(p), [{ ...base, height: 0.01 }])).toHaveLength(colliders.length);
  });
});

describe('lighting helpers', () => {
  it('puts the sun high at noon and below the horizon at night', () => {
    expect(sunDirection(13).y).toBeGreaterThan(0.7);
    expect(sunDirection(23).y).toBeLessThan(0);
  });
  it('maps colour temperature to warm/cool colours', () => {
    const warm = parseInt(kelvinToColor(2700).slice(5, 7), 16);
    const cool = parseInt(kelvinToColor(6500).slice(5, 7), 16);
    expect(cool).toBeGreaterThan(warm);
  });
});

describe('collision marker geometry', () => {
  it('extrudes a plan region to the right world box (plan y → world Z, height → world Y)', () => {
    const geo = regionGeometry({
      polygon: [
        { x: 1, y: 2 },
        { x: 1.5, y: 2 },
        { x: 1.5, y: 2.2 },
        { x: 1, y: 2.2 },
      ],
      z0: 0.1,
      z1: 0.8,
    });
    geo.computeBoundingBox();
    const b = geo.boundingBox!;
    expect(b.min.x).toBeCloseTo(1, 6);
    expect(b.max.x).toBeCloseTo(1.5, 6);
    expect(b.min.z).toBeCloseTo(2, 6);
    expect(b.max.z).toBeCloseTo(2.2, 6);
    expect(b.min.y).toBeCloseTo(0.1, 6);
    expect(b.max.y).toBeCloseTo(0.8, 6);
  });
});
