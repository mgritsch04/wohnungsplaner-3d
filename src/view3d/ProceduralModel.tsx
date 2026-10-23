import { memo, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { stairLayout } from '../model/stairLayout';
import { stepCount } from '../model/stairs';
import { polygonArea, type Vec2 } from '../model/vec';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { FurnitureFinish, Interior, ModelRef, QualityMode, TableBase } from '../model/schema';
import { BOARD, columnWidth, DEFAULT_DRAWER_HEIGHT, innerHeight } from '../model/interior';
import { getColorMaterial, type DetailKind } from './materials3d';
import { lampLight, type LampSpec } from './lighting';
import { registerLampLight, registerLampShade, registerShadowLamp } from './lampRegistry';

/** Light of one lamp at full brightness (candela-like, physically based lights). */

/**
 * Procedural, primitive-based furniture models. All models are built in a local
 * frame with the origin at the footprint center on the floor, local X = width,
 * local Z = depth (+Z is the FRONT), Y = up. They are honest approximations whose
 * outer dimensions match the stored width/depth/height.
 */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const TAPER = new THREE.CylinderGeometry(0.5, 0.36, 1, 16);
const SPHERE = new THREE.SphereGeometry(0.5, 20, 14);
const LEAF = new THREE.IcosahedronGeometry(0.5, 1);
const CONE = new THREE.CylinderGeometry(0.25, 0.5, 1, 32, 1, true);
/** Cylinder whose axis is Z (for round fronts). */
const CYL_Z = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).rotateX(Math.PI / 2);

/** Rounded boxes depend on their real size (the radius must not be scaled), so they are cached per size. */
const roundedCache = new Map<string, THREE.BufferGeometry>();
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const radius = Math.max(0.001, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4));
  const key = [w, h, d, radius].map((v) => v.toFixed(3)).join('|');
  let g = roundedCache.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 3, radius);
    roundedCache.set(key, g);
    if (roundedCache.size > 2000) {
      const first = roundedCache.keys().next().value!;
      roundedCache.get(first)?.dispose();
      roundedCache.delete(first);
    }
  }
  return g;
}

/** Curtain panel with sinusoidal folds (cached per size). */
const curtainCache = new Map<string, THREE.BufferGeometry>();
function curtainGeometry(w: number, h: number, depth: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${depth.toFixed(3)}`;
  let g = curtainCache.get(key);
  if (!g) {
    const folds = Math.max(3, Math.round(w / 0.14));
    g = new THREE.PlaneGeometry(w, h, folds * 6, 1);
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      pos.setZ(i, (Math.sin(((x + w / 2) / w) * folds * Math.PI * 2) * depth) / 2);
    }
    g.computeVertexNormals();
    curtainCache.set(key, g);
  }
  return g;
}

type V3 = [number, number, number];
export interface Part {
  geo: THREE.BufferGeometry;
  /** Center position. */
  p: V3;
  /** Scale (size for unit primitives, 1 for sized geometries). */
  s: V3;
  r?: V3;
  color: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  opacity?: number;
  doubleSide?: boolean;
  /** Surface structure in realism mode. */
  detail?: DetailKind;
  detailRepeat?: number;
  /** Takes the product photo texture when the item has one (#273: table tops). */
  textured?: boolean;
}

/** Colours of the item's main parts (its colour and shades of it), collected while `buildParts` runs. */
let tones: Set<string> | null = null;

function shade(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  const out = `#${c.getHexString()}`;
  if (tones?.has(hex.toLowerCase())) tones.add(out);
  return out;
}

/** Surface look per chosen furniture material (#63). */
const FINISH_LOOK: Record<FurnitureFinish, Pick<Part, 'rough' | 'metal' | 'detail' | 'detailRepeat'>> = {
  fabric: { rough: 0.95, metal: 0, detail: 'fabric', detailRepeat: 3 },
  leather: { rough: 0.45, metal: 0, detail: 'leather', detailRepeat: 2 },
  wood: { rough: 0.55, metal: 0, detail: 'woodgrain', detailRepeat: 1 },
  lacquer: { rough: 0.2, metal: 0, detail: undefined, detailRepeat: undefined },
  metal: { rough: 0.16, metal: 1, detail: undefined, detailRepeat: undefined },
  stone: { rough: 0.25, metal: 0, detail: 'stone', detailRepeat: 1 },
};

/** Box from min corner (x0,y0,z0) to max corner. */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, extra: Partial<Part> = {}): Part => ({
  geo: BOX,
  p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  s: [Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)],
  color,
  ...extra,
});
/** Rounded box from min to max corner with edge radius r. */
const rbox = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, color: string, extra: Partial<Part> = {}): Part => {
  const w = Math.max(2e-3, x1 - x0);
  const h = Math.max(2e-3, y1 - y0);
  const d = Math.max(2e-3, z1 - z0);
  return { geo: roundedBox(w, h, d, r), p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], s: [1, 1, 1], color, ...extra };
};
const cyl = (x: number, y0: number, z: number, r: number, y1: number, color: string, extra: Partial<Part> = {}): Part => ({
  geo: CYL,
  p: [x, (y0 + y1) / 2, z],
  s: [r * 2, Math.max(1e-3, y1 - y0), r * 2],
  color,
  ...extra,
});
const leg = (x: number, z: number, top: number, r: number, color: string): Part => ({ geo: TAPER, p: [x, top / 2, z], s: [r * 2, top, r * 2], color, rough: 0.6, detail: 'woodgrain' });

const WOOD = '#8a6748';
const METAL = '#a7abb0';
const BLACK = '#26272a';

/**
 * Parts of a procedural model. With a `finish` (#63) the main parts, i.e. those in the item colour
 * or a shade of it, get that material's surface; fixed parts (metal feet, glass, glowing shades) keep theirs.
 */
export function buildParts(shape: string, w: number, d: number, h: number, color: string, accent?: string, finish?: FurnitureFinish, look: ProceduralLook = {}): Part[] {
  if (!finish) return shapeParts(shape, w, d, h, color, accent, look);
  const own = new Set([color.toLowerCase()]);
  tones = own;
  let parts: Part[];
  try {
    parts = shapeParts(shape, w, d, h, color, accent, look);
  } finally {
    tones = null;
  }
  const surface = FINISH_LOOK[finish];
  return parts.map((p) => (own.has(p.color.toLowerCase()) && !p.emissive && (p.opacity ?? 1) === 1 ? { ...p, ...surface } : p));
}

/**
 * A cabinet with its fronts removed and the planned inner layout (#85): carcass, dividers,
 * shelves, rods with a few hangers and drawers pulled out a little. Spans the whole cabinet
 * height (no plinth), so the inner floor lies one board above the ground, as `interior.ts` assumes.
 */
export function openCabinetParts(w: number, d: number, h: number, color: string, interior: Interior, accent?: string): Part[] {
  const W = w / 2;
  const D = d / 2;
  const t = BOARD;
  const front = accent ?? color;
  const wood = shade(color, 0.96);
  const parts: Part[] = [
    box(-W, 0, -D, -W + t, h, D, wood),
    box(W - t, 0, -D, W, h, D, wood),
    box(-W + t, 0, -D, W - t, t, D, wood),
    box(-W + t, h - t, -D, W - t, h, D, wood),
    box(-W + t, t, -D, W - t, h - t, -D + 0.01, shade(color, 0.88)),
  ];
  const n = interior.columns;
  const cw = columnWidth({ width: w, depth: d, height: h }, n);
  const x0 = (c: number) => -W + t + c * (cw + t);
  for (let c = 1; c < n; c++) parts.push(box(x0(c) - t, t, -D, x0(c), h - t, D - 0.02, wood));
  const pull = Math.min(0.3, d * 0.5);
  const top = innerHeight({ width: w, depth: d, height: h });
  for (const p of interior.parts) {
    if (p.column >= n) continue;
    const a = x0(p.column);
    const b = a + cw;
    const z = t + p.z;
    if (p.kind === 'shelf') parts.push(box(a, z, -D + 0.01, b, z + t, D - 0.02, wood));
    else if (p.kind === 'rod') {
      parts.push({ geo: CYL, p: [(a + b) / 2, t + p.z, 0], s: [0.03, cw, 0.03], r: [0, 0, Math.PI / 2], color: METAL, metal: 0.85, rough: 0.3 });
      const hangers = Math.max(2, Math.floor(cw / 0.07));
      for (let k = 0; k < hangers; k++) {
        const hx = a + 0.03 + ((k + 0.5) * (cw - 0.06)) / hangers;
        parts.push(box(hx - 0.004, t + p.z - Math.min(1.2, p.z - 0.05), -0.12, hx + 0.004, t + p.z - 0.03, 0.12, k % 3 === 0 ? '#5b6b8a' : k % 3 === 1 ? '#c9b79c' : '#7a4f4f', { rough: 0.9 }));
      }
    } else {
      const dh = Math.min(p.h ?? DEFAULT_DRAWER_HEIGHT, top - p.z);
      const fz = D - 0.02 + pull; // front panel position when pulled out
      parts.push(rbox(a + 0.003, z + 0.003, fz, b - 0.003, z + dh - 0.003, fz + t, 0.003, front, { rough: 0.5 }));
      parts.push(rbox((a + b) / 2 - 0.06, z + dh / 2 - 0.006, fz + t, (a + b) / 2 + 0.06, z + dh / 2 + 0.006, fz + t + 0.02, 0.004, METAL, { metal: 0.85, rough: 0.3 }));
      const bd = Math.max(0.1, d - 0.08);
      const zb = fz - bd;
      const inner = shade(color, 0.9);
      parts.push(box(a + 0.02, z + 0.01, zb, b - 0.02, z + 0.025, fz, inner));
      parts.push(box(a + 0.02, z + 0.01, zb, a + 0.032, z + dh - 0.04, fz, inner));
      parts.push(box(b - 0.032, z + 0.01, zb, b - 0.02, z + dh - 0.04, fz, inner));
      parts.push(box(a + 0.02, z + 0.01, zb, b - 0.02, z + dh - 0.04, zb + 0.012, inner));
    }
  }
  return parts;
}

/** Product details beyond the main colour (#273): frame/leg colour and the kind of table base. */
export interface ProceduralLook {
  /** colour of legs, frame or base; default: a shade of the main colour (tables) or the shape's own */
  secondary?: string;
  /** table/desk base: four legs (default), sled frames, X frames, centre pedestal or side panels */
  base?: TableBase;
  /** part sizes from the product page, in meters */
  topThickness?: number;
  legSize?: number;
  seatHeight?: number;
  /** product photo crop (data URL) for the main surface, e.g. a table top */
  texture?: string;
}

/** The look fields a procedural model reference carries (#273). */
export function lookOf(model: ModelRef): ProceduralLook {
  if (model.type !== 'procedural') return {};
  const { secondaryColor: secondary, base, topThickness, legSize, seatHeight, texture } = model;
  return { secondary, base, topThickness, legSize, seatHeight, texture };
}

/** Base under a rectangular table top whose underside is at height `top` (half sizes W, D). */
function tableBase(base: TableBase, W: number, D: number, top: number, c: string, size?: number): Part[] {
  const metal: Partial<Part> = { rough: 0.4 };
  const t = (size ?? 0.04) / 2; // half bar thickness
  const inset = Math.min(0.18, Math.max(0.06, W * 0.15)); // frames sit a little in from the ends
  switch (base) {
    case 'sled':
      // a closed U/rectangle frame at each end, standing on a floor rail
      return [-W + inset, W - inset].flatMap((x) => [
        box(x - t, 0, -D + 0.06, x + t, 0.03, D - 0.06, c, metal),
        box(x - t, 0, -D + 0.06, x + t, top, -D + 0.1, c, metal),
        box(x - t, 0, D - 0.1, x + t, top, D - 0.06, c, metal),
        box(x - t, top - 0.03, -D + 0.06, x + t, top, D - 0.06, c, metal),
      ]);
    case 'x': {
      // a crossed pair of bars at each end
      const dz = 2 * (D - 0.08);
      const len = Math.hypot(dz, top);
      const a = Math.atan2(dz, top);
      return [-W + 0.1, W - 0.1].flatMap((x) => [a, -a].map((r): Part => ({ ...box(-t, -len / 2, -t, t, len / 2, t, c, metal), p: [x, top / 2, 0], r: [r, 0, 0] })));
    }
    case 'pedestal': {
      // one column (two on long tables) on a flat foot
      const xs = W > 0.7 ? [-W * 0.55, W * 0.55] : [0];
      return xs.flatMap((x) => [cyl(x, 0.03, 0, size ? size / 2 : 0.05, top, c, metal), box(x - 0.08, 0, -D * 0.7, x + 0.08, 0.03, D * 0.7, c, metal)]);
    }
    case 'panel':
      return [-W + 0.02, W - 0.02 - 2 * t].map((x) => rbox(x, 0, -D + 0.04, x + 2 * t, top, D - 0.04, 0.005, c));
    default:
      return [
        [-W + 0.06, -D + 0.06],
        [W - 0.06, -D + 0.06],
        [-W + 0.06, D - 0.06],
        [W - 0.06, D - 0.06],
      ].map(([x, z]) => leg(x, z, top, size ? size / 2 : 0.028, c));
  }
}

/** Prisms over a plan polygon (cached by outline); plan y becomes the model's z. */
const prismCache = new Map<string, THREE.BufferGeometry>();
function prism(poly: Vec2[], height: number): THREE.BufferGeometry {
  const key = poly.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';') + `|${height.toFixed(3)}`;
  let g = prismCache.get(key);
  if (!g) {
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, -p.y)));
    g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false }).rotateX(-Math.PI / 2);
    prismCache.set(key, g);
    if (prismCache.size > 2000) {
      const first = prismCache.keys().next().value!;
      prismCache.get(first)?.dispose();
      prismCache.delete(first);
    }
  }
  return g;
}

/** Turning stairs (#335): one block per tread of the shared stair layout, landings solid down to the floor. */
function turningStairParts(shape: string, w: number, d: number, h: number, color: string, grain: Partial<Part>): Part[] {
  const layout = stairLayout(shape, w, d, h);
  if (!layout) return [];
  const rise = layout.treads.length > 0 ? layout.treads[0].top : h;
  const parts: Part[] = [];
  for (const t of layout.treads) {
    const y0 = polygonArea(t.poly) > 0.5 ? 0 : Math.max(0, t.top - rise * 2.2);
    parts.push({ geo: prism(t.poly, t.top - 0.03 - y0), p: [0, y0, 0], s: [1, 1, 1], color: shade(color, 0.92) });
    parts.push({ geo: prism(t.poly, 0.03), p: [0, t.top - 0.03, 0], s: [1, 1, 1], color, ...grain });
  }
  if (shape.startsWith('stairs-spiral')) {
    parts.push(cyl(0, 0, 0, 0.05, h + 0.9, METAL, { metal: 0.8, rough: 0.3 }));
  }
  return parts;
}

function shapeParts(shape: string, w: number, d: number, h: number, color: string, accent?: string, look: ProceduralLook = {}): Part[] {
  if (shape.startsWith('stairs-')) return turningStairParts(shape, w, d, h, color, { detail: 'woodgrain', detailRepeat: 1 });
  const W = w / 2;
  const D = d / 2;
  const front = accent ?? color;
  const frame = look.secondary;
  const fabric: Partial<Part> = { rough: 0.95, detail: 'fabric', detailRepeat: 3 };
  const grain: Partial<Part> = { detail: 'woodgrain', detailRepeat: 1 };
  const legs4 = (top: number, inset: number, r: number, c = WOOD) =>
    [
      [-W + inset, -D + inset],
      [W - inset, -D + inset],
      [-W + inset, D - inset],
      [W - inset, D - inset],
    ].map(([x, z]) => leg(x, z, top, r, c));

  switch (shape) {
    case 'sofa':
    case 'armchair': {
      const legH = 0.08;
      const seatTop = look.seatHeight ? Math.min(look.seatHeight, h - 0.1) : Math.min(0.45, h * 0.55);
      const arm = Math.min(0.2, w * 0.13);
      const backD = Math.min(0.24, d * 0.27);
      const baseTop = seatTop - 0.16;
      const parts: Part[] = [
        rbox(-W, legH, -D, W, baseTop, D, 0.03, shade(color, 0.85), fabric),
        rbox(-W, legH, -D, W, h - 0.04, -D + backD * 0.6, 0.04, shade(color, 0.9), fabric),
        rbox(-W, legH, -D, -W + arm, seatTop + 0.17, D, 0.06, color, fabric),
        rbox(W - arm, legH, -D, W, seatTop + 0.17, D, 0.06, color, fabric),
        ...legs4(legH, 0.07, 0.022, frame ?? '#2f2a26'),
      ];
      const inner = w - 2 * arm;
      const n = shape === 'armchair' ? 1 : Math.max(2, Math.round(inner / 0.65));
      const cw = inner / n;
      for (let i = 0; i < n; i++) {
        const x0 = -W + arm + i * cw;
        // seat cushion
        parts.push(rbox(x0 + 0.005, baseTop, -D + backD * 0.6, x0 + cw - 0.005, seatTop, D - 0.01, 0.05, color, fabric));
        // back cushion, slightly reclined
        parts.push({ ...rbox(x0 + 0.01, seatTop - 0.02, -D + backD * 0.55, x0 + cw - 0.01, h + 0.01, -D + backD * 0.55 + 0.17, 0.06, color, fabric), r: [-0.12, 0, 0] });
      }
      return parts;
    }
    case 'sofa-corner': {
      const seatTop = 0.45;
      const back = Math.min(0.24, d * 0.15);
      const chaise = Math.min(0.95, w * 0.4);
      const sd = Math.min(0.95, d * 0.55);
      return [
        rbox(-W, 0.08, -D, W, seatTop - 0.15, -D + sd, 0.03, shade(color, 0.85), fabric),
        rbox(W - chaise, 0.08, -D, W, seatTop - 0.15, D, 0.03, shade(color, 0.85), fabric),
        rbox(-W + 0.18, seatTop - 0.15, -D + back, W - chaise, seatTop, -D + sd - 0.01, 0.05, color, fabric),
        rbox(W - chaise + 0.005, seatTop - 0.15, -D + back, W - back, seatTop, D - 0.01, 0.05, color, fabric),
        rbox(-W, 0.08, -D, W, h, -D + back, 0.05, color, fabric),
        rbox(W - back, 0.08, -D, W, h, D, 0.05, color, fabric),
        rbox(-W, 0.08, -D, -W + 0.18, seatTop + 0.17, -D + sd, 0.06, color, fabric),
        ...[-W + 0.08, W - 0.08].map((x) => leg(x, -D + 0.08, 0.08, 0.02, frame ?? '#2f2a26')),
        leg(W - 0.08, D - 0.08, 0.08, 0.02, frame ?? '#2f2a26'),
      ];
    }
    case 'bed': {
      const frameTop = 0.32;
      const mattress = 0.22;
      const headD = 0.08;
      const parts: Part[] = [
        rbox(-W, 0.06, -D + headD, W, frameTop, D, 0.02, color, fabric),
        rbox(-W, 0.05, -D, W, h, -D + headD, 0.04, shade(color, 0.92), fabric),
        rbox(-W + 0.03, frameTop, -D + headD + 0.01, W - 0.03, frameTop + mattress, D - 0.03, 0.06, '#f5f3ee', fabric),
        // duvet over the lower two thirds, slightly overhanging
        rbox(-W + 0.01, frameTop + mattress - 0.06, -D + headD + 0.55, W - 0.01, frameTop + mattress + 0.05, D - 0.01, 0.05, '#e6e1d8', fabric),
        ...legs4(0.06, 0.06, 0.025, WOOD),
      ];
      const pillows = w > 1.2 ? 2 : 1;
      const pw = (w - 0.16) / pillows;
      for (let i = 0; i < pillows; i++) {
        const x0 = -W + 0.08 + i * pw;
        parts.push(rbox(x0 + 0.02, frameTop + mattress - 0.01, -D + headD + 0.06, x0 + pw - 0.02, frameTop + mattress + 0.13, -D + headD + 0.46, 0.06, '#ffffff', fabric));
      }
      return parts;
    }
    case 'table':
    case 'desk': {
      const top = look.topThickness ?? 0.035;
      const parts: Part[] = [rbox(-W, h - top, -D, W, h, D, Math.min(0.008, top / 3), color, { rough: 0.45, ...grain, textured: true })];
      const base = look.base ?? (shape === 'desk' ? 'panel' : 'legs4');
      parts.push(...tableBase(base, W, D, h - top, frame ?? shade(color, shape === 'desk' ? 0.9 : 0.85), look.legSize));
      if (shape === 'desk') parts.push(box(-W + 0.06, h - top - 0.12, -D + 0.04, W - 0.06, h - top, -D + 0.06, shade(color, 0.9)));
      return parts;
    }
    case 'table-round': {
      const r = Math.min(w, d) / 2;
      const c = frame ?? shade(color, 0.8);
      const top = look.topThickness ?? 0.035;
      const parts: Part[] = [cyl(0, h - top, 0, r, h, color, { rough: 0.45, ...grain, textured: true })];
      if (look.base === 'legs4' || look.base === 'x') {
        const k = r * 0.55;
        for (const [x, z] of [[-k, -k], [k, -k], [-k, k], [k, k]]) parts.push(leg(x, z, h - top, look.legSize ? look.legSize / 2 : 0.026, c));
      } else parts.push(cyl(0, 0.03, 0, look.legSize ? look.legSize / 2 : 0.045, h - top, c), cyl(0, 0, 0, r * 0.4, 0.03, c));
      return parts;
    }
    case 'chair': {
      const seat = look.seatHeight ? Math.min(look.seatHeight, h - 0.1) : 0.47; // top of the seat
      const r = look.legSize ? look.legSize / 2 : 0.016;
      return [
        rbox(-W + 0.01, seat - 0.05, -D + 0.02, W - 0.01, seat, D, 0.02, color, { rough: 0.6 }),
        { ...rbox(-W + 0.02, seat + 0.03, -D, W - 0.02, h, -D + 0.03, 0.015, color, { rough: 0.6 }), r: [-0.08, 0, 0] },
        ...legs4(seat - 0.04, 0.035, r, frame ?? shade(color, 0.85)),
        ...[-W + 0.035, W - 0.035].map((x) => box(x - 0.014, seat - 0.04, -D + 0.01, x + 0.014, h - 0.08, -D + 0.035, frame ?? shade(color, 0.85))),
      ];
    }
    case 'office-chair':
      return [
        rbox(-W * 0.75, 0.45, -D * 0.7, W * 0.75, 0.53, D * 0.75, 0.04, color, fabric),
        { ...rbox(-W * 0.68, 0.58, -D * 0.78, W * 0.68, h, -D * 0.62, 0.05, color, fabric), r: [-0.1, 0, 0] },
        cyl(0, 0.08, 0, 0.025, 0.45, METAL, { metal: 0.8, rough: 0.3 }),
        ...[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return { ...box(-0.015, 0.05, 0, 0.015, 0.075, W * 0.9, BLACK), p: [Math.sin(a) * W * 0.45, 0.06, Math.cos(a) * W * 0.45] as V3, s: [0.03, 0.025, W * 0.9] as V3, r: [0, a, 0] as V3 };
        }),
      ];
    case 'stool':
      return [cyl(0, h - 0.05, 0, Math.min(w, d) / 2, h, color, fabric), cyl(0, 0, 0, 0.025, h - 0.05, METAL, { metal: 0.8, rough: 0.3 }), cyl(0, 0, 0, Math.min(w, d) * 0.4, 0.02, METAL, { metal: 0.8 })];
    case 'wardrobe':
    case 'k-tall': {
      const plinth = 0.06;
      const doors = Math.max(1, Math.round(w / 0.5));
      const parts: Part[] = [box(-W, plinth, -D, W, h, D - 0.02, shade(color, 0.96)), box(-W + 0.02, 0, -D + 0.02, W - 0.02, plinth, D - 0.06, '#3a3a3a')];
      for (let i = 0; i < doors; i++) {
        const x0 = -W + (i * w) / doors + 0.002;
        const x1 = -W + ((i + 1) * w) / doors - 0.002;
        parts.push(rbox(x0, plinth + 0.002, D - 0.02, x1, h - 0.002, D, 0.003, front, { rough: 0.5 }));
        const hx = i % 2 === 0 ? x1 - 0.05 : x0 + 0.05;
        parts.push(rbox(hx - 0.006, h * 0.45, D, hx + 0.006, h * 0.45 + 0.28, D + 0.025, 0.005, METAL, { metal: 0.85, rough: 0.3 }));
      }
      return parts;
    }
    case 'shelf': {
      const t = 0.018;
      const n = Math.max(2, Math.round(h / 0.36));
      const parts: Part[] = [box(-W, 0, -D, -W + t, h, D, color), box(W - t, 0, -D, W, h, D, color), box(-W, 0, -D, W, h, -D + 0.006, shade(color, 0.92))];
      const bookColors = ['#7b3f2f', '#2f4b6b', '#b59a5b', '#3f5f45', '#8c8c8c', '#a35d3c'];
      // wide shelves (e.g. a 4×4 cube shelf) get vertical dividers, one cell about every 37 cm
      const cols = w >= 1 ? Math.max(2, Math.round((w - t) / 0.37)) : 1;
      const cell = (w - t) / cols;
      for (let c = 1; c < cols; c++) parts.push(box(-W + c * cell, t, -D, -W + c * cell + t, h - t, D, color));
      const booksEnd = cols > 1 ? -W + cell - 0.01 : -W + t + (w - 2 * t) * 0.65;
      for (let i = 0; i <= n; i++) {
        const y = Math.min(h - t, (i * (h - t)) / n);
        parts.push(box(-W + t, y, -D, W - t, y + t, D, color));
        if (i < n && i % 2 === 0) {
          // a few books for scale and realism
          let x = -W + t + 0.02;
          let k = i;
          while (x < W - t - 0.06 && x < booksEnd - 0.03) {
            const bw = 0.025 + ((k * 7) % 5) * 0.006;
            const bh = Math.min(0.3, (h - t) / n - t - 0.02) * (0.75 + ((k * 3) % 4) * 0.07);
            parts.push(box(x, y + t, -D + 0.03, x + bw, y + t + bh, Math.min(D - 0.01, -D + 0.03 + d * 0.8), bookColors[k % bookColors.length], { rough: 0.8 }));
            x += bw + 0.002;
            k++;
          }
        }
      }
      return parts;
    }
    case 'cabinet':
    case 'dresser':
    case 'k-base':
    case 'k-wall':
    case 'k-sink':
    case 'k-dishwasher': {
      const isKitchenFloor = shape === 'k-base' || shape === 'k-sink' || shape === 'k-dishwasher';
      const plinth = isKitchenFloor ? 0.1 : shape === 'k-wall' ? 0 : 0.05;
      const parts: Part[] = [box(-W, plinth, -D, W, h, D - 0.02, shade(color, 0.96))];
      if (plinth > 0) {
        if (shape === 'cabinet' || shape === 'dresser') parts.push(...legs4(plinth, 0.04, 0.015, BLACK));
        else parts.push(box(-W + 0.01, 0, -D, W - 0.01, plinth, D - 0.07, '#333333'));
      }
      const drawers = shape === 'dresser' ? 4 : 0;
      if (drawers > 0) {
        for (let i = 0; i < drawers; i++) {
          const y0 = plinth + ((h - plinth) * i) / drawers + 0.002;
          const y1 = plinth + ((h - plinth) * (i + 1)) / drawers - 0.002;
          parts.push(rbox(-W + 0.002, y0, D - 0.02, W - 0.002, y1, D, 0.003, front, { rough: 0.5 }));
          parts.push(rbox(-0.08, (y0 + y1) / 2 - 0.006, D, 0.08, (y0 + y1) / 2 + 0.006, D + 0.02, 0.004, METAL, { metal: 0.85, rough: 0.3 }));
        }
      } else {
        const doors = Math.max(1, Math.round(w / 0.6));
        for (let i = 0; i < doors; i++) {
          const x0 = -W + (i * w) / doors + 0.002;
          const x1 = -W + ((i + 1) * w) / doors - 0.002;
          parts.push(rbox(x0, plinth + 0.002, D - 0.02, x1, h - 0.002, D, 0.003, front, { rough: 0.5 }));
          const hy = shape === 'k-wall' ? plinth + 0.05 : h - 0.06;
          parts.push(rbox((x0 + x1) / 2 - 0.08, hy, D, (x0 + x1) / 2 + 0.08, hy + 0.012, D + 0.02, 0.004, METAL, { metal: 0.85, rough: 0.3 }));
        }
      }
      if (shape === 'k-sink') {
        // basin and tap above the cabinet (countertop is generated separately)
        parts.push(rbox(-W * 0.6, h + 0.035, -D * 0.4, W * 0.6, h + 0.045, D * 0.55, 0.02, '#c9ccd0', { metal: 0.7, rough: 0.25 }));
        parts.push(cyl(0, h + 0.04, -D * 0.6, 0.018, h + 0.32, METAL, { metal: 0.9, rough: 0.2 }));
        parts.push(box(-0.012, h + 0.3, -D * 0.6, 0.012, h + 0.325, -D * 0.6 + 0.2, METAL, { metal: 0.9, rough: 0.2 }));
      }
      return parts;
    }
    case 'k-oven':
      return [
        box(-W, 0.1, -D, W, h, D - 0.02, color),
        box(-W + 0.01, 0, -D, W - 0.01, 0.1, D - 0.07, '#333333'),
        rbox(-W + 0.01, 0.12, D - 0.02, W - 0.01, h - 0.2, D, 0.005, '#121314', { rough: 0.08, metal: 0.4 }),
        box(-W + 0.01, h - 0.19, D - 0.02, W - 0.01, h - 0.01, D, '#2e2e30'),
        { geo: CYL, p: [0, h - 0.25, D + 0.025], s: [0.02, w - 0.16, 0.02], r: [0, 0, Math.PI / 2], color: METAL, metal: 0.9, rough: 0.2 },
      ];
    case 'k-cooktop':
      return [
        rbox(-W, 0, -D, W, Math.max(0.006, Math.min(h, 0.01)), D, 0.003, '#0e0f10', { rough: 0.06, metal: 0.2 }),
        ...[[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]].map(([x, z]) => cyl(x * w, 0.0, z * d, Math.min(w, d) * 0.16, 0.0105, '#2a2b2d', { rough: 0.3 })),
      ];
    case 'k-fridge':
      return [
        rbox(-W, 0, -D, W, h, D - 0.02, 0.02, color, { rough: 0.3, metal: 0.2 }),
        rbox(-W + 0.003, h * 0.62, D - 0.025, W - 0.003, h - 0.003, D, 0.015, color, { rough: 0.3 }),
        rbox(-W + 0.003, 0.01, D - 0.025, W - 0.003, h * 0.62 - 0.006, D, 0.015, color, { rough: 0.3 }),
        rbox(W - 0.06, h * 0.68, D, W - 0.045, h * 0.9, D + 0.03, 0.006, METAL, { metal: 0.9 }),
        rbox(W - 0.06, h * 0.4, D, W - 0.045, h * 0.58, D + 0.03, 0.006, METAL, { metal: 0.9 }),
      ];
    case 'k-hood':
      return [rbox(-W, 0, -D, W, 0.08, D, 0.01, color, { metal: 0.7, rough: 0.3 }), box(-0.14, 0.08, -D, 0.14, h, -D + 0.25, color, { metal: 0.7, rough: 0.3 })];
    case 'countertop':
      return [rbox(-W, 0, -D, W, h, D, 0.004, color, { rough: 0.3 })];
    case 'washer':
      return [
        rbox(-W, 0, -D, W, h, D, 0.02, color),
        { geo: CYL_Z, p: [0, h * 0.45, D + 0.01], s: [0.36, 0.36, 0.03], color: '#a0a8b0', rough: 0.15, metal: 0.4 },
        box(-W + 0.02, h - 0.1, D, W - 0.02, h - 0.02, D + 0.005, '#d0d4d8'),
      ];
    case 'floor-lamp':
      return [
        cyl(0, 0, 0, Math.min(w, d) * 0.4, 0.025, BLACK, { metal: 0.5, rough: 0.4 }),
        cyl(0, 0.025, 0, 0.011, h - 0.3, BLACK, { metal: 0.6 }),
        { geo: CONE, p: [0, h - 0.17, 0], s: [Math.min(w, d), 0.34, Math.min(w, d)], color: '#f3ead8', emissive: '#ffd9a3', doubleSide: true },
      ];
    case 'table-lamp':
      return [cyl(0, 0, 0, Math.min(w, d) * 0.28, h * 0.55, color, { rough: 0.3 }), { geo: CONE, p: [0, h * 0.77, 0], s: [Math.min(w, d), h * 0.46, Math.min(w, d)], color: '#f3ead8', emissive: '#ffd9a3', doubleSide: true }];
    case 'pendant':
      return [cyl(0, h * 0.4, 0, 0.003, h, BLACK), { geo: CONE, p: [0, h * 0.2, 0], s: [Math.min(w, d), h * 0.4, Math.min(w, d)], color, emissive: '#ffd9a3', doubleSide: true }];
    case 'rug':
      return [rbox(-W, 0, -D, W, Math.max(0.008, h), D, 0.004, color, { rough: 1, detail: 'carpet', detailRepeat: 4 })];
    case 'curtain':
      return [
        { geo: curtainGeometry(w, h - 0.03, Math.max(0.04, d)), p: [0, (h - 0.03) / 2 + 0.01, 0], s: [1, 1, 1], color, rough: 1, doubleSide: true, detail: 'fabric', detailRepeat: 4 },
        cyl(0, h - 0.015, 0, 0.012, h, METAL, { metal: 0.8, r: [0, 0, Math.PI / 2] }),
        { geo: CYL, p: [0, h - 0.015, 0], s: [0.024, w + 0.1, 0.024], r: [0, 0, Math.PI / 2], color: METAL, metal: 0.8, rough: 0.3 },
      ];
    case 'plant': {
      const r = Math.min(w, d) / 2;
      const potH = Math.min(0.38, h * 0.3);
      const parts: Part[] = [
        { geo: TAPER, p: [0, potH / 2, 0], s: [r * 1.2, potH, r * 1.2], color: '#c7b8a5', rough: 0.85 },
        cyl(0, potH - 0.02, 0, r * 0.55, potH - 0.005, '#3b2b20', { rough: 1 }),
      ];
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + i * 0.7;
        const t = i / n;
        const y = potH + (h - potH) * (0.25 + 0.7 * ((i * 5) % n) / n);
        const rr = r * (0.35 + 0.45 * t);
        const s = r * (0.7 + 0.25 * ((i * 3) % 4) / 3);
        parts.push({ geo: LEAF, p: [Math.cos(a) * rr, Math.min(h - s / 2, y), Math.sin(a) * rr], s: [s, s * 0.8, s], color: i % 2 ? color : shade(color, 0.8), rough: 0.9 });
      }
      parts.push(cyl(0, potH, 0, 0.01, h * 0.75, '#4a3a24'));
      return parts;
    }
    case 'picture': {
      // framed print (#350): thin frame, light mat, a simple two-tone motif in the item colour
      const f = Math.min(0.03, w / 12, h / 12);
      const m = Math.min(0.06, w / 8, h / 8);
      return [
        rbox(-W, 0, -D, W, h, D, 0.004, '#2f2a26', { rough: 0.6 }),
        box(-W + f, f, D - 0.004, W - f, h - f, D + 0.001, '#f4f1ea', { rough: 0.9 }),
        box(-W + f + m, f + m, D, W - f - m, h - f - m, D + 0.002, color, { rough: 0.85 }),
        box(-W + f + m, f + m, D + 0.001, W - f - m, f + m + (h - 2 * (f + m)) * 0.42, D + 0.003, shade(color, 0.72), { rough: 0.85 }),
      ];
    }
    case 'wall-shelf': {
      // floating board with a few objects on it
      const t = 0.025;
      const parts: Part[] = [rbox(-W, 0, -D, W, t, D, 0.004, color, { detail: 'woodgrain', detailRepeat: 1 })];
      const objs = Math.max(1, Math.floor(w / 0.25));
      for (let i = 0; i < objs; i++) {
        const x = -W + ((i + 0.5) * w) / objs;
        parts.push(i % 2 ? cyl(x, t, 0, Math.min(0.05, D * 0.6), Math.min(h, t + 0.16), '#d9cbb8', { rough: 0.4 }) : box(x - 0.08, t, -D + 0.02, x + 0.08, Math.min(h, t + 0.2), D - 0.04, ['#7b3f2f', '#2f4b6b', '#3f5f45'][i % 3], { rough: 0.8 }));
      }
      return parts;
    }
    case 'coat-rack': {
      const parts: Part[] = [rbox(-W, 0, -D, W, Math.min(h, 0.09), -D + 0.025, 0.004, color, { detail: 'woodgrain', detailRepeat: 1 })];
      const hooks = Math.max(2, Math.round(w / 0.16));
      for (let i = 0; i < hooks; i++) {
        const x = -W + ((i + 0.5) * w) / hooks;
        parts.push(box(x - 0.008, 0.03, -D + 0.025, x + 0.008, 0.05, D, BLACK, { metal: 0.6 }));
      }
      return parts;
    }
    case 'mattress':
      return [
        rbox(-W, 0, -D, W, h, D, 0.05, color, { rough: 0.95, detail: 'fabric', detailRepeat: 3 }),
        rbox(-W + 0.01, h - 0.05, -D + 0.5, W - 0.01, h + 0.04, D - 0.01, 0.04, '#e6e1d8', { rough: 0.95, detail: 'fabric', detailRepeat: 3 }),
      ];
    case 'vacuum':
      // stick vacuum in its wall holder
      return [
        box(-W * 0.85, 0, -D, W * 0.85, 0.06, D * 0.6, shade(color, 0.8)),
        cyl(0, 0.06, 0, 0.015, h - 0.25, METAL, { metal: 0.8, rough: 0.3 }),
        rbox(-0.06, h - 0.3, -0.06, 0.06, h - 0.05, 0.08, 0.02, color),
        box(-W * 0.4, h - 0.12, -D, W * 0.4, h - 0.08, -D + 0.03, BLACK),
      ];
    case 'tv':
      return [rbox(-W, 0, -D, W, h, D, 0.006, '#0b0b0c', { rough: 0.2, metal: 0.3 }), box(-W + 0.008, 0.008, D, W - 0.008, h - 0.008, D + 0.001, '#141b25', { rough: 0.05 })];
    case 'panel':
      return [rbox(-W, 0, -D, W, h, D, 0.01, color, { rough: 0.04, metal: 0.95 })];
    case 'toilet':
      return [
        { geo: SPHERE, p: [0, 0.38, D * 0.15], s: [w * 0.95, 0.3, d * 0.75], color: '#ffffff', rough: 0.15 },
        rbox(-W, 0.25, -D, W, 0.4, -D + 0.18, 0.04, '#ffffff', { rough: 0.15 }),
        rbox(-W * 0.9, 0.84, -D + 0.02, W * 0.9, 0.87, -D + 0.1, 0.01, '#e5e7eb'),
        rbox(-W, 0.4, -D, W, h, -D + 0.12, 0.02, '#f3f4f6', { rough: 0.3 }),
      ];
    case 'washbasin':
      // a low basin (wall-hung or countertop bowl, no vanity unit): only bowl and tap
      if (h < 0.6)
        return [
          rbox(-W, 0, -D, W, h, D, Math.min(0.03, h / 3), '#ffffff', { rough: 0.12 }),
          rbox(-W * 0.8, h - 0.002, -D * 0.7, W * 0.8, h + 0.001, D * 0.7, 0.03, '#dfe5ea', { rough: 0.1 }),
          cyl(0, h, -D * 0.8, 0.015, h + 0.15, METAL, { metal: 0.9, rough: 0.2 }),
        ];
      return [
        rbox(-W, 0.35, -D, W, h - 0.15, D - 0.02, 0.01, '#e9e3da'),
        rbox(-W, h - 0.15, -D, W, h, D, 0.03, '#ffffff', { rough: 0.12 }),
        rbox(-W * 0.6, h - 0.002, -D * 0.4, W * 0.6, h + 0.001, D * 0.6, 0.03, '#dfe5ea', { rough: 0.1 }),
        cyl(0, h, -D * 0.6, 0.015, h + 0.15, METAL, { metal: 0.9, rough: 0.2 }),
      ];
    case 'bathtub':
      return [rbox(-W, 0, -D, W, h, D, 0.06, '#ffffff', { rough: 0.12 }), rbox(-W + 0.07, h - 0.4, -D + 0.07, W - 0.07, h + 0.001, D - 0.07, 0.12, '#e7eef2', { rough: 0.1 })];
    case 'stairs': {
      // straight flight (#54): rises from the front (+z) to the back (−z), one block per step, a rail on the right
      const n = stepCount(h);
      const rise = h / n;
      const run = d / n;
      const parts: Part[] = [];
      for (let i = 0; i < n; i++) {
        const z1 = D - i * run;
        const top = (i + 1) * rise;
        parts.push(box(-W, Math.max(0, top - rise * 2.2), z1 - run, W, top - 0.03, z1, shade(color, 0.92)));
        parts.push(box(-W, top - 0.03, z1 - run - 0.02, W, top, z1, color, grain));
      }
      const len = Math.hypot(d, h);
      const tilt = Math.atan2(h, d);
      parts.push({ geo: BOX, p: [W - 0.03, h / 2 + 0.9, 0], s: [0.04, 0.04, len], r: [tilt, 0, 0], color: METAL, metal: 0.8, rough: 0.3 });
      parts.push(cyl(W - 0.03, rise, D - run / 2, 0.02, rise + 0.9, METAL, { metal: 0.8, rough: 0.3 }));
      parts.push(cyl(W - 0.03, h, -D + run / 2, 0.02, h + 0.9, METAL, { metal: 0.8, rough: 0.3 }));
      return parts;
    }
    case 'shower':
      return [
        rbox(-W, 0, -D, W, 0.05, D, 0.01, '#ffffff', { rough: 0.2 }),
        box(-W, 0.05, D - 0.01, W, h, D, '#cfe3ea', { opacity: 0.25, rough: 0.05 }),
        box(W - 0.01, 0.05, -D, W, h, D, '#cfe3ea', { opacity: 0.25, rough: 0.05 }),
        cyl(-W + 0.12, h - 0.1, -D + 0.12, 0.1, h - 0.08, METAL, { metal: 0.9 }),
      ];
    default:
      return [rbox(-W, 0, -D, W, h, D, Math.min(0.01, w / 10, d / 10, h / 10), color)];
  }
}

/** Shapes that emit light; in realism mode they get a real point light (with shadows within the lamp budget, #130). */
export const LIGHT_SHAPES = new Set(['floor-lamp', 'table-lamp', 'pendant']);

export const ProceduralModel = memo(function ProceduralModel({
  shape,
  width,
  depth,
  height,
  color,
  accent,
  finish,
  look,
  interior,
  quality,
  castShadow,
  lamp,
}: {
  shape: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  accent?: string;
  finish?: FurnitureFinish;
  look?: ProceduralLook;
  /** Cabinet shown open with this inner layout (#85). */
  interior?: Interior;
  quality: QualityMode;
  castShadow: boolean;
  /** Lamps (#420): luminous flux, colour temperature and switch; absent = a typical warm 800 lm bulb, on. */
  lamp?: LampSpec;
}) {
  const { secondary, base, topThickness, legSize, seatHeight, texture } = look ?? {};
  const photo = usePhotoTexture(texture);
  const parts = useMemo(
    () =>
      interior
        ? openCabinetParts(width, depth, height, color, interior, accent)
        : buildParts(shape, width, depth, height, color, accent, finish, { secondary, base, topThickness, legSize, seatHeight }),
    [shape, width, depth, height, color, accent, finish, secondary, base, topThickness, legSize, seatHeight, interior],
  );
  const light = lampLight(lamp ?? DEFAULT_LAMP);
  const lampY = shape === 'pendant' ? height * 0.15 : shape === 'table-lamp' ? height * 0.7 : height - 0.2;
  const materials = useMemo(
    () =>
      parts.map((p) => {
        // the product photo on the main surface (#273); without it the plain colour material
        if (p.textured && photo) return new THREE.MeshStandardMaterial({ map: photo, roughness: p.rough ?? 0.6, metalness: 0 });
        // a lamp's shade glows in the colour of its light, and not at all while the lamp is switched off
        const emissive = p.emissive && lamp ? (lamp.on ? light.glow : undefined) : p.emissive;
        const m = getColorMaterial(p.color, quality, { roughness: p.rough, metalness: p.metal, emissive, opacity: p.opacity, doubleSide: p.doubleSide, detail: p.detail, detailRepeat: p.detailRepeat });
        // in realism mode, glowing shades follow the lamp switch / time of day
        if (emissive && quality === 'realism') registerLampShade(m);
        return m;
      }),
    [parts, quality, photo, lamp, light.glow],
  );
  return (
    <group>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geo}
          position={p.p}
          scale={p.s}
          rotation={p.r ?? [0, 0, 0]}
          material={materials[i]}
          castShadow={castShadow && (p.opacity ?? 1) === 1 && !p.emissive}
          receiveShadow={quality === 'realism'}
        />
      ))}
      {quality === 'realism' && LIGHT_SHAPES.has(shape) && (lamp?.on ?? true) && <LampBulb y={lampY} intensity={light.intensity} distance={light.distance} color={light.color} />}
    </group>
  );
});

/** A product photo crop as texture; null while loading or without one. */
function usePhotoTexture(url: string | undefined): THREE.Texture | null {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      loaded = t;
      if (alive) setTex(t);
      else t.dispose();
    });
    return () => {
      alive = false;
      loaded?.dispose();
      setTex(null);
    };
  }, [url]);
  return url ? tex : null;
}

/** The light of a lamp; its brightness follows the lamp switch / time of day, its shadow keeps it out of neighbouring rooms. */
function LampBulb({ y, intensity, distance, color }: { y: number; intensity: number; distance: number; color: string }) {
  const ref = useRef<THREE.PointLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    const offLight = registerLampLight(l, intensity);
    return offLight;
  }, [intensity]);
  useEffect(() => {
    const l = ref.current;
    return l ? registerShadowLamp(l) : undefined;
  }, []);
  return <pointLight ref={ref} position={[0, y, 0]} color={color} intensity={0} distance={distance} decay={2} />;
}

const DEFAULT_LAMP: LampSpec = { lumen: 800, kelvin: 2700, on: true };
