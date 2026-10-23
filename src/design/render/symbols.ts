/**
 * Top-view symbols of the pieces in the room image (#442), in the spirit of the 2D plan
 * (`FurnitureSymbol`): sofa with back and arms, bed with pillows, wardrobe with a cross, sink,
 * cooktop, WC … Colours by category, so a sofa reads as a sofa at a glance. Drawn in the local
 * frame of the piece in px: centre at 0,0, +y is the front.
 */
import type { RItem } from '../review/items';
import { el, fmt } from './svg';

const FILL: Record<string, string> = {
  sofa: '#9db4d0',
  bed: '#c3b3e0',
  table: '#dcc396',
  desk: '#dcc396',
  chair: '#e8d6b6',
  storage: '#cbc2b2',
  kitchen: '#bcc2ca',
  appliance: '#bcc2ca',
  bathroom: '#b9dfe8',
  lighting: '#f5d76e',
  textile: '#efe3cf',
  decor: '#d9cfc0',
};

export const STROKE = '#4b5563';

export function fillOf(i: RItem): string {
  if (i.existing) return '#d4d4d4';
  if (i.shape === 'plant') return '#a3d295';
  if (i.role === 'wall-art') return '#dba7a7';
  if (i.role === 'curtain') return '#e6c9bb';
  if (i.role === 'mirror') return '#cfe6f3';
  return FILL[i.category] ?? '#d9d4ca';
}

const ROUND = new Set(['plant', 'floor-lamp', 'table-lamp', 'pendant']);

/** Pieces whose front says nothing (round, flat or hanging decoration). */
const NO_FRONT = new Set(['rug', 'curtain', 'wall-art', 'mirror', 'pendant', 'table-lamp', 'floor-lamp']);

/**
 * SVG of one piece at plan scale `s` (px per m), positioned with `at` (px) and its rotation.
 * `hatch` is the id of the pattern for existing pieces.
 */
export function pieceSvg(i: RItem, at: { x: number; y: number }, s: number, hatch: string): string {
  const w = Math.max(2, i.width * s);
  const d = Math.max(2, i.depth * s);
  const shape = i.shape;
  const hanging = !i.floor && i.role !== 'rug' && i.role !== 'mattress';
  const rug = i.role === 'rug' || (i.category === 'textile' && i.role !== 'curtain');
  const stroke = rug ? '#b9a789' : STROKE;
  const base = {
    fill: fillOf(i),
    'fill-opacity': rug ? 0.75 : hanging ? 0.45 : 0.95,
    stroke,
    'stroke-width': 1,
    'stroke-dasharray': hanging || rug ? '4 3' : undefined,
  };
  const parts: string[] = [];
  const line = (x1: number, y1: number, x2: number, y2: number) => el('line', { x1, y1, x2, y2, stroke, 'stroke-width': 0.7 });
  const rect = (x: number, y: number, rw: number, rh: number, rx = 0) => el('rect', { x, y, width: rw, height: rh, rx: rx || undefined, fill: 'none', stroke, 'stroke-width': 0.7 });
  const m = s; // one metre in px, for the fixed-size details of the 2D plan
  if (ROUND.has(shape) || shape === 'table-round') {
    parts.push(shape === 'table-round' ? el('ellipse', { cx: 0, cy: 0, rx: w / 2, ry: d / 2, ...base }) : el('circle', { cx: 0, cy: 0, r: Math.min(w, d) / 2, ...base }));
  } else {
    parts.push(el('rect', { x: -w / 2, y: -d / 2, width: w, height: d, ...base }));
    switch (shape) {
      case 'sofa':
      case 'armchair':
        parts.push(rect(-w / 2, -d / 2, w, d * 0.25), rect(-w / 2, -d / 2, w * 0.1, d), rect(w / 2 - w * 0.1, -d / 2, w * 0.1, d));
        break;
      case 'sofa-corner':
        parts.push(rect(-w / 2, -d / 2, w, d * 0.18), rect(w / 2 - w * 0.12, -d / 2, w * 0.12, d));
        break;
      case 'bed':
        parts.push(rect(-w / 2 + 0.05 * m, -d / 2 + 0.06 * m, w / 2 - 0.08 * m, 0.3 * m, 0.05 * m), rect(0.03 * m, -d / 2 + 0.06 * m, w / 2 - 0.08 * m, 0.3 * m, 0.05 * m), line(-w / 2, -d / 2 + 0.45 * m, w / 2, -d / 2 + 0.45 * m));
        break;
      case 'wardrobe':
      case 'shower':
        parts.push(line(-w / 2, -d / 2, w / 2, d / 2), line(-w / 2, d / 2, w / 2, -d / 2));
        break;
      case 'k-sink':
      case 'washbasin':
        parts.push(rect(-w * 0.3, -d * 0.25, w * 0.6, d * 0.55, 0.04 * m));
        break;
      case 'k-cooktop':
        for (const [cx, cy] of [
          [-0.25, -0.25],
          [0.25, -0.25],
          [-0.25, 0.25],
          [0.25, 0.25],
        ])
          parts.push(el('circle', { cx: cx * w, cy: cy * d, r: Math.min(w, d) * 0.16, fill: 'none', stroke, 'stroke-width': 0.7 }));
        break;
      case 'bathtub':
        parts.push(rect(-w / 2 + 0.06 * m, -d / 2 + 0.06 * m, w - 0.12 * m, d - 0.12 * m, 0.15 * m));
        break;
      case 'toilet':
        parts.push(el('ellipse', { cx: 0, cy: d * 0.12, rx: w * 0.4, ry: d * 0.32, fill: 'none', stroke, 'stroke-width': 0.7 }));
        break;
    }
    if (i.existing) parts.push(el('rect', { x: -w / 2, y: -d / 2, width: w, height: d, fill: `url(#${hatch})`, stroke: 'none' }));
    // the front: a small wedge inside the front edge, pointing out of it
    if (!NO_FRONT.has(i.role) && !NO_FRONT.has(shape) && !rug && !i.kitchen?.match(/^(countertop|hood)$/)) {
      const a = Math.max(2.5, Math.min(5, Math.min(w, d) * 0.18));
      parts.push(el('polygon', { points: `${fmt(-a)},${fmt(d / 2 - a * 1.3)} ${fmt(a)},${fmt(d / 2 - a * 1.3)} 0,${fmt(d / 2 - 0.8)}`, fill: '#374151' }));
    }
  }
  const deg = (i.rotation * 180) / Math.PI;
  return el('g', { transform: `translate(${fmt(at.x)} ${fmt(at.y)})${Math.abs(deg) > 0.05 ? ` rotate(${fmt(deg)})` : ''}`, 'data-item': i.id }, parts);
}
