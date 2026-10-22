import { memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Project, QualityMode } from '../model/schema';
import { add, dist, pointInPolygon, scale } from '../model/vec';
import { BASEBOARD_HEIGHT, BASEBOARD_THICKNESS, computeBaseboards, computeWindowSills } from '../model/geometry/details';
import {
  DOOR_LEAF_UNDERCUT,
  LEAF_OPEN_ANGLE,
  leafTurnSign,
  WINDOW_FRAME,
  WINDOW_SASH_DEPTH_FACTOR,
  WINDOW_SASH_PROFILE,
  windowFrameDepth,
  type OpeningLeaf,
} from '../model/geometry/leaves';
import { DEFAULT_CEILING_MATERIAL_ID, DEFAULT_FLOOR_MATERIAL_ID, DEFAULT_WALL_MATERIAL_ID, materialById } from '../model/materials';
import { buildFlatPolygon, buildWallGeometry } from './prismGeometry';
import { getColorMaterial, getSurfaceMaterial } from './materials3d';
import { blockBehind, isClick, isClippedHit } from './pointer';
import { requestLampShadowUpdate } from './lampRegistry';

interface Props {
  project: Project;
  derived: DerivedPlan;
  quality: QualityMode;
  selectedId: string | null;
  onSelect: (type: 'wall' | 'room' | 'opening', id: string) => void;
  /** Double-click on a door/window opens or closes it (#21); omitted = no toggling (walkthrough). */
  onToggleOpening?: (id: string) => void;
  showCeilings: boolean;
}

/**
 * Walls, floors, ceilings, doors and windows generated from the shared model.
 * Geometry is rebuilt only when the architecture key (nodes/walls/openings/rooms/materials) changes.
 */
export const Architecture = memo(function Architecture({ project, derived, quality, selectedId, onSelect, onToggleOpening, showCeilings }: Props) {
  const shadows = quality === 'realism';

  const wallMeshes = useMemo(() => {
    const roomPolys = project.rooms
      .map((r) => ({ room: r, geo: derived.rooms.get(r.id) }))
      .filter((x): x is { room: typeof x.room; geo: NonNullable<typeof x.geo> } => !!x.geo);
    return project.walls
      .map((w) => {
        const fp = derived.footprints.get(w.id);
        const pieces = derived.pieces.get(w.id);
        if (!fp || !pieces) return null;
        const mid = scale(add(fp.a, fp.b), 0.5);
        const sideRoom = (sign: 1 | -1) => {
          const probe = add(mid, scale(fp.normal, sign * (fp.thickness / 2 + 0.05)));
          return roomPolys.find((r) => pointInPolygon(probe, r.geo.interior))?.room;
        };
        const leftRoom = sideRoom(1);
        const rightRoom = sideRoom(-1);
        const leftMat = materialById(project.materials, w.leftMaterialId ?? leftRoom?.wallMaterialId, DEFAULT_WALL_MATERIAL_ID);
        const rightMat = materialById(project.materials, w.rightMaterialId ?? rightRoom?.wallMaterialId, DEFAULT_WALL_MATERIAL_ID);
        return { wall: w, geometry: buildWallGeometry(fp, pieces), leftMat, rightMat };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }, [project.walls, project.rooms, project.materials, derived]);

  useEffect(() => () => wallMeshes.forEach((m) => m.geometry.dispose()), [wallMeshes]);

  const hubGeometry = useMemo(() => {
    if (derived.hubs.length === 0) return null;
    const pieces = derived.hubs.map((h) => ({ polygon: h.polygon, z0: 0, z1: h.height }));
    // a neutral footprint frame: every hub face goes into the "other" material group
    const frame = { wallId: 'hubs', a: { x: 0, y: 0 }, b: { x: 1, y: 0 }, dir: { x: 1, y: 0 }, normal: { x: 0, y: 1 }, length: 1, thickness: 0, polygon: [] };
    return buildWallGeometry({ ...frame, normal: { x: 0, y: 0 } }, pieces);
  }, [derived]);
  useEffect(() => () => hubGeometry?.dispose(), [hubGeometry]);

  const floors = useMemo(
    () =>
      project.rooms
        .map((r) => {
          const g = derived.rooms.get(r.id);
          if (!g || g.interior.length < 3) return null;
          const wallsAround = r.nodeIds
            .map((id, i) => project.walls.find((w) => (w.a === id && w.b === r.nodeIds[(i + 1) % r.nodeIds.length]) || (w.b === id && w.a === r.nodeIds[(i + 1) % r.nodeIds.length])))
            .filter(Boolean);
          const ceilingH = wallsAround.length ? Math.min(...wallsAround.map((w) => w!.height)) : project.settings.defaultWallHeight;
          return {
            room: r,
            floor: buildFlatPolygon(g.interior, 0.001, true),
            ceiling: buildFlatPolygon(g.interior, ceilingH, false),
            floorMat: materialById(project.materials, r.floorMaterialId, DEFAULT_FLOOR_MATERIAL_ID),
            ceilingMat: materialById(project.materials, r.ceilingMaterialId, DEFAULT_CEILING_MATERIAL_ID),
          };
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    [project.rooms, project.walls, project.materials, project.settings.defaultWallHeight, derived],
  );
  useEffect(
    () => () =>
      floors.forEach((f) => {
        f.floor.dispose();
        f.ceiling.dispose();
      }),
    [floors],
  );

  const highlight = getColorMaterial('#60a5fa', quality, { roughness: 0.6 });
  const frameMat = getColorMaterial('#f5f5f4', quality, { roughness: 0.5 });
  const glassMat = getColorMaterial('#a5c8e1', quality, { roughness: 0.05, metalness: 0.1, opacity: 0.28 });
  const doorMat = getColorMaterial('#f1eee8', quality, { roughness: 0.45 });
  const metalMat = getColorMaterial('#b5b8bc', quality, { roughness: 0.25, metalness: 0.9 });

  return (
    <group>
      {wallMeshes.map(({ wall, geometry, leftMat, rightMat }) => {
        const sel = selectedId === wall.id;
        const mats = sel
          ? [highlight, highlight, highlight]
          : [getSurfaceMaterial(leftMat, quality), getSurfaceMaterial(rightMat, quality), getColorMaterial('#e7e5e4', quality, { roughness: 0.9 })];
        return (
          <mesh
            key={wall.id}
            geometry={geometry}
            material={mats}
            castShadow={shadows}
            receiveShadow={shadows}
            onPointerDown={blockBehind}
            onClick={(e) => {
              if (isClippedHit(e)) return;
              e.stopPropagation();
              if (isClick(e)) onSelect('wall', wall.id);
            }}
          />
        );
      })}
      {hubGeometry && (
        <mesh
          geometry={hubGeometry}
          material={[highlight, highlight, getSurfaceMaterial(materialById(project.materials, undefined, DEFAULT_WALL_MATERIAL_ID), quality)]}
          castShadow={shadows}
          receiveShadow={shadows}
          onPointerDown={blockBehind}
          onClick={blockBehind}
        />
      )}
      {floors.map((f) => (
        <group key={f.room.id}>
          <mesh
            geometry={f.floor}
            material={selectedId === f.room.id ? highlight : getSurfaceMaterial(f.floorMat, quality)}
            receiveShadow={shadows}
            onClick={(e) => {
              e.stopPropagation();
              if (isClick(e)) onSelect('room', f.room.id);
            }}
          />
          {showCeilings && <mesh geometry={f.ceiling} material={getSurfaceMaterial(f.ceilingMat, quality)} receiveShadow={shadows} />}
        </group>
      ))}
      <ArchitecturalDetails project={project} derived={derived} quality={quality} />
      {project.walls.map((w) => {
        const fp = derived.footprints.get(w.id);
        if (!fp) return null;
        const angle = -Math.atan2(fp.dir.y, fp.dir.x);
        return (derived.openings.get(w.id) ?? []).map((r) => {
          const o = r.opening;
          if (o.kind === 'passage') return null;
          const width = r.s1 - r.s0;
          const center = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
          const h = r.top - r.bottom;
          const sel = selectedId === o.id;
          const leaves = derived.leaves.get(o.id) ?? [];
          const select = (e: ThreeEvent<MouseEvent>) => {
            if (isClippedHit(e)) return;
            e.stopPropagation();
            if (isClick(e)) onSelect('opening', o.id);
          };
          // double-click opens/closes the leaf (#21); the first click has already selected it
          const toggle = (e: ThreeEvent<MouseEvent>) => {
            if (!onToggleOpening || isClippedHit(e)) return;
            e.stopPropagation();
            if (!isClick(e)) return;
            onSelect('opening', o.id);
            onToggleOpening(o.id);
          };
          const frameM = sel ? highlight : frameMat;
          if (o.kind === 'window') {
            const ft = WINDOW_FRAME; // outer frame (Blendrahmen)
            const depth = windowFrameDepth(fp.thickness);
            return (
              <group key={o.id} userData={{ openingId: o.id }} onPointerDown={blockBehind} onClick={select} onDoubleClick={toggle}>
                <group position={[center.x, r.bottom, center.y]} rotation={[0, angle, 0]}>
                  {[
                    [0, ft / 2, width, ft],
                    [0, h - ft / 2, width, ft],
                    [-width / 2 + ft / 2, h / 2, ft, h],
                    [width / 2 - ft / 2, h / 2, ft, h],
                  ].map(([x, y, sx, sy], i) => (
                    <mesh key={i} position={[x, y, 0]} scale={[sx, sy, depth]} material={frameM} castShadow={shadows} receiveShadow={shadows}>
                      <boxGeometry />
                    </mesh>
                  ))}
                </group>
                {leaves.map((l, k) => (
                  <LeafPivot key={k} leaf={l} name={`leaf:${o.id}:${k}`}>
                    <WindowSash leaf={l} depth={depth * WINDOW_SASH_DEPTH_FACTOR} frame={frameM} glass={glassMat} metal={metalMat} shadows={shadows} />
                  </LeafPivot>
                ))}
              </group>
            );
          }
          const jamb = 0.012; // Zarge in the reveal
          const casing = 0.065; // Bekleidung on both wall faces
          return (
            <group key={o.id} userData={{ openingId: o.id }} onPointerDown={blockBehind} onClick={select} onDoubleClick={toggle}>
              {leaves.map((l, k) => (
                // the leaf hangs inside the frame: its hinge sits the jamb thickness further in
                <LeafPivot key={k} leaf={l} inset={jamb} name={`leaf:${o.id}:${k}`}>
                  <DoorLeaf leaf={l} jamb={jamb} material={sel ? highlight : doorMat} metal={metalMat} shadows={shadows} />
                </LeafPivot>
              ))}
              <group position={[center.x, r.bottom, center.y]} rotation={[0, angle, 0]}>
                {/* jambs and head covering the reveal */}
                {[
                  [-width / 2 + jamb / 2, h / 2, jamb, h],
                  [width / 2 - jamb / 2, h / 2, jamb, h],
                  [0, h - jamb / 2, width, jamb],
                ].map(([x, y, sx, sy], i) => (
                  <mesh key={`j${i}`} position={[x, y, 0]} scale={[sx, sy, fp.thickness + 0.004]} material={frameM} receiveShadow={shadows}>
                    <boxGeometry />
                  </mesh>
                ))}
                {/* casings on both faces */}
                {[1, -1].flatMap((side) =>
                  [
                    [-width / 2 - casing / 2 + 0.01, (h + casing) / 2, casing, h + casing],
                    [width / 2 + casing / 2 - 0.01, (h + casing) / 2, casing, h + casing],
                    [0, h + casing / 2 - 0.01, width + 2 * casing - 0.02, casing],
                  ].map(([x, y, sx, sy], i) => (
                    <mesh key={`c${side}${i}`} position={[x, y, side * (fp.thickness / 2 + 0.006)]} scale={[sx, sy, 0.012]} material={frameM} castShadow={shadows} receiveShadow={shadows}>
                      <boxGeometry />
                    </mesh>
                  )),
                )}
              </group>
            </group>
          );
        });
      })}
    </group>
  );
});

/** Turning speed of a leaf being opened or closed (rad/s): 90° in about 0.6 s. */
const LEAF_SPEED = 2.6;
/** Rendered door leaf thickness. */
const DOOR_LEAF_T = 0.04;

/**
 * Hinge of a door leaf or window sash (#21). Children are drawn in the leaf frame:
 * x from the hinge to the free edge, y up from the leaf's lower edge, z across the leaf
 * (the swing side is +z · leafTurnSign). Opening/closing turns it smoothly about the hinge.
 */
function LeafPivot({ leaf, inset = 0, name, children }: { leaf: OpeningLeaf; inset?: number; name: string; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const target = leaf.open ? LEAF_OPEN_ANGLE : 0;
  // current angle: starts in the stored state (no animation on load), then follows it
  const angle = useRef(target);
  const s = leafTurnSign(leaf);
  const base = -Math.atan2(leaf.closedDir.y, leaf.closedDir.x);
  const pivot = add(leaf.hinge, scale(leaf.closedDir, inset));
  useLayoutEffect(() => {
    if (ref.current) ref.current.rotation.y = base - s * angle.current;
  }, [base, s]);
  useFrame((_, dt) => {
    const g = ref.current;
    const diff = target - angle.current;
    if (!g || diff === 0) return;
    const step = LEAF_SPEED * Math.min(dt, 0.1);
    angle.current = Math.abs(diff) <= step ? target : angle.current + Math.sign(diff) * step;
    g.rotation.y = base - s * angle.current;
    // a moving door changes where lamp light reaches (#130)
    requestLampShadowUpdate();
  });
  return (
    <group ref={ref} name={name} position={[pivot.x, leaf.z0, pivot.y]}>
      {children}
    </group>
  );
}

/** Door leaf with lever handles on both faces; closed, it sits in the frame behind the swing-side face. */
function DoorLeaf({ leaf, jamb, material, metal, shadows }: { leaf: OpeningLeaf; jamb: number; material: THREE.Material; metal: THREE.Material; shadows: boolean }) {
  const t = DOOR_LEAF_T;
  const zc = (-leafTurnSign(leaf) * t) / 2;
  const leafW = leaf.width - 2 * jamb;
  const leafH = leaf.z1 - leaf.z0 - jamb;
  // handle 1.05 m above the floor; the leaf starts at its undercut
  const handleY = 1.05 - DOOR_LEAF_UNDERCUT;
  return (
    <>
      <mesh position={[leafW / 2, leafH / 2, zc]} scale={[leafW, leafH, t]} material={material} castShadow={shadows} receiveShadow={shadows}>
        <boxGeometry />
      </mesh>
      {[1, -1].map((side) => (
        <group key={side} position={[leafW - 0.07, handleY, zc + (side * t) / 2]}>
          <mesh position={[0, 0, side * 0.006]} rotation={[Math.PI / 2, 0, 0]} scale={[0.05, 0.012, 0.05]} material={metal}>
            <cylinderGeometry args={[0.5, 0.5, 1, 20]} />
          </mesh>
          <mesh position={[-0.055, 0, side * 0.04]} scale={[0.13, 0.018, 0.018]} material={metal} castShadow={shadows}>
            <boxGeometry />
          </mesh>
          <mesh position={[0, 0, side * 0.025]} scale={[0.018, 0.018, 0.04]} material={metal}>
            <boxGeometry />
          </mesh>
        </group>
      ))}
    </>
  );
}

/** Window sash (profile frame, glass, handles at the free edge); closed, it sits in the middle of the frame. */
function WindowSash({ leaf, depth, frame, glass, metal, shadows }: { leaf: OpeningLeaf; depth: number; frame: THREE.Material; glass: THREE.Material; metal: THREE.Material; shadows: boolean }) {
  const st = WINDOW_SASH_PROFILE;
  const w = leaf.width;
  const h = leaf.z1 - leaf.z0;
  const zc = (-leafTurnSign(leaf) * depth) / 2;
  return (
    <>
      {[
        [w / 2, st / 2, w, st],
        [w / 2, h - st / 2, w, st],
        [st / 2, h / 2, st, h],
        [w - st / 2, h / 2, st, h],
      ].map(([x, y, sx, sy], i) => (
        <mesh key={i} position={[x, y, zc]} scale={[sx, sy, depth]} material={frame} castShadow={shadows}>
          <boxGeometry />
        </mesh>
      ))}
      <mesh position={[w / 2, h / 2, zc]} scale={[w - 2 * st, h - 2 * st, 0.012]} material={glass}>
        <boxGeometry />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[w - st / 2, h / 2, zc + side * (depth / 2 + 0.014)]} scale={[0.02, 0.13, 0.02]} material={metal}>
          <boxGeometry />
        </mesh>
      ))}
    </>
  );
}

/** Baseboards and window sills, derived from the plan (see model/geometry/details.ts). */
const ArchitecturalDetails = memo(function ArchitecturalDetails({ project, derived, quality }: { project: Project; derived: DerivedPlan; quality: QualityMode }) {
  const baseboards = useMemo(() => computeBaseboards(project, derived), [project, derived]);
  const sills = useMemo(() => computeWindowSills(project, derived), [project, derived]);
  const shadows = quality === 'realism';
  const boardMat = getColorMaterial('#f6f4ef', quality, { roughness: 0.4 });
  const stoneMat = getColorMaterial('#e9e6df', quality, { roughness: 0.25 });
  const aluMat = getColorMaterial('#8f9398', quality, { roughness: 0.4, metalness: 0.6 });
  return (
    <group>
      <BaseboardInstances boards={baseboards} material={boardMat} shadows={shadows} />
      {sills.map((s, i) => {
        const t = s.side === 'inside' ? 0.02 : 0.015;
        return (
          <mesh
            key={i}
            position={[s.center.x, s.height + t / 2, s.center.y]}
            rotation={[0, -Math.atan2(s.dir.y, s.dir.x), 0]}
            scale={[s.width, t, s.depth]}
            material={s.side === 'inside' ? stoneMat : aluMat}
            castShadow={shadows}
            receiveShadow={shadows}
          >
            <boxGeometry />
          </mesh>
        );
      })}
    </group>
  );
});

/** All skirting boards as one instanced mesh (a single draw call). */
function BaseboardInstances({ boards, material, shadows }: { boards: ReturnType<typeof computeBaseboards>; material: THREE.Material; shadows: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    boards.forEach((b, i) => {
      const len = dist(b.a, b.b);
      const mid = add(scale(add(b.a, b.b), 0.5), scale(b.inward, BASEBOARD_THICKNESS / 2));
      q.setFromAxisAngle(up, -Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x));
      m.compose(new THREE.Vector3(mid.x, BASEBOARD_HEIGHT / 2, mid.y), q, new THREE.Vector3(len, BASEBOARD_HEIGHT, BASEBOARD_THICKNESS));
      mesh.setMatrixAt(i, m);
    });
    mesh.count = boards.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boards]);
  if (boards.length === 0) return null;
  return <instancedMesh key={boards.length} ref={ref} args={[geometry, material, boards.length]} receiveShadow={shadows} raycast={() => null} />;
}

/** A large neutral ground plane under the apartment; `y` = its height relative to the active storey (#54). */
export function Ground({ quality, y = 0 }: { quality: QualityMode; y?: number }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d6d3cd', roughness: 1 }), []);
  const lam = useMemo(() => new THREE.MeshLambertMaterial({ color: '#d6d3cd' }), []);
  useEffect(
    () => () => {
      mat.dispose();
      lam.dispose();
    },
    [mat, lam],
  );
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, y - 0.005, 0]} receiveShadow={quality === 'realism'} material={quality === 'realism' ? mat : lam}>
      <planeGeometry args={[400, 400]} />
    </mesh>
  );
}
