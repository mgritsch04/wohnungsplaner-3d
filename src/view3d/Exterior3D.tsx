import { useEffect, useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { offsetPolygon } from '../model/vec';
import { apartmentBox, STOREY_HEIGHT, type Entrance } from './exterior';

const SHELL_MARGIN = 0.35;

/**
 * Outside view (#92): a simple building around the apartment – roof, neighbouring storeys as
 * translucent blocks, a marker for the apartment and one for the entrance. Facade and windows
 * are the apartment's own walls, openings and sashes.
 */
export function Exterior3D({ project, derived, entrance }: { project: Project; derived: DerivedPlan; entrance: Entrance | null }) {
  const box = useMemo(() => apartmentBox(project, derived), [project, derived]);
  const roofs = useMemo(
    () =>
      project.rooms
        .map((r) => derived.rooms.get(r.id))
        .filter((g): g is NonNullable<typeof g> => !!g)
        .map((g) => {
          const shape = new THREE.Shape(offsetPolygon(g.interior, 0.12).map((p) => new THREE.Vector2(p.x, -p.y)));
          return new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false });
        }),
    [project.rooms, derived],
  );
  useEffect(() => () => roofs.forEach((g) => g.dispose()), [roofs]);
  if (!box) return null;
  const w = box.maxX - box.minX + SHELL_MARGIN * 2;
  const d = box.maxY - box.minY + SHELL_MARGIN * 2;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const H = box.height;
  const block = (y0: number, y1: number, key: string) => (
    <mesh key={key} position={[cx, (y0 + y1) / 2, cy]} renderOrder={-1}>
      <boxGeometry args={[w, y1 - y0, d]} />
      <meshStandardMaterial color="#c9ced4" transparent opacity={0.22} depthWrite={false} />
    </mesh>
  );
  return (
    <group name="exterior" data-testid="exterior-view">
      {roofs.map((g, i) => (
        <mesh key={i} geometry={g} rotation={[-Math.PI / 2, 0, 0]} position={[0, H, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#8a8f96" side={THREE.DoubleSide} />
        </mesh>
      ))}
      {block(-STOREY_HEIGHT, 0, 'below')}
      {block(H + 0.2, H + 0.2 + STOREY_HEIGHT, 'above')}
      <mesh position={[cx, H + 0.2 + STOREY_HEIGHT + 0.75, cy]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.35, 0.7, 4]} />
        <meshStandardMaterial color="#e5484d" />
      </mesh>
      <Html position={[cx, H + 0.2 + STOREY_HEIGHT + 1.4, cy]} center zIndexRange={[5, 0]}>
        <div className="exterior-label exterior-label-home">Ihre Wohnung</div>
      </Html>
      {entrance && (
        <>
          <mesh position={[entrance.position.x + entrance.outward.x * 0.5, 0.06, entrance.position.y + entrance.outward.y * 0.5]} rotation={[0, -Math.atan2(entrance.outward.y, entrance.outward.x), 0]}>
            <boxGeometry args={[0.9, 0.04, 0.9]} />
            <meshStandardMaterial color="#2f9e63" />
          </mesh>
          <Html position={[entrance.position.x + entrance.outward.x * 0.5, 2.5, entrance.position.y + entrance.outward.y * 0.5]} center zIndexRange={[5, 0]}>
            <div className="exterior-label" data-testid="exterior-entrance-label">Eingang</div>
          </Html>
        </>
      )}
    </group>
  );
}
