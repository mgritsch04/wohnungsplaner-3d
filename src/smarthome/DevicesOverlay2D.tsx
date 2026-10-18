import { useEffect, useMemo, useRef, useState } from 'react';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { placeDevice, roomAt, syncLight } from './actions';
import { deviceOn } from './DeviceInfo';
import { GlyphPaths, KIND_COLOR } from './glyphs';
import { detectionPolygon, occludersOf, sensorParams } from './simulation';
import { useSelectedDeviceId, useSimStore } from './simStore';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** big enough to catch every click of the plan while placing */
const CATCH = 1e4;

type Drag = { kind: 'move'; id: string; dx: number; dy: number; moved: boolean } | { kind: 'rotate'; id: string } | { kind: 'person' };

/**
 * Smart-home devices in the 2D plan (#170, #233): symbol and name per device, status colour,
 * detection area of the sensors (lit while they detect), glow of simulated lamps and the
 * simulated person. A click selects a device (info and actions under „Eigenschaften“),
 * dragging moves it, the blue handle turns a sensor. While a device waits to be placed,
 * a click into the plan puts it there (Esc cancels).
 */
export function DevicesOverlay2D({ project, px }: { project: Project; px: number }) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const { state, person, placing, flash, setPerson, setPlacing } = useSimStore();
  const selectedId = useSelectedDeviceId();
  const tabOpen = useUiStore((s) => s.leftTab === 'smarthome');
  const [hoverAt, setHoverAt] = useState<Vec2 | null>(null);
  const occluders = useMemo(() => (project.devices.length ? occludersOf(project, derivePlan(project)) : []), [project]);

  useEffect(() => {
    if (!placing) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing, setPlacing]);

  if (!project.devices.length && !person && !placing) return null;

  const toWorld = (e: React.PointerEvent): Vec2 | null => {
    const m = ref.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const st = () => useProjectStore.getState();
  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = d;
    if (d.kind !== 'person') {
      useUiStore.getState().setSelection({ type: 'device', id: d.id });
      st().beginTransaction();
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = d && toWorld(e);
    if (!d || !w) return;
    e.stopPropagation();
    if (d.kind === 'person') return setPerson(w);
    if (d.kind === 'move' && !d.moved) {
      // a click without movement only selects (and adds no undo step)
      const dev = st().project.devices.find((x) => x.id === d.id);
      if (!dev || Math.hypot(w.x - d.dx - dev.x, w.y - d.dy - dev.y) < 4 * px) return;
      d.moved = true;
    }
    st().updateTransient((p) => {
      const dev = p.devices.find((x) => x.id === d.id);
      if (!dev) return;
      if (d.kind === 'move') {
        dev.x = r3(w.x - d.dx);
        dev.y = r3(w.y - d.dy);
        syncLight(p, dev);
      } else dev.rotation = Math.atan2(w.y - dev.y, w.x - dev.x);
    });
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    drag.current = null;
    if (d.kind !== 'person') st().commitTransaction();
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const place = (e: React.PointerEvent) => {
    if (!placing || e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e);
    if (!w) return;
    const p = st().project;
    placeDevice(placing.kind, placing.productId, roomAt(p, derivePlan(p), w), w);
    setPlacing(null);
    setHoverAt(null);
  };
  const r = 11 * px;

  return (
    <g ref={ref} data-testid="smarthome-overlay">
      {project.devices.map((d) => {
        const { on } = deviceOn(project, d, state?.entities);
        const sel = d.id === selectedId;
        const color = KIND_COLOR[d.kind];
        const sensor = d.kind === 'motion' || d.kind === 'presence';
        const params = sensor ? sensorParams(d) : null;
        const handle = { x: d.x + Math.cos(d.rotation) * 44 * px, y: d.y + Math.sin(d.rotation) * 44 * px };
        const s = (1.3 * r) / 24;
        return (
          <g key={d.id} data-testid="device-2d" data-device={d.name} data-device-id={d.id} data-on={on} data-selected={sel}>
            {params && (
              <path
                d={`M ${detectionPolygon(d, params, occluders).map((p) => `${p.x} ${p.y}`).join(' L ')} Z`}
                fill={color}
                fillOpacity={on ? 0.28 : sel ? 0.16 : tabOpen ? 0.08 : 0.04}
                stroke={color}
                strokeOpacity={sel ? 0.8 : 0.45}
                strokeDasharray="4 3"
                strokeWidth={sel ? 1.5 : 1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {d.kind === 'light' && on && <circle cx={d.x} cy={d.y} r={0.6} fill="#facc15" fillOpacity={0.35} pointerEvents="none" />}
            {flash?.id === d.id && (
              <circle key={flash.at} cx={d.x} cy={d.y} r={r} fill="none" stroke={color} strokeWidth={3} vectorEffect="non-scaling-stroke" pointerEvents="none" data-testid="device-flash">
                <animate attributeName="r" values={`${r};${r * 3.2}`} dur="0.8s" repeatCount={3} />
                <animate attributeName="stroke-opacity" values="0.9;0" dur="0.8s" repeatCount={3} />
              </circle>
            )}
            <g
              style={{ cursor: 'pointer' }}
              onPointerDown={(e) => {
                const w = toWorld(e);
                if (w) begin(e, { kind: 'move', id: d.id, dx: w.x - d.x, dy: w.y - d.y, moved: false });
              }}
              {...handlers}
              data-testid="device-hit"
            >
              {sel && <circle cx={d.x} cy={d.y} r={r + 4 * px} fill="none" stroke="#2563eb" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
              <circle cx={d.x} cy={d.y} r={r} fill={on ? color : '#ffffff'} stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
              <g transform={`translate(${d.x - 12 * s} ${d.y - 12 * s}) scale(${s})`} fill="none" stroke={on ? '#ffffff' : color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
                <GlyphPaths kind={d.kind} />
              </g>
              <title>{d.name}</title>
            </g>
            {(tabOpen || sel) && (
              <text
                x={d.x}
                y={d.y + r + 12 * px}
                fontSize={11 * px}
                fontWeight={sel ? 700 : 500}
                textAnchor="middle"
                fill={sel ? '#1d4ed8' : '#334155'}
                stroke="#ffffff"
                strokeWidth={3 * px}
                paintOrder="stroke"
                pointerEvents="none"
              >
                {d.name}
              </text>
            )}
            {sensor && sel && (
              <circle cx={handle.x} cy={handle.y} r={6 * px} fill="#2563eb" style={{ cursor: 'grab' }} onPointerDown={(e) => begin(e, { kind: 'rotate', id: d.id })} {...handlers} data-testid="device-rotate" />
            )}
          </g>
        );
      })}
      {person && (
        <g style={{ cursor: 'grab' }} onPointerDown={(e) => begin(e, { kind: 'person' })} {...handlers} data-testid="sim-person-2d">
          <circle cx={person.x} cy={person.y} r={0.25} fill="#f97316" fillOpacity={0.25} stroke="#f97316" strokeWidth={2} vectorEffect="non-scaling-stroke" />
          <circle cx={person.x} cy={person.y - 0.08} r={0.07} fill="#f97316" />
          <path d={`M ${person.x - 0.1} ${person.y + 0.14} Q ${person.x} ${person.y - 0.02} ${person.x + 0.1} ${person.y + 0.14} Z`} fill="#f97316" />
        </g>
      )}
      {placing && (
        <g data-testid="device-placing">
          <rect
            x={-CATCH}
            y={-CATCH}
            width={2 * CATCH}
            height={2 * CATCH}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onPointerDown={place}
            onPointerMove={(e) => setHoverAt(toWorld(e))}
            onPointerLeave={() => setHoverAt(null)}
          />
          {hoverAt && (
            <g pointerEvents="none" opacity={0.7}>
              <circle cx={hoverAt.x} cy={hoverAt.y} r={r} fill="#ffffff" stroke={KIND_COLOR[placing.kind]} strokeWidth={2} strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
              <g transform={`translate(${hoverAt.x - (12 * 1.3 * r) / 24} ${hoverAt.y - (12 * 1.3 * r) / 24}) scale(${(1.3 * r) / 24})`} fill="none" stroke={KIND_COLOR[placing.kind]} strokeWidth={2.2} strokeLinecap="round">
                <GlyphPaths kind={placing.kind} />
              </g>
            </g>
          )}
        </g>
      )}
    </g>
  );
}
