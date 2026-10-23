/**
 * The furnished room as text (#442): what the room image shows, for a critique without image
 * support (plan, „Textkarte“) and as a check list next to the image. Room coordinates in cm from
 * the north-west corner, as in the room sketch (`roomSketch`), which describes walls, doors and
 * windows; this text adds zones, pieces, ways and findings.
 */
import { dot, pointInPolygon, sub } from '../../model/vec';
import { checkWalkways } from '../analysis';
import { sideOfVector, toRoomCm } from '../coords';
import { toRItem, type RItem } from '../review/items';
import type { RoomAnalysis, Severity, WallInfo } from '../types';
import type { RoomPlanInput } from './roomPlan';

const cm = (m: number) => Math.round(m * 100);
const de = (v: number) => v.toFixed(1).replace('.', ',');
const SEVERITY_WORD: Record<Severity, string> = { S: 'schwer', M: 'mittel', L: 'leicht' };
/** Pieces without a front: only where they stand counts. */
const ROUND = new Set(['plant', 'floor-lamp']);
const KITCHEN_WORD: Record<string, string> = { sink: 'Spüle', cooktop: 'Kochfeld', oven: 'Backofen', fridge: 'Kühlschrank', dishwasher: 'Geschirrspüler', tall: 'Hochschrank', base: 'Unterschrank', wall: 'Oberschrank', hood: 'Dunstabzug', countertop: 'Arbeitsplatte' };

/** Wall the back of a piece stands against. */
export function againstWall(a: RoomAnalysis, i: Pick<RItem, 'x' | 'y' | 'depth' | 'front'>): WallInfo | undefined {
  return a.walls.find((w) => {
    const off = dot(sub(i, w.a), w.inward) - i.depth / 2;
    const t = dot(sub(i, w.a), w.dir);
    return Math.abs(off) < 0.1 && dot(i.front, w.inward) > 0.9 && t > -0.05 && t < w.length + 0.05;
  });
}

/** Wall a hanging piece is fixed to (picture, mirror, curtain, wall cabinet). */
function onWall(a: RoomAnalysis, i: RItem): WallInfo | undefined {
  return a.walls.find((w) => {
    const off = dot(sub(i, w.a), w.inward);
    const t = dot(sub(i, w.a), w.dir);
    return off > -0.05 && off < i.depth / 2 + 0.15 && t > -0.05 && t < w.length + 0.05;
  });
}

function facing(i: RItem): string {
  const exact = sideOfVector(i.front, 10);
  return exact ? `Front nach ${exact}` : `schräg, Front etwa nach ${sideOfVector(i.front, 45) ?? '?'}`;
}

export function roomTextMap(input: RoomPlanInput): string {
  const a = input.analysis;
  const names = input.roomNames ?? {};
  const extra = input.catalog ?? [];
  const placed = (input.layout?.items ?? []).map((i) => toRItem(i, false, extra));
  const existing = (input.existing ?? []).map((i) => toRItem(i, true, extra));
  const items = [...existing, ...placed];
  const at = (i: { x: number; y: number }) => {
    const p = toRoomCm(a.origin, i);
    return `(${p.x},${p.y})`;
  };
  const programItem = (id: string) => input.program?.items.find((x) => x.id === id);
  const nameOf = (i: RItem) => programItem(i.id)?.label ?? i.name;
  const floor = items.filter((i) => i.floor);
  const lines: string[] = [`Aufstellung in „${a.name}“ (cm ab der Nordwest-Ecke wie in der Raumskizze; Mitte des Teils, Front = wohin seine Vorderseite zeigt):`];

  const zones = input.program?.zones ?? [];
  if (zones.length) {
    lines.push('Zonen:');
    for (const z of zones) {
      const p0 = toRoomCm(a.origin, { x: Math.min(z.rect.x0, z.rect.x1), y: Math.min(z.rect.y0, z.rect.y1) });
      const p1 = toRoomCm(a.origin, { x: Math.max(z.rect.x0, z.rect.x1), y: Math.max(z.rect.y0, z.rect.y1) });
      lines.push(`- ${z.id} (${z.function}): x=${p0.x}–${p1.x}, y=${p0.y}–${p1.y}`);
    }
  }

  const describe = (i: RItem): string => {
    const head = `${i.existing ? i.name : `${i.id} (${nameOf(i)})`}, ${cm(i.width)} × ${cm(i.depth)} cm`;
    const zone = !i.existing && programItem(i.id) ? `, Zone ${i.zone}` : '';
    const parent = i.parent ? `, gehört zu ${i.parent}` : '';
    if (i.role === 'rug' || (i.category === 'textile' && i.role !== 'curtain')) return `${head}, Teppich, Mitte ${at(i)}${zone}`;
    if (i.floor && ROUND.has(i.shape)) {
      // a plant or a floor lamp has no front, only a place
      const wall = a.walls.find((w) => Math.abs(dot(sub(i, w.a), w.inward) - i.depth / 2) < 0.1 && dot(sub(i, w.a), w.dir) > -0.05 && dot(sub(i, w.a), w.dir) < w.length + 0.05);
      return `${head}, Mitte ${at(i)}${wall ? `, an ${wall.id}` : ''}${zone}${parent}`;
    }
    if (i.floor) {
      const wall = againstWall(a, i);
      return `${head}, Mitte ${at(i)}${wall ? `, Rücken an ${wall.id}` : ''}, ${facing(i)}${zone}${parent}`;
    }
    const base = (i.parent && items.find((x) => x.id === i.parent)) || floor.find((x) => x !== i && pointInPolygon(i, x.poly));
    const wall = onWall(a, i);
    const where = i.role === 'table-lamp' && base ? `steht auf ${base.existing ? base.name : base.id}` : `hängt${wall && i.role !== 'pendant' ? ` an ${wall.id}` : ''}${base ? ` über ${base.existing ? base.name : base.id}` : ''}`;
    return `${head}, ${where}, Unterkante ${cm(i.elevation)} cm, Mitte ${at(i)}${zone}`;
  };

  // kitchen modules as one run per wall, in order along it
  const kitchen = placed.filter((i) => i.kitchen && !programItem(i.id));
  const runs = new Map<string, RItem[]>();
  for (const k of kitchen) {
    const w = againstWall(a, k) ?? onWall(a, k);
    const key = w?.id ?? '?';
    runs.set(key, [...(runs.get(key) ?? []), k]);
  }
  const pieces = placed.filter((i) => !kitchen.includes(i));
  if (pieces.length || runs.size) {
    lines.push('Teile:');
    for (const i of pieces) lines.push(`- ${describe(i)}`);
    for (const [wallId, mods] of runs) {
      const w = a.walls.find((x) => x.id === wallId);
      const t = (i: RItem) => (w ? dot(sub(i, w.a), w.dir) : 0);
      const sorted = [...mods].sort((x, y) => t(x) - t(y));
      const floorMods = sorted.filter((m) => m.elevation < 0.05);
      const cooktops = mods.filter((m) => m.kitchen === 'cooktop' && m.elevation >= 0.05);
      const word = (m: RItem) => `${KITCHEN_WORD[m.kitchen!] ?? m.name}${cooktops.some((c) => pointInPolygon(c, m.poly)) ? ' mit Kochfeld' : ''} ${cm(m.width)}`;
      lines.push(`- Küchenzeile an ${wallId}: ${floorMods.map(word).join(', ')}${floorMods.length ? `, von ${at(floorMods[0])} bis ${at(floorMods[floorMods.length - 1])}` : ''}`);
    }
  }
  if (existing.length) {
    lines.push('Bestand (bleibt):');
    for (const i of existing) lines.push(`- ${describe(i)}`);
  }
  const dropped = input.layout?.dropped ?? [];
  if (dropped.length) {
    lines.push('Nicht aufgestellt:');
    for (const d of dropped) lines.push(`- ${d.id}: ${d.reason}`);
  }

  const ways = checkWalkways(
    a,
    items.filter((i) => i.obstacle).map((i) => i.poly),
  );
  if (ways.length) {
    const end = (label: string) => {
      const o = a.walls.flatMap((w) => w.openings).find((x) => x.id === label);
      if (!o) return label;
      if (o.toRoomId) return `„${names[o.toRoomId] ?? 'Nachbarraum'}“`;
      return a.entrance && label === a.mainDoor ? 'Wohnungstür' : 'ins Freie';
    };
    lines.push('Wege zwischen den Türen im eingerichteten Raum:');
    for (const w of ways) {
      const route = `${w.from} → ${w.to} (${end(w.from)} → ${end(w.to)})`;
      if (w.fits <= 0) lines.push(`- ${route}: versperrt, kein Durchkommen`);
      else if (w.fits < w.width - 1e-6) lines.push(`- ${route}: nur ${cm(w.fits)} cm breit statt ${cm(w.width)} cm`);
      else lines.push(`- ${route}: frei, ${cm(w.width)} cm breit, ${de(w.length)} m (leer ${de(w.emptyLength)} m)`);
    }
  }

  const r = input.review;
  if (r) {
    lines.push(`Begehung: ${r.score} Punkte, ${r.passed ? 'bestanden' : 'nicht bestanden'}.`);
    for (const f of r.findings) {
      const p = f.where ? toRoomCm(a.origin, f.where) : null;
      lines.push(`- [${SEVERITY_WORD[f.severity]}] ${f.rule}: ${f.text}${p ? ` (bei x=${p.x}, y=${p.y})` : ''}`);
    }
  }
  return lines.join('\n');
}
