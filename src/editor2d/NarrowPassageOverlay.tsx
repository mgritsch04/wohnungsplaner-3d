import type { DerivedPlan } from '../model/derived';
import { passageLabel } from '../model/passages';
import type { Project } from '../model/schema';
import { add, normalize, perp, scale, sub } from '../model/vec';
import { useNarrowPassages } from '../ui/useNarrowPassages';

const RED = '#dc2626';

/** Narrow passages (#68) as red dimension lines with the clear width in cm. */
export function NarrowPassageOverlay({ project, derived, px }: { project: Project; derived: DerivedPlan; px: number }) {
  const passages = useNarrowPassages(project, derived);
  if (passages.length === 0) return null;
  return (
    <g pointerEvents="none" data-testid="narrow-passages">
      {passages.map((p, i) => {
        const d = normalize(sub(p.b, p.a));
        const n = perp(d);
        const tick = scale(n, 5 * px);
        const mid = scale(add(p.a, p.b), 0.5);
        // horizontal label beside the line (on the side the normal points to)
        const side = Math.abs(n.x) > 0.3 ? Math.sign(n.x) : 0;
        const label = side ? add(mid, scale(n, 7 * px)) : add(mid, { x: 0, y: (n.y >= 0 ? 10 : -10) * px });
        const anchor = side > 0 ? 'start' : side < 0 ? 'end' : 'middle';
        return (
          <g key={i} data-testid="narrow-passage" data-width-cm={Math.round(p.width * 100)} data-kind={p.kind}>
            <line x1={p.a.x} y1={p.a.y} x2={p.b.x} y2={p.b.y} stroke={RED} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            {[p.a, p.b].map((q, k) => (
              <line key={k} x1={q.x - tick.x} y1={q.y - tick.y} x2={q.x + tick.x} y2={q.y + tick.y} stroke={RED} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            ))}
            <text
              x={label.x}
              y={label.y}
              fontSize={11 * px}
              fontWeight={700}
              fill={RED}
              textAnchor={anchor}
              dominantBaseline="middle"
              paintOrder="stroke"
              stroke="#ffffff"
              strokeWidth={3 * px}
            >
              {passageLabel(p.width)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
