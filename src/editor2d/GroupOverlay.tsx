import { groupBounds, groupMemberIds, groupName, groupOf } from '../model/groups';
import type { Project } from '../model/schema';
import type { Bounds, Vec2 } from '../model/vec';

// plan tokens (theme.css, same in light and dark – the SVG plan stays light)
const GROUP = 'var(--color-plan-group)';
const HALO = 'var(--color-plan-halo)';

/** Gap between the footprints and the group outline, in screen pixels. */
const PAD_PX = 7;
/** Distance of the rotation handle above the outline, in screen pixels. */
const HANDLE_PX = 22;

/** Rotation handle of a selected group: centred above its outline (`px` = metres per screen pixel). */
export function groupHandlePoint(b: Bounds, px: number): Vec2 {
  return { x: (b.minX + b.maxX) / 2, y: b.minY - (PAD_PX + HANDLE_PX) * px };
}

/**
 * Shared outline of a furniture group (#65) in the 2D plan: dashed with the group name and a
 * rotation handle when the whole group is selected; faint (no handle) while a single member
 * of it is selected, so the group stays recognisable.
 */
export function GroupOverlay({ project, selectedIds, groupId, px }: { project: Project; selectedIds: string[]; groupId: string | null; px: number }) {
  const context = !groupId && selectedIds.length === 1 ? groupOf(project, selectedIds[0]) : null;
  const gid = groupId ?? context;
  if (!gid) return null;
  const ids = groupMemberIds(project, gid);
  const b = groupBounds(project.furniture.filter((f) => ids.includes(f.id)));
  if (!b) return null;
  const pad = PAD_PX * px;
  const x = b.minX - pad;
  const y = b.minY - pad;
  const w = b.maxX - b.minX + 2 * pad;
  const h = b.maxY - b.minY + 2 * pad;
  const whole = !!groupId;
  const handle = groupHandlePoint(b, px);
  return (
    <g pointerEvents="none" data-testid="group-outline" data-group-id={gid} data-whole={whole ? 'true' : 'false'} opacity={whole ? 1 : 0.55}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={4 * px}
        fill="none"
        style={{ stroke: GROUP }}
        strokeWidth={whole ? 1.5 : 1}
        strokeDasharray={whole ? '6 4' : '2 3'}
        vectorEffect="non-scaling-stroke"
      />
      <text
        x={x}
        y={y + h + 13 * px}
        fontSize={11 * px}
        fontWeight={600}
        style={{ fill: GROUP, stroke: HALO }}
        strokeWidth={3 * px}
        paintOrder="stroke"
        data-testid="group-label"
      >
        {groupName(project, gid)}
      </text>
      {whole && (
        <g data-testid="group-rotate-handle">
          <line x1={handle.x} y1={y} x2={handle.x} y2={handle.y} style={{ stroke: GROUP }} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <circle cx={handle.x} cy={handle.y} r={5 * px} style={{ fill: GROUP, stroke: HALO }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </g>
  );
}
