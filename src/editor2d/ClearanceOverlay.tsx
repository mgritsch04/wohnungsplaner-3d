import { useEffect, useMemo, useState } from 'react';
import { clearanceLabel, furnitureClearances, layoutClearance, rotateHandlePoint } from '../model/clearances';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { normalize, perp, scale, sub } from '../model/vec';
import { useUiStore } from '../store/uiStore';

const LINE = '#2563eb';
const TEXT = '#1d4ed8';

/** True while the Alt key is held (reset when the window loses focus, e.g. Alt+Tab). */
function useAltHeld(): boolean {
  const [alt, setAlt] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setAlt(false);
    };
    const reset = () => setAlt(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return alt;
}

/**
 * Clearances (#50): thin dimension lines from the dragged item to the nearest wall
 * or furniture in its four axis directions, with the distance in cm. Shown while a
 * single item is dragged (`draggingId`), and while exactly one item is selected and
 * Alt is held.
 */
export function ClearanceOverlay({ project, derived, px, draggingId }: { project: Project; derived: DerivedPlan; px: number; draggingId?: string | null }) {
  const alt = useAltHeld();
  const selection = useUiStore((s) => s.selection);
  const multi = useUiStore((s) => s.multi);
  const id = draggingId ?? (alt && selection?.type === 'furniture' && multi.length === 0 ? selection.id : null);
  const items = useMemo(() => (id ? furnitureClearances(project, derived, id) : []), [project, derived, id]);
  if (items.length === 0) return null;
  // the rotate handle of the selected item must stay free (#125)
  const item = project.furniture.find((f) => f.id === id);
  const selected = !!item && ((selection?.type === 'furniture' && selection.id === item.id) || multi.includes(item.id));
  const handle = item && selected ? rotateHandlePoint(item, px) : null;
  return (
    <g pointerEvents="none" data-testid="clearances" data-furniture-id={id ?? undefined}>
      {items.map((c) => {
        const l = layoutClearance(c, px, handle);
        const tick = scale(perp(normalize(sub(c.to, c.from))), 4 * px);
        return (
          <g key={c.side} data-testid="clearance" data-side={c.side} data-distance-cm={Math.round(c.distance * 100)} data-hit={c.hit.type} data-label={l.beside ? 'beside' : 'on-line'} data-shifted={l.shifted ? 'true' : 'false'}>
            <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {[l.a, l.b].map((q, k) => (
              <line key={k} x1={q.x - tick.x} y1={q.y - tick.y} x2={q.x + tick.x} y2={q.y + tick.y} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* label on the line (beside it when the line is short), with a white halo so it stays readable on walls and furniture */}
            <text
              x={l.label.x}
              y={l.label.y}
              fontSize={11 * px}
              fontWeight={600}
              fill={TEXT}
              textAnchor={l.anchor}
              dominantBaseline="middle"
              paintOrder="stroke"
              stroke="#ffffff"
              strokeWidth={3 * px}
            >
              {clearanceLabel(c.distance)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
