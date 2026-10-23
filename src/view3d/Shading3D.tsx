import { useMemo } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import type { Opening } from '../model/schema';
import { blindOverrides } from '../smarthome/simulation';
import { useSimStore } from '../smarthome/simStore';
import { useProjectStore } from '../store/projectStore';
import { cycleShading } from '../ui/shadingActions';
import { blockBehind, isClick, isClippedHit } from './pointer';

const COLOR = { roller: '#cfc9bb', venetian: '#e6e2d8', pleated: '#f1ece0' } as const;

/**
 * Window covering in 3D (#413): roller shutter (plain panel in a box), venetian blind (slats) or
 * pleated blind, hanging from the top of the window. The closing degree is the planned one, or the
 * one the running smart-home simulation drives. Double-click cycles open → half → closed.
 * Drawn in the window's frame (x along the wall, y up from the sill), just outside the sash.
 */
export function Shading3D({ opening, width, height, depth }: { opening: Opening; width: number; height: number; depth: number }) {
  const shading = opening.shading;
  const state = useSimStore((s) => s.state);
  const project = useProjectStore((s) => s.project);
  const closed = useMemo(() => {
    if (!shading) return 0;
    const sim = state ? blindOverrides(project, state).openings.get(opening.id) : undefined;
    return sim ?? shading.closed;
  }, [shading, state, project, opening.id]);
  if (!shading) return null;
  const z = depth / 2 + 0.03;
  const box = 0.09;
  const cover = Math.max(0, closed * (height - box * 0.5));
  const color = COLOR[shading.type];
  const toggle = (e: ThreeEvent<MouseEvent>) => {
    if (isClippedHit(e)) return;
    e.stopPropagation();
    if (isClick(e)) cycleShading(opening.id);
  };
  const slats = shading.type === 'venetian' ? Math.min(60, Math.ceil(cover / 0.05)) : 0;
  return (
    <group position={[0, 0, z]} userData={{ shadingFor: opening.id }} onPointerDown={blockBehind} onDoubleClick={toggle}>
      <mesh position={[0, height - box / 2, 0]} scale={[width, box, box]}>
        <boxGeometry />
        <meshStandardMaterial color="#9a958a" roughness={0.7} />
      </mesh>
      {cover > 0.01 && shading.type !== 'venetian' && (
        <mesh position={[0, height - box - cover / 2, 0]} scale={[width - 0.02, cover, shading.type === 'roller' ? 0.02 : 0.012]}>
          <boxGeometry />
          <meshStandardMaterial color={color} roughness={0.9} />
        </mesh>
      )}
      {Array.from({ length: slats }, (_, i) => (
        <mesh key={i} position={[0, height - box - 0.025 - i * (cover / Math.max(1, slats)), 0]} rotation={[0.35, 0, 0]} scale={[width - 0.02, 0.045, 0.006]}>
          <boxGeometry />
          <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
        </mesh>
      ))}
    </group>
  );
}
