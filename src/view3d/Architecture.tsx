import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Project, QualityMode } from '../model/schema';
import { add, dist, pointInPolygon, scale } from '../model/vec';
import { BASEBOARD_HEIGHT, BASEBOARD_THICKNESS, computeBaseboards, computeWindowSills } from '../model/geometry/details';
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
      <ArchitecturalDetails project={project} derived={derived} quality={quality} />
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
            const ft = 0.07; // outer frame (Blendrahmen)
            const st = 0.055; // sash (Flügel)
            const depth = Math.min(0.08, fp.thickness);
            const sashes = width > 1.3 ? 2 : 1;
            const innerW = width - 2 * ft;
            const sashW = innerW / sashes;
            const innerH = h - 2 * ft;
            const frameM = sel ? highlight : frameMat;
            return (
              <group key={o.id} position={[center.x, r.bottom, center.y]} rotation={[0, angle, 0]} onClick={select}>
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
                {Array.from({ length: sashes }, (_, k) => {
                  const cx = -innerW / 2 + sashW * (k + 0.5);
                  const handleX = sashes === 2 ? (k === 0 ? sashW / 2 - st / 2 : -sashW / 2 + st / 2) : sashW / 2 - st / 2;
                  return (
                    <group key={k} position={[cx, h / 2, 0]}>
                      {[
                        [0, -innerH / 2 + st / 2, sashW, st],
                        [0, innerH / 2 - st / 2, sashW, st],
                        [-sashW / 2 + st / 2, 0, st, innerH],
                        [sashW / 2 - st / 2, 0, st, innerH],
                      ].map(([x, y, sx, sy], i) => (
                        <mesh key={i} position={[x, y, 0]} scale={[sx, sy, depth * 0.85]} material={frameM} castShadow={shadows}>
                          <boxGeometry />
                        </mesh>
                      ))}
                      <mesh scale={[sashW - 2 * st, innerH - 2 * st, 0.012]} material={glassMat}>
                        <boxGeometry />
                      </mesh>
                      {[1, -1].map((side) => (
                        <mesh key={side} position={[handleX, 0, side * (depth * 0.45 + 0.012)]} scale={[0.02, 0.13, 0.02]} material={metalMat}>
                          <boxGeometry />
                        </mesh>
                      ))}
                    </group>
                  );
                })}
              </group>
            );
          }
          if (o.kind === 'door') {
            const ds = doorSymbol(fp, r);
            const jamb = 0.012; // Zarge in the reveal
            const casing = 0.065; // Bekleidung on both wall faces
            const leafW = width - 2 * jamb;
            const leafH = h - jamb;
            const leafAngle = -Math.atan2(ds.openTip.y - ds.hinge.y, ds.openTip.x - ds.hinge.x);
            // the leaf hangs inside the frame: move the hinge inwards by the jamb thickness
            const hinge = add(ds.hinge, scale(fp.dir, (o.hinge === 'start' ? 1 : -1) * jamb));
            const frameM = sel ? highlight : frameMat;
            return (
              <group key={o.id} onClick={select}>
                <group position={[hinge.x, r.bottom, hinge.y]} rotation={[0, leafAngle, 0]}>
                  <mesh position={[leafW / 2, leafH / 2, 0.02]} scale={[leafW, leafH, 0.04]} material={sel ? highlight : doorMat} castShadow={shadows} receiveShadow={shadows}>
                    <boxGeometry />
                  </mesh>
                  {[1, -1].map((side) => (
                    <group key={side} position={[leafW - 0.07, 1.05, 0.02 + side * 0.02]}>
                      <mesh position={[0, 0, side * 0.006]} rotation={[Math.PI / 2, 0, 0]} scale={[0.05, 0.012, 0.05]} material={metalMat}>
                        <cylinderGeometry args={[0.5, 0.5, 1, 20]} />
                      </mesh>
                      <mesh position={[-0.055, 0, side * 0.04]} scale={[0.13, 0.018, 0.018]} material={metalMat} castShadow={shadows}>
                        <boxGeometry />
                      </mesh>
                      <mesh position={[0, 0, side * 0.025]} scale={[0.018, 0.018, 0.04]} material={metalMat}>
                        <boxGeometry />
                      </mesh>
                    </group>
                  ))}
                </group>
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
          }
          return null;
        });
      })}
    </group>
  );
});

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
      {baseboards.map((b, i) => {
        const len = dist(b.a, b.b);
        const mid = add(scale(add(b.a, b.b), 0.5), scale(b.inward, BASEBOARD_THICKNESS / 2));
        return (
          <mesh
            key={i}
            position={[mid.x, BASEBOARD_HEIGHT / 2, mid.y]}
            rotation={[0, -Math.atan2(b.b.y - b.a.y, b.b.x - b.a.x), 0]}
            scale={[len, BASEBOARD_HEIGHT, BASEBOARD_THICKNESS]}
            material={boardMat}
            receiveShadow={shadows}
          >
            <boxGeometry />
          </mesh>
        );
      })}
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
