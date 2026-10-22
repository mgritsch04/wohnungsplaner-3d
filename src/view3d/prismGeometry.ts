import * as THREE from 'three';
import type { WallFootprint, WallPiece } from '../model/geometry/walls';
import { dot, sub, type Vec2 } from '../model/vec';

/**
 * Build one BufferGeometry for a wall from its convex prism pieces.
 * Groups: 0 = left face (+normal side), 1 = right face, 2 = top/ends/reveals.
 * UVs are in meters so textures can be scaled in real-world units.
 * Plan (x, y) maps to world (X = x, Z = y), height is world Y.
 */
export function buildWallGeometry(fp: WallFootprint, pieces: WallPiece[]): THREE.BufferGeometry {
  const buckets: { pos: number[]; nor: number[]; uv: number[] }[] = [0, 1, 2].map(() => ({ pos: [], nor: [], uv: [] }));
  const along = (p: Vec2) => dot(sub(p, fp.a), fp.dir);
  const across = (p: Vec2) => dot(sub(p, fp.a), fp.normal);

  const pushTri = (bucket: number, verts: [number, number, number][], n: [number, number, number], uvs: [number, number][]) => {
    // ensure counter-clockwise winding when seen from the normal direction
    const [a, b, c] = verts;
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = ab[1] * ac[2] - ab[2] * ac[1];
    const cy = ab[2] * ac[0] - ab[0] * ac[2];
    const cz = ab[0] * ac[1] - ab[1] * ac[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2];
    const B = buckets[bucket];
    for (const i of order) {
      B.pos.push(...verts[i]);
      B.nor.push(...n);
      B.uv.push(...uvs[i]);
    }
  };

  for (const piece of pieces) {
    const poly = piece.polygon;
    const { z0, z1 } = piece;
    // centroid used to orient side normals outward
    const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
    const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const len = Math.hypot(ex, ey);
      if (len < 1e-7) continue;
      let nx = ey / len;
      let ny = -ex / len;
      const mx = (p.x + q.x) / 2 - cx;
      const my = (p.y + q.y) / 2 - cy;
      if (nx * mx + ny * my < 0) {
        nx = -nx;
        ny = -ny;
      }
      const side = nx * fp.normal.x + ny * fp.normal.y;
      const bucket = side > 0.99 ? 0 : side < -0.99 ? 1 : 2;
      const n: [number, number, number] = [nx, 0, ny];
      const u0 = bucket === 2 ? across(p) : along(p);
      const u1 = bucket === 2 ? across(q) : along(q);
      const A: [number, number, number] = [p.x, z0, p.y];
      const B: [number, number, number] = [q.x, z0, q.y];
      const C: [number, number, number] = [q.x, z1, q.y];
      const D: [number, number, number] = [p.x, z1, p.y];
      pushTri(bucket, [A, B, C], n, [[u0, z0], [u1, z0], [u1, z1]]);
      pushTri(bucket, [A, C, D], n, [[u0, z0], [u1, z1], [u0, z1]]);
    }
    // caps (convex fan)
    for (const [z, ny] of [[z1, 1], [z0, -1]] as const) {
      for (let i = 1; i < poly.length - 1; i++) {
        const a = poly[0];
        const b = poly[i];
        const c = poly[i + 1];
        pushTri(2, [[a.x, z, a.y], [b.x, z, b.y], [c.x, z, c.y]], [0, ny, 0], [[a.x, a.y], [b.x, b.y], [c.x, c.y]]);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  let start = 0;
  buckets.forEach((b, i) => {
    pos.push(...b.pos);
    nor.push(...b.nor);
    uv.push(...b.uv);
    const count = b.pos.length / 3;
    if (count > 0) g.addGroup(start, count, i);
    start += count;
  });
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Horizontal polygon (floor/ceiling) at height y. faceUp=false for ceilings. UV in meters. */
export function buildFlatPolygon(poly: Vec2[], y: number, faceUp = true, holes: Vec2[][] = []): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  // stairwells (#54): cut-outs that lie inside the polygon
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))));
  const shapeGeom = new THREE.ShapeGeometry(shape);
  // ShapeGeometry lies in XY with +Z normal. Map (x, y) → (x, height, y).
  const pos = shapeGeom.getAttribute('position') as THREE.BufferAttribute;
  const out = new THREE.BufferGeometry();
  const positions = new Float32Array(pos.count * 3);
  const normals = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = pos.getY(i);
    normals[i * 3 + 1] = faceUp ? 1 : -1;
  }
  const index = shapeGeom.getIndex();
  const idx = index ? Array.from(index.array) : [...Array(pos.count).keys()];
  // Mapping XY→XZ mirrors the handedness; choose winding so the face points the right way.
  const tris: number[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    if (faceUp) tris.push(idx[i], idx[i + 2], idx[i + 1]);
    else tris.push(idx[i], idx[i + 1], idx[i + 2]);
  }
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setAttribute('uv', shapeGeom.getAttribute('uv').clone());
  out.setIndex(tris);
  out.computeBoundingSphere();
  shapeGeom.dispose();
  return out;
}
