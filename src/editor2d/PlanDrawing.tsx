import { memo } from 'react';
import type { DerivedPlan } from '../model/derived';
import { clipFootprint } from '../model/geometry/walls';
import type { Furniture, Project } from '../model/schema';
import { ICON_MIN_ZOOM, roomLabelDetail } from './viewTransform';
import { add, dist, normalize, perp, scale, sub, type Vec2 } from '../model/vec';
import { formatArea, formatLength, radToDeg } from '../model/units';
import { doorSymbol, openingRect } from './openingSymbols';
import { markKindInfo, markLabels } from '../model/marks';
import { useUiStore, type Selection } from '../store/uiStore';
import { supportsInterior } from '../model/interior';
import { stairLayout } from '../model/stairLayout';
import { stepCount } from '../model/stairs';
import { polygonCentroid } from '../model/vec';
import { interiorPlanDetails } from './interiorPlan';
import { materialById, DEFAULT_FLOOR_MATERIAL_ID } from '../model/materials';

const pts = (poly: Vec2[]) => poly.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Plan colours (#104): theme tokens (theme.css – identical in light and dark, the plan stays
 * light) with the same value as CSS fallback, so the standalone SVG of the PNG export, which
 * has no stylesheet, keeps them. Selection, hover and conflict colours are unchanged.
 */
const C = {
  wall: 'var(--color-plan-wall, #3b4147)',
  wallLine: 'var(--color-plan-wall-line, #1f2326)',
  opening: 'var(--color-plan-opening, #475569)',
  furnitureLine: 'var(--color-plan-furniture-line, #6b7280)',
  dimension: 'var(--color-plan-dimension, #94a3b8)',
  text: 'var(--color-plan-text, #111827)',
  textMuted: 'var(--color-plan-text-muted, #4b5563)',
  halo: 'var(--color-plan-halo, #ffffff)',
};
/** Line widths in screen pixels (non-scaling, the same at every zoom): walls bold, openings medium, furniture thin, helpers fine. */
export const PLAN_STROKE = { wall: 1.5, opening: 1.2, doorLeaf: 1.6, doorArc: 0.8, furniture: 1, furnitureDetail: 0.6, dimension: 0.7 } as const;
const W = PLAN_STROKE;

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
  /** Furniture not drawn: replaced by the furnishing preview (#350). */
  hidden?: string[];
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

export const PlanDrawing = memo(function PlanDrawing({ project, derived, selection, multi = [], hover, zoom, showDimensions, conflicts, rotateHandleFor, hidden }: Props) {
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
        style={{ fill: selected ? '#dbeafe' : lighten(mat.color, 0.78) }}
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
    const fill = selected ? '#2563eb' : hovered ? '#475569' : C.wall;
    const outline = selected || hovered ? fill : C.wallLine;
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
          <polygon key={i} points={pts(s)} style={{ fill, stroke: outline }} strokeWidth={W.wall} strokeLinejoin="miter" vectorEffect="non-scaling-stroke" data-layer="wall" />
        ))}
      </g>
    );
  });

  const hubs = derived.hubs.map((h) => <polygon key={h.nodeId} points={pts(h.polygon)} style={{ fill: C.wall, stroke: C.wall }} strokeWidth={0.5} vectorEffect="non-scaling-stroke" />);

  const openings = project.walls.flatMap((w) => {
    const fp = derived.footprints.get(w.id);
    if (!fp) return [];
    return (derived.openings.get(w.id) ?? []).map((r) => {
      const o = r.opening;
      const selected = isSel(selection, 'opening', o.id);
      const hovered = isSel(hover, 'opening', o.id);
      const stroke = selected ? '#2563eb' : hovered ? '#1f2937' : C.opening;
      const paper = selected ? '#dbeafe' : C.halo;
      const rect = openingRect(fp, r);
      if (o.kind === 'window') {
        const mid0 = add(fp.a, scale(fp.dir, r.s0));
        const mid1 = add(fp.a, scale(fp.dir, r.s1));
        const off = scale(fp.normal, fp.thickness / 6);
        return (
          <g key={o.id}>
            <polygon points={pts(rect)} style={{ fill: paper, stroke }} strokeWidth={W.opening} vectorEffect="non-scaling-stroke" />
            <line x1={mid0.x + off.x} y1={mid0.y + off.y} x2={mid1.x + off.x} y2={mid1.y + off.y} style={{ stroke }} strokeWidth={W.opening} vectorEffect="non-scaling-stroke" />
            <line x1={mid0.x - off.x} y1={mid0.y - off.y} x2={mid1.x - off.x} y2={mid1.y - off.y} style={{ stroke }} strokeWidth={W.opening} vectorEffect="non-scaling-stroke" />
          </g>
        );
      }
      if (o.kind === 'door') {
        const ds = doorSymbol(fp, r);
        return (
          <g key={o.id}>
            <polygon points={pts(rect)} style={{ fill: paper, stroke: 'none' }} />
            <line x1={ds.hinge.x} y1={ds.hinge.y} x2={ds.openTip.x} y2={ds.openTip.y} style={{ stroke }} strokeWidth={W.doorLeaf} vectorEffect="non-scaling-stroke" />
            <path
              d={`M ${ds.closedTip.x} ${ds.closedTip.y} A ${ds.radius} ${ds.radius} 0 0 ${ds.sweep} ${ds.openTip.x} ${ds.openTip.y}`}
              fill="none"
              style={{ stroke }}
              strokeWidth={W.doorArc}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      }
      return (
        <g key={o.id}>
          <polygon points={pts(rect)} style={{ fill: paper, stroke: 'none' }} />
          <line x1={rect[0].x} y1={rect[0].y} x2={rect[3].x} y2={rect[3].y} style={{ stroke }} strokeWidth={W.opening} vectorEffect="non-scaling-stroke" />
          <line x1={rect[1].x} y1={rect[1].y} x2={rect[2].x} y2={rect[2].y} style={{ stroke }} strokeWidth={W.opening} vectorEffect="non-scaling-stroke" />
        </g>
      );
    });
  });

  // floor-level items first, wall-mounted / elevated items last
  const furniture = (hidden?.length ? project.furniture.filter((f) => !hidden.includes(f.id)) : [...project.furniture]).sort((a, b) => a.elevation + a.height * 0.001 - (b.elevation + b.height * 0.001));

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
      <MarksLayer marks={project.marks} px={px} />
      {showDimensions && zoom >= ICON_MIN_ZOOM && <RoomDimensions project={project} derived={derived} px={px} fontSize={fontSize} />}
      <g>
        {project.rooms.map((r) => {
          const g = derived.rooms.get(r.id);
          if (!g) return null;
          const xs = g.interior.map((p) => p.x);
          const ys = g.interior.map((p) => p.y);
          const detail = roomLabelDetail(r.name, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), zoom);
          if (detail === 'none') return null;
          return (
            <g key={r.id} pointerEvents="none">
              <text x={g.centroid.x} y={g.centroid.y - fontSize * 0.2} fontSize={fontSize * 1.15} textAnchor="middle" style={{ fill: C.text }} fontWeight={600}>
                {r.name}
              </text>
              {detail === 'full' && (
                <text x={g.centroid.x} y={g.centroid.y + fontSize * 1.1} fontSize={fontSize} textAnchor="middle" style={{ fill: C.textMuted }}>
                  {formatArea(g.area)}
                </text>
              )}
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
          <line x1={a2.x} y1={a2.y} x2={b2.x} y2={b2.y} style={{ stroke: C.dimension }} strokeWidth={W.dimension} vectorEffect="non-scaling-stroke" />
          <line x1={a2.x - inward.x * 4 * px} y1={a2.y - inward.y * 4 * px} x2={a2.x + inward.x * 4 * px} y2={a2.y + inward.y * 4 * px} style={{ stroke: C.dimension }} strokeWidth={W.dimension} vectorEffect="non-scaling-stroke" />
          <line x1={b2.x - inward.x * 4 * px} y1={b2.y - inward.y * 4 * px} x2={b2.x + inward.x * 4 * px} y2={b2.y + inward.y * 4 * px} style={{ stroke: C.dimension }} strokeWidth={W.dimension} vectorEffect="non-scaling-stroke" />
          <text
            x={mid.x}
            y={mid.y}
            fontSize={fontSize * 0.9}
            style={{ fill: C.textMuted, stroke: C.halo }}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(${ang} ${mid.x} ${mid.y})`}
            paintOrder="stroke"
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
export const FurnitureSymbol = memo(function FurnitureSymbol({
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
  const stroke = conflict === 'error' ? '#dc2626' : conflict === 'warn' ? '#d97706' : selected ? '#2563eb' : hovered ? '#1d4ed8' : C.furnitureLine;
  const fill = shape === 'rug' ? lighten(f.color, 0.4) : lighten(f.color, 0.62);
  const sw = selected ? 2 : W.furniture;
  const details: React.ReactNode[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number, k: string) => (
    <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />
  );
  const rect = (x: number, y: number, rw: number, rh: number, k: string, rx = 0) => (
    <rect key={k} x={x} y={y} width={rw} height={rh} rx={rx} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />
  );
  const open = useUiStore((st) => st.interiorOpen.includes(f.id)) && !!f.interior && supportsInterior(shape);
  // a cabinet shown open (#85) draws its inner layout instead of the closed-door cross
  const openDetails = open ? interiorPlanDetails(f) : [];
  openDetails.forEach((x, i) => {
    const dash = x.dashed ? '4 3' : undefined;
    details.push(
      x.type === 'line' ? (
        <line key={`i${i}`} x1={x.x1} y1={x.y1} x2={x.x2} y2={x.y2} style={{ stroke }} strokeWidth={W.furnitureDetail} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
      ) : (
        <rect key={`i${i}`} x={x.x} y={x.y} width={x.w} height={x.h} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
      ),
    );
  });
  switch (open ? 'open' : shape) {
    case 'open':
      break;
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
          <ellipse cx={0} cy={0} rx={w / 2} ry={d / 2} fill={fill} style={{ stroke }} strokeWidth={sw} vectorEffect="non-scaling-stroke" />
        </g>
      );
    case 'plant':
    case 'floor-lamp':
    case 'table-lamp':
    case 'pendant':
      return (
        <g transform={`translate(${f.x} ${f.y}) rotate(${radToDeg(f.rotation)})`}>
          <circle cx={0} cy={0} r={Math.min(w, d) / 2} fill={fill} style={{ stroke }} strokeWidth={sw} vectorEffect="non-scaling-stroke" strokeDasharray={shape === 'pendant' ? '3 2' : undefined} />
        </g>
      );
    case 'k-sink':
    case 'washbasin':
      details.push(rect(-w * 0.3, -d * 0.25, w * 0.6, d * 0.55, 'basin', 0.04));
      break;
    case 'k-cooktop':
      for (const [cx, cy] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]])
        details.push(<circle key={`${cx}${cy}`} cx={(cx * w) / 1} cy={(cy * d) / 1} r={Math.min(w, d) * 0.16} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />);
      break;
    case 'bathtub':
      details.push(rect(-w / 2 + 0.06, -d / 2 + 0.06, w - 0.12, d - 0.12, 'tub', 0.15));
      break;
    case 'toilet':
      details.push(<ellipse key="seat" cx={0} cy={d * 0.12} rx={w * 0.4} ry={d * 0.32} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />);
      break;
    case 'stairs': {
      // treads across the flight and the walking line with an arrow pointing up the stairs (to local −y, #54)
      const n = stepCount(f.height);
      for (let i = 1; i < n; i++) details.push(line(-w / 2, d / 2 - (i * d) / n, w / 2, d / 2 - (i * d) / n, `t${i}`));
      details.push(line(0, d / 2 - d / n / 2, 0, -d / 2 + d / n / 2, 'walk'));
      const ah = Math.min(0.2, w * 0.3);
      details.push(line(0, -d / 2 + d / n / 2, -ah, -d / 2 + d / n / 2 + ah, 'a1'));
      details.push(line(0, -d / 2 + d / n / 2, ah, -d / 2 + d / n / 2 + ah, 'a2'));
      details.push(<circle key="start" cx={0} cy={d / 2 - d / n / 2} r={Math.min(0.05, w * 0.1)} style={{ fill: stroke }} />);
      break;
    }
    case 'shower':
      details.push(line(-w / 2, -d / 2, w / 2, d / 2, 's1'));
      details.push(line(-w / 2, d / 2, w / 2, -d / 2, 's2'));
      break;
    default:
      if (shape.startsWith('stairs-')) {
        // turning stairs (#335): the treads of the shared layout and the walking line through them, arrow at the top
        const layout = stairLayout(shape, w, d, f.height);
        if (layout) {
          layout.treads.forEach((t, i) =>
            details.push(<polygon key={`t${i}`} points={t.poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />),
          );
          const walk = layout.treads.map((t) => polygonCentroid(t.poly));
          if (walk.length >= 2) {
            details.push(<polyline key="walk" points={walk.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" style={{ stroke }} strokeWidth={W.furnitureDetail} vectorEffect="non-scaling-stroke" />);
            const a = walk[walk.length - 2];
            const b = walk[walk.length - 1];
            const ang = Math.atan2(b.y - a.y, b.x - a.x);
            const ah = Math.min(0.2, w * 0.15);
            for (const side of [-1, 1]) details.push(line(b.x, b.y, b.x - Math.cos(ang + side * 0.5) * ah, b.y - Math.sin(ang + side * 0.5) * ah, `ah${side}`));
            details.push(<circle key="start" cx={walk[0].x} cy={walk[0].y} r={Math.min(0.05, w * 0.05)} style={{ fill: stroke }} />);
          }
          break;
        }
      }
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
        style={{ stroke }}
        strokeWidth={sw}
        strokeDasharray={f.elevation > 1.2 ? '5 3' : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {details}
      {handle && <circle cx={0} cy={-d / 2 - 22 * px} r={5 * px} fill="#2563eb" />}
    </g>
  );
});

/** Mieter-Paket markers (#362): numbered dots – blue = Zustand, red = Bohrloch, orange = Klebestelle. */
function MarksLayer({ marks, px }: { marks: Project['marks']; px: number }) {
  if (marks.length === 0) return null;
  const labels = markLabels(marks);
  return (
    <g data-testid="marks-layer" pointerEvents="none">
      {marks.map((m) => {
        const info = markKindInfo(m.kind);
        const r = 7 * px;
        return (
          <g key={m.id} data-testid="mark" data-kind={m.kind}>
            <circle cx={m.x} cy={m.y} r={r} fill={info.color} stroke="#ffffff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
            <text x={m.x + r + 2 * px} y={m.y + 4 * px} fontSize={11 * px} fontWeight={700} fill={info.color} paintOrder="stroke" stroke="#ffffff" strokeWidth={3 * px}>
              {labels.get(m.id)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
