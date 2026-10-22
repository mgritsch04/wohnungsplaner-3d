import type { Furniture, Interior, InteriorPart } from './schema';

/** Board thickness (m) of a cabinet carcass and its shelves. */
export const BOARD = 0.02;
/** Shapes whose inner layout can be planned (#85). */
export const INTERIOR_SHAPES: ReadonlySet<string> = new Set(['wardrobe', 'cabinet', 'dresser']);

/** Minimum sizes (m) behind the checks; rough rules of thumb, not a standard. */
export const INTERIOR_MIN = {
  drawerHeight: 0.1,
  drawerColumnWidth: 0.3,
  drawerDepth: 0.35,
  rodColumnWidth: 0.4,
  rodDepth: 0.45,
  /** free hanging length below the rod (short jackets, shirts) */
  rodHang: 0.6,
  /** free space above the rod for the hanger hook */
  rodAbove: 0.05,
  /** clear height between two shelves / a shelf and a drawer */
  gap: 0.15,
} as const;

export const DEFAULT_DRAWER_HEIGHT = 0.2;

export type InteriorIssueKind = 'range' | 'overlap' | 'gap' | 'drawer-height' | 'drawer-width' | 'drawer-depth' | 'rod-width' | 'rod-depth' | 'rod-hang';
export interface InteriorIssue {
  kind: InteriorIssueKind;
  /** index into `interior.parts` */
  part: number;
  message: string;
}

type Dims = Pick<Furniture, 'width' | 'depth' | 'height'>;

export const supportsInterior = (shape: string): boolean => INTERIOR_SHAPES.has(shape);

/** Clear height inside the carcass (between bottom and top board). */
export const innerHeight = (f: Dims): number => Math.max(0.05, f.height - 2 * BOARD);

/** Clear width of one column (between the side/divider boards). */
export function columnWidth(f: Dims, columns: number): number {
  return (f.width - BOARD * (columns + 1)) / columns;
}

/** Vertical extent (m above the inner floor) a part occupies. */
export function partSpan(p: InteriorPart): [number, number] {
  if (p.kind === 'drawer') return [p.z, p.z + (p.h ?? DEFAULT_DRAWER_HEIGHT)];
  if (p.kind === 'shelf') return [p.z, p.z + BOARD];
  return [p.z - 0.02, p.z + 0.02];
}

const cm = (m: number) => `${Math.round(m * 100)} cm`;

/** Checks the layout against the minimum sizes and against itself. */
export function checkInterior(f: Dims, interior: Interior): InteriorIssue[] {
  const issues: InteriorIssue[] = [];
  const add = (kind: InteriorIssueKind, part: number, message: string) => issues.push({ kind, part, message });
  const cw = columnWidth(f, interior.columns);
  const top = innerHeight(f);
  const label = (p: InteriorPart, i: number) => `${p.kind === 'drawer' ? 'Schublade' : p.kind === 'shelf' ? 'Fachboden' : 'Kleiderstange'} ${i + 1}`;
  interior.parts.forEach((p, i) => {
    const [lo, hi] = partSpan(p);
    if (p.column >= interior.columns) add('range', i, `${label(p, i)} liegt in einer Spalte, die es nicht gibt.`);
    if (lo < -1e-6 || hi > top + 1e-6) add('range', i, `${label(p, i)} ragt aus dem Schrank (innen ${cm(top)} hoch).`);
    if (p.kind === 'drawer') {
      if ((p.h ?? DEFAULT_DRAWER_HEIGHT) < INTERIOR_MIN.drawerHeight) add('drawer-height', i, `${label(p, i)} ist zu niedrig (mindestens ${cm(INTERIOR_MIN.drawerHeight)}).`);
      if (cw < INTERIOR_MIN.drawerColumnWidth) add('drawer-width', i, `${label(p, i)}: Spalte nur ${cm(cw)} breit (mindestens ${cm(INTERIOR_MIN.drawerColumnWidth)}).`);
      if (f.depth < INTERIOR_MIN.drawerDepth) add('drawer-depth', i, `${label(p, i)}: Schrank nur ${cm(f.depth)} tief (mindestens ${cm(INTERIOR_MIN.drawerDepth)}).`);
    }
    if (p.kind === 'rod') {
      if (cw < INTERIOR_MIN.rodColumnWidth) add('rod-width', i, `${label(p, i)}: Spalte nur ${cm(cw)} breit (mindestens ${cm(INTERIOR_MIN.rodColumnWidth)}).`);
      if (f.depth < INTERIOR_MIN.rodDepth) add('rod-depth', i, `${label(p, i)}: Schrank nur ${cm(f.depth)} tief, Bügel stoßen an die Tür (mindestens ${cm(INTERIOR_MIN.rodDepth)}).`);
      // free hanging length: from the rod down to the next shelf/drawer below (or the floor)
      const below = Math.max(0, ...interior.parts.filter((q) => q !== p && q.column === p.column && q.kind !== 'rod' && partSpan(q)[1] <= p.z).map((q) => partSpan(q)[1]));
      const blocked = interior.parts.some((q) => q !== p && q.column === p.column && q.kind !== 'rod' && partSpan(q)[0] < p.z + INTERIOR_MIN.rodAbove && partSpan(q)[1] > p.z);
      if (blocked) add('rod-hang', i, `${label(p, i)}: Fachboden oder Schublade direkt an der Stange, oben braucht sie ${cm(INTERIOR_MIN.rodAbove)} Luft.`);
      else if (p.z - below < INTERIOR_MIN.rodHang) add('rod-hang', i, `${label(p, i)}: Darunter sind nur ${cm(p.z - below)} frei (Hängelänge mindestens ${cm(INTERIOR_MIN.rodHang)}).`);
    }
  });
  // solid parts (shelf/drawer) in one column: no overlap, enough air between neighbours
  for (let c = 0; c < interior.columns; c++) {
    const solid = interior.parts.map((p, i) => ({ p, i })).filter((x) => x.p.column === c && x.p.kind !== 'rod').sort((a, b) => a.p.z - b.p.z);
    for (let k = 1; k < solid.length; k++) {
      const prev = partSpan(solid[k - 1].p);
      const cur = partSpan(solid[k].p);
      if (cur[0] < prev[1] - 1e-6) add('overlap', solid[k].i, `${label(solid[k].p, solid[k].i)} überschneidet sich mit ${label(solid[k - 1].p, solid[k - 1].i)}.`);
      else if (cur[0] - prev[1] < INTERIOR_MIN.gap - 1e-6 && cur[0] - prev[1] > 1e-6) add('gap', solid[k].i, `Zwischen ${label(solid[k - 1].p, solid[k - 1].i)} und ${label(solid[k].p, solid[k].i)} bleiben nur ${cm(cur[0] - prev[1])} (mindestens ${cm(INTERIOR_MIN.gap)}).`);
    }
  }
  return issues;
}

export type InteriorPreset = 'wardrobe' | 'shelves' | 'rod';
export const INTERIOR_PRESETS: { id: InteriorPreset; label: string }[] = [
  { id: 'wardrobe', label: 'Kleiderschrank (Stange, Fächer, Schubladen)' },
  { id: 'shelves', label: 'Nur Fächer' },
  { id: 'rod', label: 'Nur Kleiderstange' },
];

const round = (v: number) => Math.round(v * 1000) / 1000;

/** A sensible starting layout for the cabinet's size; every part passes `checkInterior` as far as the size allows. */
export function presetInterior(f: Dims, preset: InteriorPreset): Interior {
  const top = innerHeight(f);
  const parts: InteriorPart[] = [];
  const shelvesIn = (column: number, from: number, to: number, spacing = 0.32) => {
    const n = Math.max(0, Math.floor((to - from) / spacing));
    for (let i = 1; i <= n; i++) parts.push({ kind: 'shelf', column, z: round(from + (i * (to - from)) / (n + 1)) });
  };
  if (preset === 'rod') {
    parts.push({ kind: 'rod', column: 0, z: round(Math.max(INTERIOR_MIN.rodHang, top - 0.08)) });
    return { columns: 1, parts };
  }
  if (preset === 'shelves') {
    const columns = Math.max(1, Math.min(4, Math.round(f.width / 0.5)));
    for (let c = 0; c < columns; c++) shelvesIn(c, 0, top);
    return { columns, parts };
  }
  const columns = f.width >= 0.9 ? 2 : 1;
  // column 0: long rod with a shelf on top; last column: shelves and drawers at the bottom
  const rodZ = round(Math.max(INTERIOR_MIN.rodHang, top - 0.08));
  parts.push({ kind: 'rod', column: 0, z: rodZ });
  if (columns === 1) {
    parts.push({ kind: 'shelf', column: 0, z: round(Math.max(0, top - 0.5)) });
    parts.splice(0, 1, { kind: 'rod', column: 0, z: round(Math.max(INTERIOR_MIN.rodHang, top - 0.58)) });
    return { columns, parts };
  }
  const last = columns - 1;
  const drawerH = 0.2;
  const nDrawers = top >= 1.5 ? 2 : 1;
  for (let i = 0; i < nDrawers; i++) parts.push({ kind: 'drawer', column: last, z: round(i * drawerH), h: drawerH });
  shelvesIn(last, nDrawers * drawerH, top);
  return { columns, parts };
}

/** Number of shelves, drawers and rods (for the summary line). */
export function summarizeInterior(interior: Interior): { shelves: number; drawers: number; rods: number } {
  const count = (k: InteriorPart['kind']) => interior.parts.filter((p) => p.kind === k).length;
  return { shelves: count('shelf'), drawers: count('drawer'), rods: count('rod') };
}
