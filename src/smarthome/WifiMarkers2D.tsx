import { useEffect, useMemo, useRef, useState } from 'react';
import { derivePlan } from '../model/derived';
import type { Project, WifiClientType } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useSimStore } from './simStore';
import { BAND_LABEL } from './wifi';
import { addClient, updateNeighbor } from './wifiActions';
import { buildNet, checkClients, fmtMbps, linkChecks, wifiAt } from './wifiPlan';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const CATCH = 1e4;
const NEIGHBOR_COLOR = '#ea580c';
const LINK_COLOR = { good: '#16a34a', ok: '#ca8a04', weak: '#dc2626' } as const;

/** Simple 24×24 symbols of the own WLAN devices. */
export function ClientGlyph({ type }: { type: WifiClientType }) {
  switch (type) {
    case 'phone':
      return <><rect x="8" y="3" width="8" height="18" rx="1.5" /><path d="M11 18h2" /></>;
    case 'tablet':
      return <><rect x="5" y="3" width="14" height="18" rx="1.5" /><path d="M11 18h2" /></>;
    case 'laptop':
      return <><rect x="5" y="5" width="14" height="10" rx="1" /><path d="M3 19h18l-2-4H5z" /></>;
    case 'pc':
      return <><rect x="3" y="4" width="18" height="12" rx="1" /><path d="M12 16v4M8 20h8" /></>;
    case 'tv':
      return <><rect x="2" y="5" width="20" height="12" rx="1" /><path d="M8 21l4-4 4 4" /></>;
    case 'console':
      return <><path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.5H9A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z" /><path d="M7 11v3M5.5 12.5h3M16 12h.01M18 13.5h.01" /></>;
    case 'smart':
      return <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>;
    default:
      return <circle cx="12" cy="12" r="5" />;
  }
}

export function WifiGlyph() {
  return <><path d="M2 9a15 15 0 0 1 20 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M9 16a5 5 0 0 1 6 0" /><circle cx="12" cy="19" r="0.8" /></>;
}

type Drag = { kind: 'neighbor' | 'client' | 'measure'; id: string; moved: boolean; from: Vec2 };

/**
 * WLAN markers in the 2D plan (#492): neighbour networks (with measuring point), own devices (green =
 * enough, red = not enough), links of repeaters/mesh nodes to their uplink, suggested positions and the
 * value under the mouse. Neighbours and devices can be dragged; a click while placing puts one there.
 */
export function WifiMarkers2D({ project, px }: { project: Project; px: number }) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const on = useSimStore((s) => s.wifiOn);
  const placing = useSimStore((s) => s.wifiPlacing);
  const setPlacing = useSimStore((s) => s.setWifiPlacing);
  const suggest = useSimStore((s) => s.wifiSuggest);
  const [hover, setHover] = useState<Vec2 | null>(null);
  const net = useMemo(() => (on || placing ? buildNet(project, derivePlan(project)) : null), [on, placing, project]);
  const clients = useMemo(() => (net ? checkClients(net) : []), [net]);
  const links = useMemo(() => (net ? linkChecks(net) : []), [net]);

  useEffect(() => {
    if (!placing) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing, setPlacing]);

  // value under the mouse: listen on the plan without catching its clicks
  useEffect(() => {
    const svg = ref.current?.ownerSVGElement;
    if (!svg || !on) return;
    const move = (e: PointerEvent) => {
      const m = ref.current?.getScreenCTM();
      if (!m || drag.current) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      setHover({ x: p.x, y: p.y });
    };
    const leave = () => setHover(null);
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerleave', leave);
    return () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerleave', leave);
    };
  }, [on]);

  const hoverInfo = useMemo(() => {
    if (!net || !hover || !net.aps.length || !net.cells) return null;
    const c = net.cells;
    const i = Math.floor((hover.x - c.minX) / c.cell);
    const j = Math.floor((hover.y - c.minY) / c.cell);
    if (i < 0 || j < 0 || i >= c.cols || j >= c.rows || !c.room[j * c.cols + i]) return null;
    const w = wifiAt(net, hover);
    const ap = net.aps.find((a) => a.id === w.apId);
    return { at: hover, text: ap && w.band ? `${Math.round(w.dbm)} dBm · ca. ${fmtMbps(w.mbps)} · ${ap.name} (${BAND_LABEL[w.band]})${w.busy > 0.05 ? ` · Nachbarn belegen ${Math.round(w.busy * 100)} %` : ''}` : `kein Empfang (${Math.round(w.dbm)} dBm)` };
  }, [net, hover]);

  if (!on && !placing) return null;

  const toWorld = (e: React.PointerEvent): Vec2 | null => {
    const m = ref.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const st = () => useProjectStore.getState();
  const begin = (e: React.PointerEvent, kind: Drag['kind'], id: string) => {
    if (e.button !== 0) return;
    const w = toWorld(e);
    if (!w) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { kind, id, moved: false, from: w };
    st().beginTransaction();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = d && toWorld(e);
    if (!d || !w) return;
    e.stopPropagation();
    if (!d.moved && Math.hypot(w.x - d.from.x, w.y - d.from.y) < 4 * px) return;
    d.moved = true;
    st().updateTransient((p) => {
      if (d.kind === 'client') {
        const c = p.wifiClients.find((x) => x.id === d.id);
        if (c) Object.assign(c, { x: r3(w.x), y: r3(w.y) });
      } else {
        const n = p.wifiNeighbors.find((x) => x.id === d.id);
        if (n && d.kind === 'neighbor') Object.assign(n, { x: r3(w.x), y: r3(w.y) });
        if (n && d.kind === 'measure') n.measuredAt = { x: r3(w.x), y: r3(w.y) };
      }
    });
  };
  const end = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    drag.current = null;
    if (d.moved) st().commitTransaction();
    else st().cancelTransaction();
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };
  const place = (e: React.PointerEvent) => {
    if (!placing || e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e);
    if (!w) return;
    if (placing.type === 'client') addClient(placing.clientType, w);
    else if (placing.type === 'neighbor') updateNeighbor(placing.id, { x: r3(w.x), y: r3(w.y) });
    else updateNeighbor(placing.id, { measuredAt: { x: r3(w.x), y: r3(w.y) } });
    setPlacing(null);
  };
  const r = 10 * px;
  const s = (1.2 * r) / 24;
  const label = (x: number, y: number, text: string, color = '#334155', testId?: string) => (
    <text x={x} y={y} fontSize={10.5 * px} fontWeight={600} textAnchor="middle" fill={color} stroke="#ffffff" strokeWidth={3 * px} paintOrder="stroke" pointerEvents="none" data-testid={testId}>
      {text}
    </text>
  );
  const apById = (id: string) => net?.aps.find((a) => a.id === id);

  return (
    <g ref={ref} data-testid="wifi-markers">
      {links.map((l) => {
        const a = apById(l.apId);
        const u = a && apById(net!.links.get(a.id)!.uplinkId);
        if (!a || !u) return null;
        return (
          <g key={l.apId} pointerEvents="none" data-testid="wifi-link" data-quality={l.quality}>
            <line x1={u.x} y1={u.y} x2={a.x} y2={a.y} stroke={LINK_COLOR[l.quality]} strokeWidth={2.5} strokeDasharray="6 4" vectorEffect="non-scaling-stroke" />
            {label((a.x + u.x) / 2, (a.y + u.y) / 2 - 6 * px, `${Math.round(l.dbm)} dBm · ${fmtMbps(l.mbps)}`, LINK_COLOR[l.quality])}
          </g>
        );
      })}
      {project.wifiNeighbors.map((n) => (
        <g key={n.id} data-testid="wifi-neighbor-2d" data-name={n.name}>
          {n.measuredAt && (
            <g>
              <line x1={n.x} y1={n.y} x2={n.measuredAt.x} y2={n.measuredAt.y} stroke={NEIGHBOR_COLOR} strokeOpacity={0.5} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />
              <g style={{ cursor: 'grab' }} onPointerDown={(e) => begin(e, 'measure', n.id)} {...handlers} data-testid="wifi-measure-2d">
                <circle cx={n.measuredAt.x} cy={n.measuredAt.y} r={5 * px} fill="#ffffff" stroke={NEIGHBOR_COLOR} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <path d={`M${n.measuredAt.x - 7 * px} ${n.measuredAt.y}h${14 * px}M${n.measuredAt.x} ${n.measuredAt.y - 7 * px}v${14 * px}`} stroke={NEIGHBOR_COLOR} strokeWidth={1} vectorEffect="non-scaling-stroke" />
                <title>Messpunkt {n.name}</title>
              </g>
              {n.measuredDbm !== undefined && label(n.measuredAt.x, n.measuredAt.y + 16 * px, `${n.measuredDbm} dBm gemessen`, NEIGHBOR_COLOR)}
            </g>
          )}
          <g style={{ cursor: 'grab' }} onPointerDown={(e) => begin(e, 'neighbor', n.id)} {...handlers}>
            <rect x={n.x - r} y={n.y - r} width={2 * r} height={2 * r} rx={3 * px} fill="#fff7ed" stroke={NEIGHBOR_COLOR} strokeWidth={2} strokeDasharray="4 2" vectorEffect="non-scaling-stroke" />
            <g transform={`translate(${n.x - 12 * s} ${n.y - 12 * s}) scale(${s})`} fill="none" stroke={NEIGHBOR_COLOR} strokeWidth={2.2} strokeLinecap="round" pointerEvents="none">
              <WifiGlyph />
            </g>
            <title>{`Nachbar-WLAN ${n.name}`}</title>
          </g>
          {label(n.x, n.y + r + 11 * px, `${n.name} · ${BAND_LABEL[n.band]} K${n.channel}${n.floor !== 'same' ? (n.floor === 'above' ? ' · oben' : ' · unten') : ''}`, NEIGHBOR_COLOR)}
        </g>
      ))}
      {clients.map((c) => {
        const color = c.ok ? '#16a34a' : '#dc2626';
        const draggable = c.own;
        return (
          <g key={c.id} data-testid="wifi-client-2d" data-name={c.name} data-ok={c.ok} data-mbps={c.mbps.toFixed(1)}>
            {!draggable ? (
              <circle cx={c.x} cy={c.y} r={r + 3 * px} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ) : (
              <g style={{ cursor: 'grab' }} onPointerDown={(e) => begin(e, 'client', c.id)} {...handlers}>
                <circle cx={c.x} cy={c.y} r={r} fill="#ffffff" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <g transform={`translate(${c.x - 12 * s} ${c.y - 12 * s}) scale(${s})`} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
                  <ClientGlyph type={c.type} />
                </g>
                <title>{`${c.name}: ${c.advice}`}</title>
              </g>
            )}
            {label(c.x, c.y + r + (draggable ? 11 : 14) * px, `${draggable ? `${c.name} · ` : ''}${fmtMbps(c.mbps)}${c.ok ? ' ✓' : ' ✗'}`, color)}
          </g>
        );
      })}
      {suggest?.map((g, i) => (
        <g key={i} pointerEvents="none" data-testid="wifi-suggest-2d">
          <circle cx={g.x} cy={g.y} r={r * 1.6} fill="#0d9488" fillOpacity={0.12} stroke="#0d9488" strokeWidth={2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke">
            <animate attributeName="r" values={`${r * 1.4};${r * 1.9};${r * 1.4}`} dur="1.6s" repeatCount="indefinite" />
          </circle>
          <path d={`M${g.x - r * 0.6} ${g.y}h${r * 1.2}M${g.x} ${g.y - r * 0.6}v${r * 1.2}`} stroke="#0d9488" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
          {label(g.x, g.y - r * 2 - 4 * px, `Vorschlag ${i + 1}: ${g.role === 'repeater' ? 'Repeater' : g.role === 'ap' ? 'Access Point' : 'Mesh-Knoten'}`, '#0f766e')}
        </g>
      ))}
      {hoverInfo && !placing && (
        <g pointerEvents="none" data-testid="wifi-hover">
          <circle cx={hoverInfo.at.x} cy={hoverInfo.at.y} r={2.5 * px} fill="#0f172a" />
          <text x={hoverInfo.at.x + 10 * px} y={hoverInfo.at.y - 10 * px} fontSize={11 * px} fontWeight={600} fill="#0f172a" stroke="#ffffff" strokeWidth={3.5 * px} paintOrder="stroke">
            {hoverInfo.text}
          </text>
        </g>
      )}
      {placing && (
        <rect x={-CATCH} y={-CATCH} width={2 * CATCH} height={2 * CATCH} fill="transparent" style={{ cursor: 'crosshair' }} onPointerDown={place} data-testid="wifi-placing" />
      )}
    </g>
  );
}
