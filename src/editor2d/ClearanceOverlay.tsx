import { useEffect, useMemo, useState } from 'react';
import { clearanceLabel, furnitureClearances } from '../model/clearances';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { add, normalize, perp, scale, sub } from '../model/vec';
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
  return (
    <g pointerEvents="none" data-testid="clearances" data-furniture-id={id ?? undefined}>
      {items.map((c) => {
        const tick = scale(perp(normalize(sub(c.to, c.from))), 4 * px);
        const mid = scale(add(c.from, c.to), 0.5);
        return (
          <g key={c.side} data-testid="clearance" data-side={c.side} data-distance-cm={Math.round(c.distance * 100)} data-hit={c.hit.type}>
            <line x1={c.from.x} y1={c.from.y} x2={c.to.x} y2={c.to.y} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            {[c.from, c.to].map((q, k) => (
              <line key={k} x1={q.x - tick.x} y1={q.y - tick.y} x2={q.x + tick.x} y2={q.y + tick.y} stroke={LINE} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {/* label on the line, with a white halo so it stays readable on walls and furniture */}
            <text
              x={mid.x}
              y={mid.y}
              fontSize={11 * px}
              fontWeight={600}
              fill={TEXT}
              textAnchor="middle"
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
