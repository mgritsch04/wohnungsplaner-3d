import { useEffect, useMemo, useState } from 'react';
import { clearanceLabel, layoutClearance, rotateHandlePoint, selectionClearances } from '../model/clearances';
import type { DerivedPlan } from '../model/derived';
import { groupBounds, selectedGroup } from '../model/groups';
import type { Project } from '../model/schema';
import { normalize, perp, scale, sub } from '../model/vec';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import { groupHandlePoint } from './GroupOverlay';

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
 * or furniture in its four axis directions, with the distance in cm. Shown while
 * dragging (`draggingIds`), and while furniture is selected and Alt is held. A
 * multi-selection or group (#94) is measured as a whole from its shared outline to walls
 * and to the furniture that is not selected.
 */
export function ClearanceOverlay({ project, derived, px, draggingIds }: { project: Project; derived: DerivedPlan; px: number; draggingIds?: string[] | null }) {
  const alt = useAltHeld();
  const selection = useUiStore((s) => s.selection);
  const multi = useUiStore((s) => s.multi);
  const selected = useMemo(() => selectedFurnitureIds({ selection, multi }), [selection, multi]);
  const ids = draggingIds?.length ? draggingIds : alt && selected.length ? selected : null;
  // keyed by the id list: dragging passes a new array on every move
  const idsKey = ids ? ids.join(',') : '';
  const items = useMemo(() => (idsKey ? selectionClearances(project, derived, idsKey.split(',')) : []), [project, derived, idsKey]);
  if (!ids || items.length === 0) return null;
  // the rotate handle of the selected item – or of the selected group – must stay free (#125)
  const handle = (() => {
    if (ids.length === 1) {
      const item = project.furniture.find((f) => f.id === ids[0]);
      return item && selected.includes(item.id) ? rotateHandlePoint(item, px) : null;
    }
    if (!selectedGroup(project, selected) || !ids.every((id) => selected.includes(id))) return null;
    const b = groupBounds(project.furniture.filter((f) => ids.includes(f.id)));
    return b ? groupHandlePoint(b, px) : null;
  })();
  return (
    <g pointerEvents="none" data-testid="clearances" data-furniture-id={ids.length === 1 ? ids[0] : undefined} data-furniture-ids={ids.join(' ')}>
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
