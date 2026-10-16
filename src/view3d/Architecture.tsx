import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Project, QualityMode } from '../model/schema';
import { add, pointInPolygon, scale } from '../model/vec';
import { DEFAULT_CEILING_MATERIAL_ID, DEFAULT_FLOOR_MATERIAL_ID, DEFAULT_WALL_MATERIAL_ID, materialById } from '../model/materials';
import { buildFlatPolygon, buildWallGeometry } from './prismGeometry';
import { getColorMaterial, getSurfaceMaterial } from './materials3d';
import { doorSymbol } from '../editor2d/openingSymbols';

interface Props {
  project: Project;
  derived: DerivedPlan;
  quality: QualityMode;
  selectedId: string | null;
  onSelect: (type: 'wall' | 'room' | 'opening', id: string) => void;
  showCeilings: boolean;
}

/**
 * Walls, floors, ceilings, doors and windows generated from the shared model.
 * Geometry is rebuilt only when the architecture key (nodes/walls/openings/rooms/materials) changes.
 */
export const Architecture = memo(function Architecture({ project, derived, quality, selectedId, onSelect, showCeilings }: Props) {
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
  const doorMat = getColorMaterial('#ece7df', quality, { roughness: 0.6 });

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
            onClick={(e) => {
              e.stopPropagation();
              onSelect('wall', wall.id);
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
              onSelect('room', f.room.id);
            }}
          />
          {showCeilings && <mesh geometry={f.ceiling} material={getSurfaceMaterial(f.ceilingMat, quality)} receiveShadow={shadows} />}
        </group>
      ))}
      {project.walls.map((w) => {
        const fp = derived.footprints.get(w.id);
        if (!fp) return null;
        const angle = -Math.atan2(fp.dir.y, fp.dir.x);
        return (derived.openings.get(w.id) ?? []).map((r) => {
          const o = r.opening;
          const width = r.s1 - r.s0;
          const center = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
          const h = r.top - r.bottom;
          const sel = selectedId === o.id;
          const select = (e: { stopPropagation: () => void }) => {
            e.stopPropagation();
            onSelect('opening', o.id);
          };
          if (o.kind === 'window') {
            const ft = 0.06;
            const depth = Math.min(0.08, fp.thickness);
            return (
              <group key={o.id} position={[center.x, r.bottom, center.y]} rotation={[0, angle, 0]} onClick={select}>
                <mesh position={[0, h / 2, 0]} scale={[width - 2 * ft, h - 2 * ft, 0.01]} material={glassMat}>
                  <boxGeometry />
                </mesh>
                {[
                  [0, ft / 2, width, ft],
                  [0, h - ft / 2, width, ft],
                  [-width / 2 + ft / 2, h / 2, ft, h],
                  [width / 2 - ft / 2, h / 2, ft, h],
                  ...(width > 1.3 ? [[0, h / 2, ft, h]] : []),
                ].map(([x, y, sx, sy], i) => (
                  <mesh key={i} position={[x, y, 0]} scale={[sx, sy, depth]} material={sel ? highlight : frameMat} castShadow={shadows}>
                    <boxGeometry />
                  </mesh>
                ))}
                {/* window sill board on the inside is omitted: inside/outside is not known */}
              </group>
            );
          }
          if (o.kind === 'door') {
            const ds = doorSymbol(fp, r);
            // leaf opened 90°: it runs from the hinge along the swing normal
            const leafMid = scale(add(ds.hinge, ds.openTip), 0.5);
            const leafAngle = -Math.atan2(ds.openTip.y - ds.hinge.y, ds.openTip.x - ds.hinge.x);
            return (
              <group key={o.id} onClick={select}>
                <mesh position={[leafMid.x, r.bottom + (h - 0.01) / 2, leafMid.y]} rotation={[0, leafAngle, 0]} scale={[width - 0.02, h - 0.01, 0.04]} material={sel ? highlight : doorMat} castShadow={shadows}>
                  <boxGeometry />
                </mesh>
                <group position={[center.x, 0, center.y]} rotation={[0, angle, 0]}>
                  {[
                    [-width / 2 - 0.02, h / 2, 0.04, h],
                    [width / 2 + 0.02, h / 2, 0.04, h],
                    [0, h + 0.02, width + 0.08, 0.04],
                  ].map(([x, y, sx, sy], i) => (
                    <mesh key={i} position={[x, y, 0]} scale={[sx, sy, fp.thickness + 0.02]} material={sel ? highlight : frameMat}>
                      <boxGeometry />
                    </mesh>
                  ))}
                </group>
              </group>
            );
          }
          return null;
        });
      })}
    </group>
  );
});

/** A large neutral ground plane under the apartment. */
export function Ground({ quality }: { quality: QualityMode }) {
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.005, 0]} receiveShadow={quality === 'realism'} material={quality === 'realism' ? mat : lam}>
      <planeGeometry args={[400, 400]} />
    </mesh>
  );
}
