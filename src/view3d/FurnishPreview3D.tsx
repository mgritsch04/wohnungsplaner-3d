import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Furniture } from '../model/schema';
import { planRotationToWorldY } from '../model/units';
import { useFurnishStore } from '../suggest/furnishStore';
import { ProceduralModel } from './ProceduralModel';
import { useSceneSnap } from './sceneSnap';

/**
 * Furnishing suggestion (#137) in 3D: the proposed items as simple models with a coloured
 * outline (visible through walls), so the suggestion can be judged before it is applied.
 */
export function FurnishPreview3D() {
  const preview = useFurnishStore((s) => s.preview);
  const color = useMemo(() => {
    const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--color-accent').trim() : '';
    return /^#[0-9a-f]{6}$/i.test(v) ? v : '#2563eb';
  }, []);
  if (!preview?.items.length) return null;
  return (
    <group name="furnish-preview">
      {preview.items.map((f) => (
        <Ghost key={f.id} item={f} color={color} />
      ))}
    </group>
  );
}

function Ghost({ item, color }: { item: Furniture; color: string }) {
  // a picture for Claude shows the room as applied: no outlines (#443)
  const bare = useSceneSnap((s) => s.bare);
  const h = Math.max(item.height, 0.02);
  const edges = useMemo(() => {
    const box = new THREE.BoxGeometry(item.width + 0.02, h + 0.02, item.depth + 0.02);
    const e = new THREE.EdgesGeometry(box);
    box.dispose();
    return e;
  }, [item.width, item.depth, h]);
  useEffect(() => () => edges.dispose(), [edges]);
  const shape = item.model.type === 'procedural' ? item.model.shape : item.model.fallbackShape;
  return (
    <group position={[item.x, item.elevation, item.y]} rotation={[0, planRotationToWorldY(item.rotation), 0]} userData={{ furnishPreview: true, name: item.name }}>
      <ProceduralModel shape={shape} width={item.width} depth={item.depth} height={item.height} color={item.color} quality="planning" castShadow={false} />
      {!bare && (
        <lineSegments geometry={edges} position={[0, h / 2, 0]} raycast={() => null} renderOrder={3}>
          <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
        </lineSegments>
      )}
    </group>
  );
}
