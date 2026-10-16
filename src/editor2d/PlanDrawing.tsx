import { memo } from 'react';
import type { DerivedPlan } from '../model/derived';
import { clipFootprint } from '../model/geometry/walls';
import type { Furniture, Project } from '../model/schema';
import { add, dist, normalize, perp, scale, sub, type Vec2 } from '../model/vec';
import { formatArea, formatLength, radToDeg } from '../model/units';
import type { Selection } from '../store/uiStore';
import { doorSymbol, openingRect } from './openingSymbols';
import { materialById, DEFAULT_FLOOR_MATERIAL_ID } from '../model/materials';

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

interface Props {
  project: Project;
  derived: DerivedPlan;
  selection: Selection | null;
  hover: Selection | null;
  /** further selected furniture (multi-select) */
  multi?: string[];
  zoom: number;
  showDimensions: boolean;
  /** Furniture placement problems: 'error' (in wall/door leaf) or 'warn' (door swing, overlap). */
  conflicts?: Map<string, 'error' | 'warn'>;
  /**
   * Item that shows the rotation handle (the one the editor reacts to); null = none (e.g. a
   * furniture group has its own handle, #65). Default: every selected item.
   */
  rotateHandleFor?: string | null;
}

const isSel = (s: Selection | null, type: Selection['type'], id: string) => s?.type === type && s.id === id;

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export const PlanDrawing = memo(function PlanDrawing({ project, derived, selection, multi = [], hover, zoom, showDimensions, conflicts, rotateHandleFor }: Props) {
  const px = 1 / zoom; // one screen pixel in meters
  const fontSize = 12 * px;

  const rooms = project.rooms.map((r) => {
    const g = derived.rooms.get(r.id);
    if (!g) return null;
    const mat = materialById(project.materials, r.floorMaterialId, DEFAULT_FLOOR_MATERIAL_ID);
    const selected = isSel(selection, 'room', r.id);
    const hovered = isSel(hover, 'room', r.id);
    return (
      <polygon
        key={r.id}
        points={pts(g.interior)}
        fill={selected ? '#dbeafe' : lighten(mat.color, 0.72)}
        stroke={selected ? '#2563eb' : hovered ? '#60a5fa' : 'none'}
        strokeWidth={selected ? 2 : 1.5}
        vectorEffect="non-scaling-stroke"
      />
    );
  });

  const walls = project.walls.map((w) => {
    const fp = derived.footprints.get(w.id);
    if (!fp) return null;
    const ops = derived.openings.get(w.id) ?? [];
    const selected = isSel(selection, 'wall', w.id);
    const hovered = isSel(hover, 'wall', w.id);
    const fill = selected ? '#2563eb' : hovered ? '#475569' : '#2f3437';
    const segments: Vec2[][] = [];
    let cursor = -Infinity;
    for (const o of ops) {
      segments.push(clipFootprint(fp, cursor, o.s0));
      cursor = o.s1;
    }
    segments.push(clipFootprint(fp, cursor, Infinity));
    return (
      <g key={w.id}>
        {segments.filter((s) => s.length >= 3).map((s, i) => (
          <polygon key={i} points={pts(s)} fill={fill} stroke={fill} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    );
  });

  const hubs = derived.hubs.map((h) => <polygon key={h.nodeId} points={pts(h.polygon)} fill="#2f3437" stroke="#2f3437" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);

  const openings = project.walls.flatMap((w) => {
    const fp = derived.footprints.get(w.id);
    if (!fp) return [];
    return (derived.openings.get(w.id) ?? []).map((r) => {
      const o = r.opening;
      const selected = isSel(selection, 'opening', o.id);
      const hovered = isSel(hover, 'opening', o.id);
      const stroke = selected ? '#2563eb' : hovered ? '#475569' : '#1f2937';
      const rect = openingRect(fp, r);
      if (o.kind === 'window') {
        const mid0 = add(fp.a, scale(fp.dir, r.s0));
        const mid1 = add(fp.a, scale(fp.dir, r.s1));
        const off = scale(fp.normal, fp.thickness / 6);
        return (
          <g key={o.id}>
            <polygon points={pts(rect)} fill={selected ? '#dbeafe' : '#ffffff'} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={mid0.x + off.x} y1={mid0.y + off.y} x2={mid1.x + off.x} y2={mid1.y + off.y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={mid0.x - off.x} y1={mid0.y - off.y} x2={mid1.x - off.x} y2={mid1.y - off.y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        );
      }
      if (o.kind === 'door') {
        const ds = doorSymbol(fp, r);
        return (
          <g key={o.id}>
            <polygon points={pts(rect)} fill={selected ? '#dbeafe' : '#ffffff'} stroke="none" />
            <line x1={ds.hinge.x} y1={ds.hinge.y} x2={ds.openTip.x} y2={ds.openTip.y} stroke={stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
            <path
              d={`M ${ds.closedTip.x} ${ds.closedTip.y} A ${ds.radius} ${ds.radius} 0 0 ${ds.sweep} ${ds.openTip.x} ${ds.openTip.y}`}
              fill="none"
              stroke={stroke}
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      }
      return (
        <g key={o.id}>
          <polygon points={pts(rect)} fill={selected ? '#dbeafe' : '#ffffff'} stroke="none" />
          <line x1={rect[0].x} y1={rect[0].y} x2={rect[3].x} y2={rect[3].y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={rect[1].x} y1={rect[1].y} x2={rect[2].x} y2={rect[2].y} stroke={stroke} strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </g>
      );
    });
  });

  // floor-level items first, wall-mounted / elevated items last
  const furniture = [...project.furniture].sort((a, b) => a.elevation + a.height * 0.001 - (b.elevation + b.height * 0.001));

  return (
    <g>
      <g>{rooms}</g>
      <g>{walls}</g>
      <g>{hubs}</g>
      <g>{openings}</g>
      <g>
        {furniture.map((f) => (
          <FurnitureSymbol
            key={f.id}
            f={f}
            selected={isSel(selection, 'furniture', f.id) || multi.includes(f.id)}
            handle={rotateHandleFor === undefined ? isSel(selection, 'furniture', f.id) || multi.includes(f.id) : rotateHandleFor === f.id}
            hovered={isSel(hover, 'furniture', f.id)}
            px={px}
            conflict={conflicts?.get(f.id)}
          />
        ))}
      </g>
      <g>
        {project.lights.map((l) => (
          <g key={l.id}>
            <circle cx={l.x} cy={l.y} r={0.12} fill={l.on ? '#fde68a' : '#e5e7eb'} stroke={isSel(selection, 'light', l.id) ? '#2563eb' : '#a16207'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <line x1={l.x - 0.08} y1={l.y - 0.08} x2={l.x + 0.08} y2={l.y + 0.08} stroke="#a16207" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <line x1={l.x - 0.08} y1={l.y + 0.08} x2={l.x + 0.08} y2={l.y - 0.08} stroke="#a16207" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </g>
      {showDimensions && <RoomDimensions project={project} derived={derived} px={px} fontSize={fontSize} />}
      <g>
        {project.rooms.map((r) => {
          const g = derived.rooms.get(r.id);
          if (!g) return null;
          return (
            <g key={r.id} pointerEvents="none">
              <text x={g.centroid.x} y={g.centroid.y - fontSize * 0.2} fontSize={fontSize * 1.15} textAnchor="middle" fill="#111827" fontWeight={600}>
                {r.name}
              </text>
              <text x={g.centroid.x} y={g.centroid.y + fontSize * 1.1} fontSize={fontSize} textAnchor="middle" fill="#4b5563">
                {formatArea(g.area)}
              </text>
            </g>
          );
        })}
      </g>
    </g>
  );
});

/** Clear interior dimensions along each room edge (drawn inside the room). */
function RoomDimensions({ project, derived, px, fontSize }: { project: Project; derived: DerivedPlan; px: number; fontSize: number }) {
  const items: React.ReactNode[] = [];
  for (const r of project.rooms) {
    const g = derived.rooms.get(r.id);
    if (!g) continue;
    const poly = g.interior;
    const sign = signedAreaSign(poly);
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const L = dist(a, b);
      if (L < 0.3 || L * (1 / px) < 40) continue;
      const d = normalize(sub(b, a));
      const inward = scale(perp(d), sign);
      const off = scale(inward, 14 * px);
      const a2 = add(a, off);
      const b2 = add(b, off);
      const mid = add(scale(add(a2, b2), 0.5), scale(inward, 2 * px));
      let ang = radToDeg(Math.atan2(d.y, d.x));
      if (ang > 90) ang -= 180;
      if (ang < -90) ang += 180;
      items.push(
        <g key={`${r.id}-${i}`} pointerEvents="none">
          <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} stroke="#64748b" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          <line x1={a2.x - inward.x * 4 * px} y1={a2.y - inward.y * 4 * px} x2={a2.x + inward.x * 4 * px} y2={a2.y + inward.y * 4 * px} stroke="#64748b" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          <line x1={b2.x - inward.x * 4 * px} y1={b2.y - inward.y * 4 * px} x2={b2.x + inward.x * 4 * px} y2={b2.y + inward.y * 4 * px} stroke="#64748b" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
          <text
            x={mid.x}
            y={mid.y}
            fontSize={fontSize * 0.9}
            fill="#334155"
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${ang} ${mid.x} ${mid.y})`}
            paintOrder="stroke"
            stroke="#ffffff"
            strokeWidth={3 * px}
          >
            {formatLength(L)}
          </text>
        </g>,
      );
    }
  }
  return <g>{items}</g>;
}

function signedAreaSign(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a >= 0 ? 1 : -1;
}

/** Simple top-view symbol for a furniture item; detail depends on the procedural shape. */
const FurnitureSymbol = memo(function FurnitureSymbol({
  f,
  selected,
  handle,
  hovered,
  px,
  conflict,
}: {
  f: Furniture;
  selected: boolean;
  /** Draw the rotation handle above the item. */
  handle: boolean;
  hovered: boolean;
  px: number;
  conflict?: 'error' | 'warn';
}) {
  const shape = f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape;
  const w = f.width;
  const d = f.depth;
  // a conflict stays visible while the item is selected/dragged (selection = thicker outline)
  const stroke = conflict === 'error' ? '#dc2626' : conflict === 'warn' ? '#d97706' : selected ? '#2563eb' : hovered ? '#1d4ed8' : '#4b5563';
  const fill = shape === 'rug' ? lighten(f.color, 0.3) : lighten(f.color, 0.55);
  const sw = selected ? 2 : 1;
  const details: React.ReactNode[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, k: string) => (
    <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
  );
  const rect = (x: number, y: number, rw: number, rh: number, k: string, rx = 0) => (
    <rect key={k} x={x} y={y} width={rw} height={rh} rx={rx} fill="none" stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
  );
  switch (shape) {
    case 'sofa':
    case 'armchair':
      details.push(rect(-w / 2, -d / 2, w, d * 0.25, 'back'));
      details.push(rect(-w / 2, -d / 2, w * 0.1, d, 'arm1'));
      details.push(rect(w / 2 - w * 0.1, -d / 2, w * 0.1, d, 'arm2'));
      break;
    case 'sofa-corner':
      details.push(rect(-w / 2, -d / 2, w, d * 0.18, 'back'));
      details.push(rect(w / 2 - w * 0.12, -d / 2, w * 0.12, d, 'back2'));
      break;
    case 'bed':
      details.push(rect(-w / 2 + 0.05, -d / 2 + 0.06, w / 2 - 0.08, 0.3, 'p1', 0.05));
      details.push(rect(0.03, -d / 2 + 0.06, w / 2 - 0.08, 0.3, 'p2', 0.05));
      details.push(line(-w / 2, -d / 2 + 0.45, w / 2, -d / 2 + 0.45, 'blanket'));
      break;
    case 'wardrobe':
      details.push(line(-w / 2, -d / 2, w / 2, d / 2, 'x1'));
      details.push(line(-w / 2, d / 2, w / 2, -d / 2, 'x2'));
      break;
    case 'table-round':
      return (
        <g transform={`translate(${f.x} ${f.y}) rotate(${radToDeg(f.rotation)})`}>
          <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'plant':
    case 'floor-lamp':
    case 'table-lamp':
    case 'pendant':
      return (
        <g transform={`translate(${f.x} ${f.y}) rotate(${radToDeg(f.rotation)})`}>
          <circle cx={0} cy={0} r={Math.min(w, d) / 2} fill={fill} stroke={stroke} strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeDasharray={shape === 'pendant' ? '3 2' : undefined} />
        </g>
      );
    case 'k-sink':
    case 'washbasin':
      details.push(rect(-w * 0.3, -d * 0.25, w * 0.6, d * 0.55, 'basin', 0.04));
      break;
    case 'k-cooktop':
      for (const [cx, cy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]])
        details.push(<circle key={`${cx}${cy}`} cx={(cx * w) / 1} cy={(cy * d) / 1} r={Math.min(w, d) * 0.16} fill="none" stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />);
      break;
    case 'bathtub':
      details.push(rect(-w / 2 + 0.06, -d / 2 + 0.06, w - 0.12, d - 0.12, 'tub', 0.15));
      break;
    case 'toilet':
      details.push(<ellipse key="seat" cx={0} cy={d * 0.12} rx={w * 0.4} ry={d * 0.32} fill="none" stroke={stroke} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />);
      break;
    case 'shower':
      details.push(line(-w / 2, -d / 2, w / 2, d / 2, 's1'));
      details.push(line(-w / 2, d / 2, w / 2, -d / 2, 's2'));
      break;
    default:
      // front indicator (local +y is the front)
      details.push(line(-w / 2 + Math.min(0.04, w * 0.1), d / 2 - Math.min(0.04, d * 0.15), w / 2 - Math.min(0.04, w * 0.1), d / 2 - Math.min(0.04, d * 0.15), 'front'));
  }
  return (
    <g transform={`translate(${f.x} ${f.y}) rotate(${radToDeg(f.rotation)})`} opacity={f.elevation > 1.2 && shape !== 'pendant' ? 0.7 : 1}>
      <rect
        x={-w / 2}
        y={-d / 2}
        width={w}
        height={d}
        fill={fill}
        fillOpacity={shape === 'rug' ? 0.55 : 0.92}
        stroke={stroke}
        strokeWidth={sw}
        strokeDasharray={f.elevation > 1.2 ? '5 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {details}
      {handle && <circle cx={0} cy={-d / 2 - 22 * px} r={5 * px} fill="#2563eb" />}
    </g>
  );
});
