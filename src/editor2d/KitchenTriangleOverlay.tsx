import { formatM, type TriangleRole } from '../kitchen/workTriangle';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useKitchenTriangles } from '../ui/useKitchenTriangles';
import { rotate } from '../model/vec';

// design tokens (theme.css) – green within the rule of thumb, orange outside
const OK = 'var(--color-success)';
const OFF = 'var(--color-warning)';
const HALO = 'var(--color-surface)';

/** Kitchen work triangle (#82): dashed sides with their lengths, green/orange by rule of thumb. */
export function KitchenTriangleOverlay({ project, derived, px }: { project: Project; derived: DerivedPlan; px: number }) {
  const results = useKitchenTriangles(project, derived);
  const shown = results.filter((r) => r.corners && r.sides);
  if (shown.length === 0) return null;
  return (
    <g pointerEvents="none" data-testid="kitchen-triangles">
      {shown.map((r) => {
        const c = r.corners!;
        const pt = (role: TriangleRole) => c[role].point;
        const centroid = { x: (pt('sink').x + pt('cooktop').x + pt('fridge').x) / 3, y: (pt('sink').y + pt('cooktop').y + pt('fridge').y) / 3 };
        // a straight kitchen run gives an (almost) flat triangle: then stack the labels in front of it, into the room
        const [s0, s1, s2] = [pt('sink'), pt('cooktop'), pt('fridge')];
        const flat = Math.abs((s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y)) / 2 < 0.1;
        const front = (['sink', 'cooktop', 'fridge'] as const).reduce(
          (acc, role) => {
            const f = project.furniture.find((x) => x.id === c[role].id);
            const d = rotate({ x: 0, y: 1 }, f?.rotation ?? 0);
            return { x: acc.x + d.x, y: acc.y + d.y };
          },
          { x: 0, y: 0 },
        );
        const fl = Math.hypot(front.x, front.y) || 1;
        const into = { x: front.x / fl, y: front.y / fl };
        const longest = Math.max(...r.sides!.map((x) => x.length));
        const sumAt = flat ? { x: centroid.x + into.x * 44 * px, y: centroid.y + into.y * 44 * px } : centroid;
        return (
          <g key={r.roomId} data-testid="kitchen-triangle" data-ok={r.ok ? 'true' : 'false'}>
            {r.sides!.map((s) => {
              const a = pt(s.from);
              const b = pt(s.to);
              const color = s.status === 'ok' ? OK : OFF;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              // label pushed away from the triangle's centre
              const dx = mid.x - centroid.x;
              const dy = mid.y - centroid.y;
              const L = Math.hypot(dx, dy) || 1;
              const off = flat ? (s.length === longest ? 28 : 13) : 12;
              const dir = flat ? into : { x: dx / L, y: dy / L };
              const lab = { x: mid.x + dir.x * off * px, y: mid.y + dir.y * off * px };
              return (
                <g key={`${s.from}-${s.to}`} data-testid="kitchen-triangle-side" data-status={s.status}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} style={{ stroke: color }} strokeWidth={2.5} strokeDasharray="7 5" vectorEffect="non-scaling-stroke" />
                  <text
                    x={lab.x}
                    y={lab.y}
                    fontSize={11 * px}
                    fontWeight={700}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    paintOrder="stroke"
                    strokeWidth={3 * px}
                    style={{ fill: color, stroke: HALO }}
                  >
                    {formatM(s.length)}
                  </text>
                </g>
              );
            })}
            {(['sink', 'cooktop', 'fridge'] as const).map((role) => (
              <circle key={role} cx={pt(role).x} cy={pt(role).y} r={4 * px} style={{ fill: HALO, stroke: r.ok ? OK : OFF }} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
            <text
              x={sumAt.x}
              y={sumAt.y}
              fontSize={10 * px}
              textAnchor="middle"
              dominantBaseline="middle"
              paintOrder="stroke"
              strokeWidth={3 * px}
              style={{ fill: r.sumStatus === 'ok' ? OK : OFF, stroke: HALO }}
              data-testid="kitchen-triangle-sum"
            >
              Σ {formatM(r.sum!)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
