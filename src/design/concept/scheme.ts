/**
 * Colour scheme per room (SL2): every room gets wall, furniture, textile and accent colours from
 * the flat's palette, so furniture, décor and walls of a room fit together and the rooms still
 * belong to one flat. Claude proposes the scheme in the flat concept; what it leaves out is
 * derived here from the palette, and colours of the room programme that stray from the scheme
 * are pulled back to the nearest scheme colour.
 */
import { hex } from './common';
import type { RoomConcept, RoomScheme, RoomType, StylePlan } from '../types';

type Rgb = [number, number, number];

const rgb = (h: string): Rgb => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const chroma = (c: Rgb) => Math.max(...c) - Math.min(...c);
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Nearest colour of `from` to `h` (hex), with its distance. */
export function nearest(h: string, from: string[]): { hex: string; d: number } | null {
  const c = rgb(h);
  let best: { hex: string; d: number } | null = null;
  for (const q of from) {
    const d = dist(c, rgb(q));
    if (!best || d < best.d) best = { hex: q, d };
  }
  return best;
}

/** Moods per room type: which palette colour carries the wall (lighter rooms stay calmer). */
const WALL_TINT: Partial<Record<RoomType, number>> = { bedroom: 0.35, kids: 0.25, bath: 0.2, hall: 0.15, office: 0.25 };

/** Mixes a colour towards white by `t` (0 = unchanged). */
const lighten = (h: string, t: number) => toHex(rgb(h).map((v) => v + (255 - v) * t) as Rgb);

/**
 * Scheme from the palette alone: wall = main colour (calmer rooms lighter), furniture = second
 * colour, textile = the neutral or second, accent = the room's accent or the palette's accent.
 */
export function deriveScheme(style: StylePlan, type: RoomType, accent?: string): RoomScheme {
  const pal = style.palette;
  const by = (role: string) => pal.find((c) => c.role === role)?.hex;
  const light = [...pal].sort((a, b) => luma(rgb(b.hex)) - luma(rgb(a.hex)));
  const main = by('haupt') ?? light[0]?.hex ?? '#e8e4dc';
  const second = by('zweit') ?? pal.find((c) => c.hex !== main)?.hex ?? main;
  const neutral = by('neutral') ?? light[0]?.hex ?? main;
  const acc = accent ?? by('akzent') ?? pal.find((c) => chroma(rgb(c.hex)) > 40 && c.hex !== main && c.hex !== second)?.hex ?? second;
  const tint = WALL_TINT[type] ?? 0;
  return { wall: tint ? lighten(main, tint) : main, furniture: second, textile: neutral === main ? second : neutral, accent: acc };
}

/** The scheme of a room: Claude's, else derived. */
export const schemeOf = (rc: RoomConcept, style: StylePlan): RoomScheme => rc.scheme ?? deriveScheme(style, rc.type, rc.accent);

/** Colours a piece in this room may have. */
export const schemeColors = (s: RoomScheme): string[] => [...new Set([s.wall, s.furniture, s.textile, s.accent])];

/**
 * Parses the "scheme" of a room answer. Colours not in the palette are pulled to the nearest
 * palette colour (with a note); missing colours come from the derived scheme.
 */
export function parseScheme(raw: unknown, style: StylePlan, type: RoomType, accent: string | undefined, roomName: string, notes: string[]): RoomScheme | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const base = deriveScheme(style, type, accent);
  const pal = style.palette.map((c) => c.hex);
  const pick = (k: keyof Omit<RoomScheme, 'note'>, names: string[]): string => {
    const v = names.map((n) => hex(o[n])).find(Boolean);
    if (!v) return base[k];
    if (k === 'wall' || !pal.length) return v; // a wall may be a tint of the main colour
    const n = nearest(v, pal);
    if (n && n.d > 60 && chroma(rgb(v)) > 28) {
      notes.push(`Raum „${roomName}“: Farbe ${v} (${k}) liegt nicht in der Palette, ersetzt durch ${n.hex}.`);
      return n.hex;
    }
    return v;
  };
  const note = typeof o.note === 'string' ? o.note.trim().replace(/\s+/g, ' ').slice(0, 200) : '';
  return { wall: pick('wall', ['wall', 'wand']), furniture: pick('furniture', ['furniture', 'moebel', 'möbel']), textile: pick('textile', ['textile', 'textil']), accent: pick('accent', ['accent', 'akzent']), ...(note ? { note } : {}) };
}

/**
 * A programme colour kept in the room's scheme: neutrals and colours near a scheme colour stay,
 * a clearly different one becomes the nearest scheme colour. Returns the colour and whether it changed.
 */
export function fitToScheme(color: string, s: RoomScheme): { color: string; changed: boolean } {
  const c = rgb(color);
  if (chroma(c) < 28) return { color, changed: false };
  const n = nearest(color, schemeColors(s));
  return n && n.d > 70 ? { color: n.hex, changed: true } : { color, changed: false };
}

/** Prompt text: „Wand #…, Möbel #…, Textilien #…, Akzent #…“. */
export const schemeText = (s: RoomScheme, style: StylePlan): string => {
  const name = (h: string) => style.palette.find((c) => c.hex === h)?.name;
  const t = (label: string, h: string) => `${label} ${name(h) ? `${name(h)} ` : ''}${h}`;
  return `${t('Wand', s.wall)}, ${t('große Möbel', s.furniture)}, ${t('Textilien', s.textile)}, ${t('Akzent', s.accent)}${s.note ? ` (${s.note})` : ''}`;
};
