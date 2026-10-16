import { memo } from 'react';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useNarrowPassages } from '../ui/useNarrowPassages';

const RED = '#dc2626';
const noRaycast = () => null;
/** Just above the floor (and above rugs) to avoid z-fighting. */
const Y = 0.02;

/**
 * Narrow passages (#68) as a subtle red strip on the floor across the narrowest
 * spot, with small end marks. Excluded from raycasting, so it never interferes
 * with selection or dragging.
 */
export const NarrowPassageMarkers = memo(function NarrowPassageMarkers({ project, derived }: { project: Project; derived: DerivedPlan }) {
  const passages = useNarrowPassages(project, derived);
  return (
    <group name="narrow-passages">
      {passages.map((p, i) => {
        const dx = p.b.x - p.a.x;
        const dy = p.b.y - p.a.y;
        const len = Math.max(Math.hypot(dx, dy), 0.01);
        // plan x/y → world X/Z; a plan angle maps to rotation.y = −angle
        const rot = -Math.atan2(dy, dx);
        return (
          <group key={i} position={[(p.a.x + p.b.x) / 2, Y, (p.a.y + p.b.y) / 2]} rotation={[0, rot, 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={2}>
              <planeGeometry args={[len, 0.16]} />
              <meshBasicMaterial color={RED} transparent opacity={0.55} depthWrite={false} />
            </mesh>
            {[-len / 2, len / 2].map((x, k) => (
              <mesh key={k} position={[x, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={2}>
                <planeGeometry args={[0.03, 0.3]} />
                <meshBasicMaterial color={RED} transparent opacity={0.8} depthWrite={false} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
});
