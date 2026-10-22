import { memo, useMemo } from 'react';
import { derivePlan } from '../model/derived';
import { neighbourLevel, projectOnLevel } from '../model/levels';
import type { Project } from '../model/schema';

/**
 * Walls of the storey below as a faint dashed outline (#54), so walls and stairs of the storey
 * above can be drawn right on top of them. Not clickable.
 */
export const LowerLevelOverlay = memo(function LowerLevelOverlay({ project }: { project: Project }) {
  const below = neighbourLevel(project, -1);
  const plan = below?.plan;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const footprints = useMemo(() => (below ? [...derivePlan(projectOnLevel(project, below.id)).footprints.values()] : []), [plan, below?.id]);
  if (!below || footprints.length === 0) return null;
  return (
    <g pointerEvents="none" data-testid="lower-level" opacity={0.55}>
      <title>{`Wände der Etage darunter: ${below.name}`}</title>
      {footprints.map((fp) => (
        <polygon
          key={fp.wallId}
          points={fp.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          style={{ stroke: 'var(--color-text-muted, #636b78)' }}
          strokeWidth={1}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </g>
  );
});
