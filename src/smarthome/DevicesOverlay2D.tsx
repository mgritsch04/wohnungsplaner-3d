import { useRef } from 'react';
import type { Project, SmartDevice } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { syncLight } from './actions';
import { sensorParams } from './simulation';
import { useSimStore } from './simStore';

const COLOR: Record<SmartDevice['kind'], string> = { motion: '#7c3aed', presence: '#9333ea', contact: '#0891b2', light: '#ca8a04', plug: '#475569' };
const LETTER: Record<SmartDevice['kind'], string> = { motion: 'B', presence: 'P', contact: 'K', light: 'L', plug: 'S' };
const r3 = (v: number) => Math.round(v * 1000) / 1000;

type Drag = { kind: 'move'; id: string; dx: number; dy: number } | { kind: 'rotate'; id: string } | { kind: 'person' };

/** Wedge path of a sensor's detection area (plan coordinates). */
export function wedgePath(d: SmartDevice, range: number, angleDeg: number): string {
  if (angleDeg >= 360) return `M ${d.x - range} ${d.y} a ${range} ${range} 0 1 0 ${2 * range} 0 a ${range} ${range} 0 1 0 ${-2 * range} 0 Z`;
  const half = (angleDeg * Math.PI) / 360;
  const a0 = d.rotation - half;
  const a1 = d.rotation + half;
  const p0 = { x: d.x + range * Math.cos(a0), y: d.y + range * Math.sin(a0) };
  const p1 = { x: d.x + range * Math.cos(a1), y: d.y + range * Math.sin(a1) };
  return `M ${d.x} ${d.y} L ${p0.x} ${p0.y} A ${range} ${range} 0 ${angleDeg > 180 ? 1 : 0} 1 ${p1.x} ${p1.y} Z`;
}

/**
 * Smart-home devices in the 2D plan (#170): symbol per device, detection wedge of the
 * sensors (lit while they detect), glow of simulated lamps and the simulated person.
 * Devices and the person can be dragged, a sensor's direction with its handle.
 */
export function DevicesOverlay2D({ project, px }: { project: Project; px: number }) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const { state, person, selectedDeviceId, select, setPerson } = useSimStore();
  if (!project.devices.length && !person) return null;

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
      select(d.id);
      st().beginTransaction();
    }
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = d && toWorld(e);
    if (!d || !w) return;
    e.stopPropagation();
    if (d.kind === 'person') return setPerson(w);
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
  const r = 9 * px;

  return (
    <g ref={ref} data-testid="smarthome-overlay">
      {project.devices.map((d) => {
        const on = state?.entities[d.id]?.on ?? false;
        const sel = d.id === selectedDeviceId;
        const sensor = d.kind === 'motion' || d.kind === 'presence';
        const params = sensor ? sensorParams(d) : null;
        const handle = { x: d.x + Math.cos(d.rotation) * 40 * px, y: d.y + Math.sin(d.rotation) * 40 * px };
        return (
          <g key={d.id} data-testid="device-2d" data-device={d.name} data-on={on}>
            {params && (
              <path
                d={wedgePath(d, params.rangeM, params.angleDeg)}
                fill={COLOR[d.kind]}
                fillOpacity={on ? 0.28 : sel ? 0.14 : 0.07}
                stroke={COLOR[d.kind]}
                strokeOpacity={0.5}
                strokeDasharray="4 3"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
            {d.kind === 'light' && on && <circle cx={d.x} cy={d.y} r={0.6} fill="#facc15" fillOpacity={0.35} pointerEvents="none" />}
            <g
              style={{ cursor: 'move' }}
              onPointerDown={(e) => {
                const w = toWorld(e);
                if (w) begin(e, { kind: 'move', id: d.id, dx: w.x - d.x, dy: w.y - d.y });
              }}
              {...handlers}
            >
              <circle cx={d.x} cy={d.y} r={r} fill={on ? COLOR[d.kind] : '#ffffff'} stroke={sel ? '#2563eb' : COLOR[d.kind]} strokeWidth={sel ? 3 : 2} vectorEffect="non-scaling-stroke" />
              <text x={d.x} y={d.y + 4 * px} fontSize={11 * px} fontWeight={700} textAnchor="middle" fill={on ? '#ffffff' : COLOR[d.kind]} pointerEvents="none">
                {LETTER[d.kind]}
              </text>
            </g>
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
    </g>
  );
}
