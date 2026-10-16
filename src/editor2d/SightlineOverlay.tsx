import { useEffect, useMemo, useRef } from 'react';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { defaultViewpoint, sightFrom } from '../model/visibility';
import { useSightStore } from './sightStore';

// plan tokens (theme.css) – identical in light and dark, the SVG plan stays light
const VISIBLE = 'var(--color-plan-visible)';
const HIDDEN = 'var(--color-plan-hidden)';
const POINT = 'var(--color-plan-viewpoint)';
const HALO = 'var(--color-plan-halo)';

const pts = (poly: { x: number; y: number }[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Sight lines (#89): visible part of the flat from a draggable viewpoint (green),
 * hidden part grey. Walls hide, open doors and passages do not, furniture does not.
 */
export function SightlineOverlay({ project, derived, px }: { project: Project; derived: DerivedPlan; px: number }) {
  const { show, point, setPoint, setShare } = useSightStore();
  const p = useMemo(() => (show ? (point ?? defaultViewpoint(project, derived)) : null), [show, point, project, derived]);
  const sight = useMemo(() => (p ? sightFrom(project, derived, p) : null), [p, project, derived]);
  useEffect(() => setShare(sight ? sight.share : null), [sight, setShare]);
  const dragging = useRef(false);
  if (!p || !sight) return null;
  const rooms = [...derived.rooms.values()].filter((g) => g.interior.length >= 3);

  /** Screen → plan coordinates via the transform of the world group the marker sits in. */
  const toWorld = (el: SVGGraphicsElement, clientX: number, clientY: number) => {
    const m = (el.parentNode as SVGGraphicsElement).getScreenCTM();
    if (!m) return null;
    const q = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: Math.round(q.x * 1000) / 1000, y: Math.round(q.y * 1000) / 1000 };
  };

  return (
    <g data-testid="sightlines" data-share={sight.share.toFixed(3)} pointerEvents="none">
      <defs>
        <clipPath id="sight-rooms">
          {rooms.map((g) => (
            <polygon key={g.roomId} points={pts(g.interior)} />
          ))}
        </clipPath>
      </defs>
      <g clipPath="url(#sight-rooms)">
        {rooms.map((g) => (
          <polygon key={g.roomId} points={pts(g.interior)} style={{ fill: HIDDEN }} fillOpacity={0.28} />
        ))}
        <polygon points={pts(sight.polygon)} style={{ fill: VISIBLE }} fillOpacity={0.3} data-testid="sight-visible" />
      </g>
      <polygon points={pts(sight.polygon)} fill="none" style={{ stroke: VISIBLE }} strokeWidth={1} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" clipPath="url(#sight-rooms)" />
      <g data-testid="sight-viewpoint" data-x={p.x.toFixed(3)} data-y={p.y.toFixed(3)}>
        <circle
          cx={p.x}
          cy={p.y}
          r={9 * px}
          style={{ fill: POINT, stroke: HALO, cursor: 'grab' }}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="all"
          onPointerDown={(e) => {
            // the marker owns this gesture – the editor below must not select or pan
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = true;
          }}
          onPointerMove={(e) => {
            if (!dragging.current) return;
            e.stopPropagation();
            const w = toWorld(e.currentTarget.parentNode as SVGGraphicsElement, e.clientX, e.clientY);
            if (w) setPoint(w);
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            dragging.current = false;
          }}
        />
        <circle cx={p.x} cy={p.y} r={3 * px} style={{ fill: HALO }} />
      </g>
      <text
        x={p.x}
        y={p.y - 16 * px}
        fontSize={11 * px}
        fontWeight={700}
        textAnchor="middle"
        paintOrder="stroke"
        strokeWidth={3 * px}
        style={{ fill: POINT, stroke: HALO }}
        data-testid="sight-share"
      >
        sichtbar {Math.round(sight.share * 100)} %
      </text>
    </g>
  );
}
