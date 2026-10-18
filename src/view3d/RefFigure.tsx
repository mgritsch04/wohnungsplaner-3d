import { useMemo } from 'react';
import type { DerivedPlan } from '../model/derived';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

/** Head diameter as a share of the body height (about one eighth). */
const HEAD_SHARE = 0.13;
const BODY_RADIUS = 0.18;
const noRaycast = () => {};

/**
 * Default spot of the reference figure (#263): middle of the largest room the walk does not start
 * in (so it is in sight from the start), else 1.5 m beside the start.
 */
export function defaultFigureSpot(derived: Pick<DerivedPlan, 'rooms'>, start: Vec2): Vec2 {
  let best: { c: Vec2; area: number } | null = null;
  for (const g of derived.rooms.values()) {
    if (Math.hypot(g.centroid.x - start.x, g.centroid.y - start.y) < 0.5) continue;
    if (!best || g.area > best.area) best = { c: g.centroid, area: g.area };
  }
  return best ? best.c : { x: start.x + 1.5, y: start.y };
}

/**
 * Neutral grey figure as tall as the body height set in the project (#263) – a size reference
 * for rooms and furniture. Not pickable, so it never blocks clicks or the crosshair.
 */
export function RefFigure({ derived, start }: { derived: DerivedPlan; start: Vec2 }) {
  const show = useProjectStore((s) => s.project.settings.showRefFigure);
  const height = useProjectStore((s) => s.project.settings.bodyHeight);
  const placed = useUiStore((s) => s.refFigurePos);
  const spot = useMemo(() => placed ?? defaultFigureSpot(derived, start), [placed, derived, start]);
  if (!show) return null;
  const head = height * HEAD_SHARE;
  const r = BODY_RADIUS;
  // capsule: cylinder part plus two half spheres, from the floor up to the neck
  const torso = height - head - 0.02;
  const length = Math.max(0.1, torso - 2 * r);
  return (
    <group position={[spot.x, 0, spot.y]} userData={{ refFigure: true, height }} name="ref-figure">
      <mesh position={[0, r + length / 2, 0]} raycast={noRaycast} castShadow>
        <capsuleGeometry args={[r, length, 6, 16]} />
        <meshStandardMaterial color="#9a9fa6" roughness={0.8} />
      </mesh>
      <mesh position={[0, height - head / 2, 0]} raycast={noRaycast} castShadow>
        <sphereGeometry args={[head / 2, 20, 14]} />
        <meshStandardMaterial color="#9a9fa6" roughness={0.8} />
      </mesh>
    </group>
  );
}
