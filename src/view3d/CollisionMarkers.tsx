import { memo, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Furniture } from '../model/schema';
import type { CollisionRegion, FurnitureConflict, PlacementIssue } from '../model/placement';
import { planRotationToWorldY } from '../model/units';

const COLORS = { error: '#e11d48', warn: '#f59e0b' } as const;
const noRaycast = () => null;

/** Vertical prism of a convex plan polygon (plan x/y → world X/Z, z0..z1 → world Y). */
export function regionGeometry(r: CollisionRegion): THREE.BufferGeometry {
  const shape = new THREE.Shape(r.polygon.map((p) => new THREE.Vector2(p.x, -p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.002, r.z1 - r.z0), bevelEnabled: false });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, r.z0, 0);
  return geo;
}

interface Props {
  conflicts: Map<string, FurnitureConflict>;
  furniture: Furniture[];
}

/**
 * Collision feedback in the 3D room: affected items get a coloured outline and
 * tint, the intersection volume is shown as a translucent block, and the
 * responsible obstacle (wall piece, door leaf, door swing) is outlined.
 * Red = real intersection (wall/door leaf), amber = warning (door swing, outside).
 * Rendered on top (no depth test) and excluded from raycasting, so it never
 * interferes with selection or dragging. Recomputed only when the plan changes.
 */
export const CollisionMarkers = memo(function CollisionMarkers({ conflicts, furniture }: Props) {
  const items = [...conflicts].flatMap(([id, c]) => {
    const f = furniture.find((x) => x.id === id);
    return f ? [{ f, c }] : [];
  });
  return (
    <group name="collision-markers">
      {items.map(({ f, c }) => (
        <ItemMarker key={f.id} item={f} conflict={c} />
      ))}
    </group>
  );
});

// geometry is rebuilt only for items whose conflict actually changed (e.g. the dragged one)
const ItemMarker = memo(
  function ItemMarker({ item, conflict }: { item: Furniture; conflict: FurnitureConflict }) {
    const color = COLORS[conflict.level];
    const box = useMemo(() => new THREE.BoxGeometry(item.width + 0.03, Math.max(0.02, item.height) + 0.03, item.depth + 0.03), [item.width, item.height, item.depth]);
    const edges = useMemo(() => new THREE.EdgesGeometry(box), [box]);
    useEffect(
      () => () => {
        box.dispose();
        edges.dispose();
      },
      [box, edges],
    );
    return (
      <group name={`collision:${item.id}`} userData={{ level: conflict.level, kinds: conflict.issues.map((i) => i.kind) }}>
        <group position={[item.x, item.elevation + Math.max(0.02, item.height) / 2, item.y]} rotation={[0, planRotationToWorldY(item.rotation), 0]}>
          <lineSegments geometry={edges} raycast={noRaycast} renderOrder={20}>
            <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
          </lineSegments>
          <mesh geometry={box} raycast={noRaycast} renderOrder={19}>
            <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
          </mesh>
        </group>
        {conflict.issues.map((issue, i) => (
          <IssueMarker key={`${issue.kind}-${issue.refId ?? i}`} issue={issue} color={COLORS[issue.kind === 'wall' || issue.kind === 'door-leaf' ? 'error' : 'warn']} itemId={item.id} />
        ))}
      </group>
    );
  },
  (a, b) => JSON.stringify([a.item, a.conflict]) === JSON.stringify([b.item, b.conflict]),
);

function IssueMarker({ issue, color, itemId }: { issue: PlacementIssue; color: string; itemId: string }) {
  // the door swing is a floor area: show it as a thin slab instead of a 2 m block
  const culpritRegion = useMemo(
    () => (issue.culprit && issue.kind === 'door-swing' ? { ...issue.culprit, z0: 0.004, z1: 0.012 } : issue.culprit),
    [issue.culprit, issue.kind],
  );
  const geos = useMemo(() => {
    const region = issue.region ? regionGeometry(issue.region) : null;
    const culprit = culpritRegion ? regionGeometry(culpritRegion) : null;
    return { region, culprit, culpritEdges: culprit ? new THREE.EdgesGeometry(culprit) : null };
  }, [issue.region, culpritRegion]);
  useEffect(
    () => () => {
      geos.region?.dispose();
      geos.culprit?.dispose();
      geos.culpritEdges?.dispose();
    },
    [geos],
  );
  return (
    <group name={`collision-issue:${itemId}:${issue.kind}:${issue.refId ?? ''}`} userData={{ message: issue.message }}>
      {geos.region && (
        <mesh geometry={geos.region} raycast={noRaycast} renderOrder={22}>
          <meshBasicMaterial color={color} transparent opacity={0.5} depthTest={false} depthWrite={false} />
        </mesh>
      )}
      {geos.culprit && issue.kind !== 'wall' && (
        <mesh geometry={geos.culprit} raycast={noRaycast} renderOrder={18}>
          <meshBasicMaterial color={color} transparent opacity={issue.kind === 'door-swing' ? 0.28 : 0.22} depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {geos.culpritEdges && (
        <lineSegments geometry={geos.culpritEdges} raycast={noRaycast} renderOrder={21}>
          <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.9} />
        </lineSegments>
      )}
    </group>
  );
}
