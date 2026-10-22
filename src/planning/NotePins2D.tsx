import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { noteAnchor } from './planning';
import { usePlanningStore } from './planningStore';

/** Notes (#83) as pins in the 2D plan; a click opens the note text next to the pin. */
export function NotePins2D({ project, derived, px }: { project: Project; derived: DerivedPlan; px: number }) {
  const openId = usePlanningStore((s) => s.openNoteId);
  const setOpen = usePlanningStore((s) => s.setOpenNote);
  if (!project.notes.length) return null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <g data-testid="note-pins">
      {project.notes.map((n) => {
        const at = noteAnchor(project, derived, n);
        if (!at) return null;
        const open = openId === n.id;
        const r = 9 * px;
        const lines = (n.text || '(leere Notiz)').split('\n').flatMap((l) => l.match(/.{1,28}/g) ?? ['']).slice(0, 8);
        return (
          <g
            key={n.id}
            data-testid="note-pin"
            data-note-id={n.id}
            transform={`translate(${at.x} ${at.y - r})`}
            style={{ cursor: 'pointer' }}
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={(e) => {
              stop(e);
              setOpen(open ? null : n.id);
            }}
          >
            <title>{n.text || 'Notiz'}</title>
            <path d={`M0 ${r} L${-r * 0.6} ${-r * 0.3} A${r * 0.7} ${r * 0.7} 0 1 1 ${r * 0.6} ${-r * 0.3} Z`} style={{ fill: 'var(--color-plan-warn)', stroke: 'var(--color-plan-halo)' }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <circle cx={0} cy={-r * 0.6} r={r * 0.28} fill="#fff" />
            {open && (
              <g transform={`translate(${r} ${-r * 2})`} data-testid="note-bubble">
                <rect width={190 * px} height={(lines.length * 14 + 12) * px} rx={4 * px} style={{ fill: 'var(--color-plan-halo)', stroke: 'var(--color-plan-warn)' }} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                {lines.map((l, i) => (
                  <text key={i} x={8 * px} y={(18 + i * 14) * px} fontSize={11 * px} fill="#222">
                    {l}
                  </text>
                ))}
              </g>
            )}
          </g>
        );
      })}
    </g>
  );
}
