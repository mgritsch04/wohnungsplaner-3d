/**
 * 3D model export as GLB (#87)
 * ----------------------------
 * Builds a three.js scene directly from the model (derivePlan() + the existing mesh
 * builders) – not from the running 3D view – and writes it with GLTFExporter.
 * glTF conventions match ours: 1 unit = 1 m, Y up; plan x/y → world X/Z.
 *
 * Contents: walls (with their openings cut out), floors per room, door leaves and
 * window sashes in their current open/closed state, and furniture (imported GLB
 * models when supplied, otherwise the procedural stand-in bodies). Node names are the
 * room / furniture names, so viewers show a readable outline.
 * Not exported: the plan underlay image, product links, prices, notes – only geometry,
 * names and colours.
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { DerivedPlan } from '../model/derived';
import { DOOR_LEAF_THICKNESS, LEAF_OPEN_ANGLE, leafDirection, leafTurnSign, WINDOW_SASH_PROFILE, type OpeningLeaf } from '../model/geometry/leaves';
import { DEFAULT_FLOOR_MATERIAL_ID, DEFAULT_WALL_MATERIAL_ID, materialById } from '../model/materials';
import type { Furniture, Material, Project } from '../model/schema';
import { planRotationToWorldY } from '../model/units';
import { add, pointInPolygon, scale } from '../model/vec';
import { buildFlatPolygon, buildWallGeometry } from '../view3d/prismGeometry';
import { buildParts } from '../view3d/ProceduralModel';

export interface GlbExportOptions {
  /** Loaded scenes of imported 3D models per furniture id; others get procedural bodies. */
  models?: Map<string, THREE.Object3D>;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** Plain PBR colour material (no textures – keeps the file small and viewer-safe). */
function colorMat(color: string, opts: { roughness?: number; metalness?: number; opacity?: number; name?: string } = {}): THREE.MeshStandardMaterial {
  const key = [color, opts.roughness ?? 0.8, opts.metalness ?? 0, opts.opacity ?? 1, opts.name ?? ''].join('|');
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: opts.roughness ?? 0.8, metalness: opts.metalness ?? 0 });
    if ((opts.opacity ?? 1) < 1) {
      m.transparent = true;
      m.opacity = opts.opacity!;
    }
    if (opts.name) m.name = opts.name;
    matCache.set(key, m);
  }
  return m;
}
const surface = (m: Material) => colorMat(m.color, { roughness: m.roughness, metalness: m.metalness, name: m.name });

/** Imported model scaled to the stored real-world size, origin at the footprint centre on the floor (as in the 3D view). */
export function fitModelToItem(model: THREE.Object3D, item: Pick<Furniture, 'width' | 'depth' | 'height'>): THREE.Object3D {
  const s = model.clone(true);
  const size = new THREE.Box3().setFromObject(s).getSize(new THREE.Vector3());
  s.scale.set(item.width / (size.x || 1), item.height / (size.y || 1), item.depth / (size.z || 1));
  const box = new THREE.Box3().setFromObject(s);
  const c = box.getCenter(new THREE.Vector3());
  s.position.set(-c.x, -box.min.y, -c.z);
  return s;
}

function proceduralBody(f: Furniture): THREE.Group {
  const g = new THREE.Group();
  const shape = f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape;
  for (const p of buildParts(shape, f.width, f.depth, f.height, f.color, f.kitchen?.frontColor, f.finish)) {
    const mesh = new THREE.Mesh(p.geo, colorMat(p.color, { roughness: p.rough, metalness: p.metal, opacity: p.opacity }));
    mesh.position.set(...p.p);
    mesh.scale.set(...p.s);
    if (p.r) mesh.rotation.set(...p.r);
    g.add(mesh);
  }
  return g;
}

/** Door leaf / window sash at its current state, as a pivot group around the hinge. */
function leafObject(leaf: OpeningLeaf, name: string, mats: { door: THREE.Material; frame: THREE.Material; glass: THREE.Material }, wallThickness: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = name;
  const dir = leafDirection(leaf, leaf.open ? LEAF_OPEN_ANGLE : 0);
  pivot.position.set(leaf.hinge.x, leaf.z0, leaf.hinge.y);
  pivot.rotation.y = -Math.atan2(dir.y, dir.x);
  const w = leaf.width;
  const h = leaf.z1 - leaf.z0;
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    mesh.position.set(x, y, z);
    pivot.add(mesh);
  };
  if (leaf.kind === 'door') {
    const t = DOOR_LEAF_THICKNESS;
    box(w, h, t, w / 2, h / 2, (-leafTurnSign(leaf) * t) / 2, mats.door);
  } else {
    const st = WINDOW_SASH_PROFILE;
    const depth = Math.min(0.06, wallThickness * 0.5);
    const zc = (-leafTurnSign(leaf) * depth) / 2;
    box(w, st, depth, w / 2, st / 2, zc, mats.frame);
    box(w, st, depth, w / 2, h - st / 2, zc, mats.frame);
    box(st, h, depth, st / 2, h / 2, zc, mats.frame);
    box(st, h, depth, w - st / 2, h / 2, zc, mats.frame);
    box(Math.max(0.01, w - 2 * st), Math.max(0.01, h - 2 * st), 0.012, w / 2, h / 2, zc, mats.glass);
  }
  return pivot;
}

/** The export scene, built from the model. */
export function buildExportScene(project: Project, derived: DerivedPlan, opts: GlbExportOptions = {}): THREE.Scene {
  const scene = new THREE.Scene();
  scene.name = project.name || 'Wohnung';
  const roomPolys = project.rooms.flatMap((room) => {
    const geo = derived.rooms.get(room.id);
    return geo ? [{ room, geo }] : [];
  });

  // walls: left / right face material, "other" faces (top, jambs) neutral
  const walls = new THREE.Group();
  walls.name = 'Wände';
  const other = colorMat('#e7e5e4', { roughness: 0.9, name: 'Wandkanten' });
  project.walls.forEach((w, i) => {
    const fp = derived.footprints.get(w.id);
    const pieces = derived.pieces.get(w.id);
    if (!fp || !pieces) return;
    const mid = scale(add(fp.a, fp.b), 0.5);
    const sideRoom = (sign: 1 | -1) => roomPolys.find((r) => pointInPolygon(add(mid, scale(fp.normal, sign * (fp.thickness / 2 + 0.05))), r.geo.interior))?.room;
    const left = materialById(project.materials, w.leftMaterialId ?? sideRoom(1)?.wallMaterialId, DEFAULT_WALL_MATERIAL_ID);
    const right = materialById(project.materials, w.rightMaterialId ?? sideRoom(-1)?.wallMaterialId, DEFAULT_WALL_MATERIAL_ID);
    const mesh = new THREE.Mesh(buildWallGeometry(fp, pieces), [surface(left), surface(right), other]);
    mesh.name = `Wand ${i + 1}`;
    walls.add(mesh);
  });
  if (derived.hubs.length) {
    const frame = { wallId: 'hubs', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: 0 }, length: 1, thickness: 0, polygon: [] };
    const hubs = new THREE.Mesh(buildWallGeometry(frame, derived.hubs.map((h) => ({ polygon: h.polygon, z0: 0, z1: h.height }))), [other, other, other]);
    hubs.name = 'Wandecken';
    walls.add(hubs);
  }
  scene.add(walls);

  const floors = new THREE.Group();
  floors.name = 'Böden';
  for (const { room, geo } of roomPolys) {
    if (geo.interior.length < 3) continue;
    const mesh = new THREE.Mesh(buildFlatPolygon(geo.interior, 0.001, true), surface(materialById(project.materials, room.floorMaterialId, DEFAULT_FLOOR_MATERIAL_ID)));
    mesh.name = room.name || 'Raum';
    floors.add(mesh);
  }
  scene.add(floors);

  const openings = new THREE.Group();
  openings.name = 'Türen und Fenster';
  const leafMats = { door: colorMat('#f5f3ef', { roughness: 0.6, name: 'Türblatt' }), frame: colorMat('#f4f4f2', { roughness: 0.5, name: 'Fensterrahmen' }), glass: colorMat('#bcd4e6', { roughness: 0.05, opacity: 0.35, name: 'Glas' }) };
  let doorNo = 0;
  let windowNo = 0;
  for (const o of project.openings) {
    const leaves = derived.leaves.get(o.id);
    const fp = derived.footprints.get(o.wallId);
    if (!leaves || !fp) continue;
    const label = o.kind === 'door' ? `Tür ${++doorNo}` : `Fenster ${++windowNo}`;
    leaves.forEach((l, k) => openings.add(leafObject(l, leaves.length > 1 ? `${label} (${k + 1})` : label, leafMats, fp.thickness)));
  }
  scene.add(openings);

  const furniture = new THREE.Group();
  furniture.name = 'Möbel';
  for (const f of project.furniture) {
    const g = new THREE.Group();
    g.name = f.name || 'Möbel';
    g.position.set(f.x, f.elevation, f.y);
    g.rotation.y = planRotationToWorldY(f.rotation);
    const model = opts.models?.get(f.id);
    g.add(model ? fitModelToItem(model, f) : proceduralBody(f));
    furniture.add(g);
  }
  scene.add(furniture);
  scene.updateMatrixWorld(true);
  return scene;
}

/** Binary glTF (GLB) of the project. */
export async function exportProjectGlb(project: Project, derived: DerivedPlan, opts: GlbExportOptions = {}): Promise<ArrayBuffer> {
  const scene = buildExportScene(project, derived, opts);
  const out = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: true });
  if (!(out instanceof ArrayBuffer)) throw new Error('GLB-Export lieferte keine Binärdaten');
  return out;
}

/** Reads the JSON chunk of a GLB (for checks and tests). */
export function readGlbJson(glb: ArrayBuffer): { asset: { version: string }; nodes?: { name?: string; children?: number[]; mesh?: number }[]; meshes?: unknown[] } {
  const v = new DataView(glb);
  if (v.getUint32(0, true) !== 0x46546c67) throw new Error('keine GLB-Datei');
  const len = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a) throw new Error('erster Chunk ist kein JSON');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, len)));
}
