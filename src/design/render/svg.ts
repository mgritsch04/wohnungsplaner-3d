/** Small helpers to write SVG as text (#442): no DOM, so the room image also renders in Node and in tests. */

/** Number with at most one decimal, without a trailing `.0` and without `-0`. */
export function fmt(v: number): string {
  const r = Math.round(v * 10) / 10;
  return r === 0 ? '0' : String(r);
}

const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ENTITIES[c]);

export type Attrs = Record<string, string | number | undefined | false>;

/** One element; numbers are rounded with `fmt`, empty attributes are left out. */
export function el(tag: string, attrs: Attrs, children?: string | string[]): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? fmt(v) : esc(String(v))}"`)
    .join('');
  const body = Array.isArray(children) ? children.join('') : children;
  return body === undefined || body === '' ? `<${tag}${a}/>` : `<${tag}${a}>${body}</${tag}>`;
}

export const points = (pts: readonly { x: number; y: number }[]): string => pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');

/** Closed path of one or more rings (`fill-rule="evenodd"` cuts the inner rings out). */
export const ringPath = (rings: readonly (readonly { x: number; y: number }[])[]): string =>
  rings.map((r) => `M${r.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join('L')}Z`).join('');

/** Rough width of a text line in px (no font metrics outside the browser). */
export const textWidth = (text: string, size: number, bold = false): number => text.length * size * (bold ? 0.62 : 0.56);
