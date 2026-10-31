import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { rotate, type Vec2 } from '../model/vec';
import { diffFurniture, type FurnitureDiff } from './diff';

/**
 * Side-by-side plan of two variants (#58): the floor plan of each variant as SVG, drawn on the
 * SAME frame and scale so differences are visible at a glance. Furniture is coloured by what
 * changed against the other variant (new / removed / moved). Pure text out.
 */

export type PlanSide = 'a' | 'b';
const COLORS = { unchanged: '#9ca3af', added: '#16a34a', removed: '#dc2626', moved: '#ea580c' } as const;

interface Frame {
  minX: number;
  minY: number;
  w: number;
  h: number;
}

function pointsOf(p: Project): Vec2[] {
  const d = derivePlan(p);
  const pts: Vec2[] = [];
  for (const r of d.rooms.values()) pts.push(...r.interior);
  for (const f of d.footprints.values()) pts.push(...f.polygon);
  for (const f of p.furniture) pts.push({ x: f.x - f.width / 2, y: f.y - f.depth / 2 }, { x: f.x + f.width / 2, y: f.y + f.depth / 2 });
  return pts;
}

/** Common frame (with margin) for both variants. */
export function commonFrame(a: Project, b: Project): Frame {
  const pts = [...pointsOf(a), ...pointsOf(b)];
  if (!pts.length) return { minX: 0, minY: 0, w: 1, h: 1 };
  const xs = pts.map((q) => q.x);
  const ys = pts.map((q) => q.y);
  const m = 0.3;
  const minX = Math.min(...xs) - m;
  const minY = Math.min(...ys) - m;
  return { minX, minY, w: Math.max(...xs) + m - minX, h: Math.max(...ys) + m - minY };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const poly = (pts: Vec2[]) => pts.map((q) => `${q.x.toFixed(3)},${q.y.toFixed(3)}`).join(' ');

/** SVG of one variant; `diff` is the furniture diff A→B. */
export function variantPlanSvg(project: Project, side: PlanSide, diff: FurnitureDiff, frame: Frame): string {
  const d = derivePlan(project);
  const out: string[] = [];
  const pxW = 480;
  const pxH = Math.round((pxW * frame.h) / frame.w);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${frame.minX.toFixed(3)} ${frame.minY.toFixed(3)} ${frame.w.toFixed(3)} ${frame.h.toFixed(3)}" width="${pxW}" height="${pxH}" role="img" style="max-width:100%;height:auto">`,
  );
  for (const r of project.rooms) {
    const g = d.rooms.get(r.id);
    if (!g) continue;
    out.push(`<polygon points="${poly(g.interior)}" fill="#f5f1ea" stroke="none"/>`);
    out.push(`<text x="${g.centroid.x.toFixed(3)}" y="${g.centroid.y.toFixed(3)}" font-size="0.22" text-anchor="middle" fill="#9ca3af" font-family="sans-serif">${esc(r.name)}</text>`);
  }
  for (const f of d.footprints.values()) out.push(`<polygon points="${poly(f.polygon)}" fill="#474747"/>`);
  for (const e of diff.entries) {
    const f = side === 'a' ? e.a : e.b;
    if (!f) continue;
    const color = COLORS[e.status];
    const deg = (f.rotation * 180) / Math.PI;
    const front = rotate({ x: 0, y: f.depth / 2 }, f.rotation);
    const filled = e.status !== 'unchanged';
    out.push(
      `<g data-status="${e.status}"><rect x="${(f.x - f.width / 2).toFixed(3)}" y="${(f.y - f.depth / 2).toFixed(3)}" width="${f.width.toFixed(3)}" height="${f.depth.toFixed(3)}" transform="rotate(${deg.toFixed(2)} ${f.x.toFixed(3)} ${f.y.toFixed(3)})" fill="${color}" fill-opacity="${filled ? 0.55 : 0.18}" stroke="${color}" stroke-width="0.02"><title>${esc(f.name)}</title></rect>` +
        `<line x1="${f.x.toFixed(3)}" y1="${f.y.toFixed(3)}" x2="${(f.x + front.x).toFixed(3)}" y2="${(f.y + front.y).toFixed(3)}" stroke="${color}" stroke-width="0.02"/></g>`,
    );
  }
  out.push('</svg>');
  return out.join('');
}

export interface VariantPlans {
  svgA: string;
  svgB: string;
  diff: FurnitureDiff;
  changes: string[];
}

/** Readable list of what differs, e.g. „Sofa: 0,8 m verschoben“. */
export function changeList(diff: FurnitureDiff): string[] {
  const m = (v: number) => v.toLocaleString('de-AT', { maximumFractionDigits: 2 });
  const out: string[] = [];
  for (const e of diff.entries) {
    if (e.status === 'added') out.push(`neu in B: ${e.b!.name}`);
    else if (e.status === 'removed') out.push(`nur in A: ${e.a!.name}`);
    else if (e.status === 'moved') {
      const parts = [e.moved && `${m(e.distance)} m verschoben`, e.rotated && `${Math.round(e.turn)}° gedreht`].filter(Boolean);
      out.push(`${e.b!.name}: ${parts.join(', ')}`);
    }
  }
  return out;
}

export function buildVariantPlans(a: Project, b: Project): VariantPlans {
  const diff = diffFurniture(a.furniture, b.furniture);
  const frame = commonFrame(a, b);
  return { svgA: variantPlanSvg(a, 'a', diff, frame), svgB: variantPlanSvg(b, 'b', diff, frame), diff, changes: changeList(diff) };
}
