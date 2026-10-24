/**
 * Turns Claude's recorded answers of the first trial (`fixtures/recorded/`, prototype format in
 * room cm) into `RoomProgram`s, so the solver can be tested on realistic programmes before the
 * parser of stage 2 (mgritsch04/wohnungsplaner-3d#439) exists. Deliberately lenient: words
 * outside the vocabulary are mapped (next-to, against, under …), the existing WC that Claude
 * listed again is mapped to the existing piece, relations it cannot read are left out.
 * For tests and the benchmark only; the app uses the stage-2 parser.
 */
import { findCatalogItem } from '../../catalog/generic';
import { fromRoomCm, parseSide, rotationForSide } from '../coords';
import type { RawProgram } from '../fixtures/recorded';
import type { ProgramItem, Relation, RoomAnalysis, RoomProgram } from '../types';
import { shapeOf } from '../../suggest/roomGeometry';
import type { FixedPiece } from './room';

const SANITARY = ['toilet', 'shower', 'bathtub', 'washbasin'];
const REQUIRED_ROLES = new Set(['bed', 'sofa', 'desk', 'wardrobe']);

export function programFromRecorded(raw: RawProgram, room: RoomAnalysis, existing: FixedPiece[]): RoomProgram {
  const cm = (x: number, y: number) => fromRoomCm(room.origin, x, y);
  const shapeOfId = (catalogId: string) => {
    const it = findCatalogItem(catalogId);
    return it ? shapeOf(it) : '';
  };
  // existing sanitary pieces by shape, and the names Claude used for them
  const existingByShape = new Map(existing.map((e) => [shapeOfId(e.catalogId), e.id]));
  const alias = new Map<string, string>();
  for (const [shape, id] of existingByShape) {
    alias.set(shape, id);
    alias.set(`${shape}-existing`, id);
    if (shape === 'washbasin') for (const k of ['basin-existing', 'basin']) alias.set(k, id);
    if (shape === 'toilet') for (const k of ['wc', 'wc-existing']) alias.set(k, id);
  }
  const items: ProgramItem[] = [];
  for (const it of raw.items) {
    const shape = shapeOfId(it.catalogId);
    if (SANITARY.includes(shape) && existingByShape.has(shape)) {
      alias.set(it.id, existingByShape.get(shape)!);
      continue;
    }
    const side = parseSide(it.facing) ?? 'S';
    const p = cm(it.x, it.y);
    const cat = findCatalogItem(it.catalogId);
    const role = cat ? (cat.category === 'bed' && shape === 'bed' ? 'bed' : cat.category === 'sofa' && shape === 'sofa' ? 'sofa' : cat.category === 'desk' ? 'desk' : shape === 'wardrobe' ? 'wardrobe' : '') : '';
    items.push({
      id: it.id,
      catalogId: it.catalogId,
      zone: it.zone,
      hint: { x: p.x, y: p.y, rotation: rotationForSide(side) },
      label: it.label,
      color: it.color,
      why: it.why,
      ...(REQUIRED_ROLES.has(role) ? { required: true } : {}),
    });
  }
  const ids = new Set(items.map((i) => i.id));
  const target = (s: string) => alias.get(s) ?? s;
  const walls = new Map(room.walls.map((w) => [w.id, w]));
  const hintOf = (id: string) => items.find((i) => i.id === id)?.hint;
  const windowOn = (wallId: string, near: { x: number; y: number } | undefined): string | null => {
    const w = walls.get(wallId);
    if (!w) return null;
    const wins = w.openings.filter((o) => o.kind === 'window' && !o.passable);
    if (!wins.length) return null;
    if (!near) return wins[0].id;
    const t = (near.x - w.a.x) * w.dir.x + (near.y - w.a.y) * w.dir.y;
    return wins.reduce((a, b) => (Math.abs((a.t0 + a.t1) / 2 - t) <= Math.abs((b.t0 + b.t1) / 2 - t) ? a : b)).id;
  };
  const relations: Relation[] = [];
  const around = new Map<string, string[]>();
  const isChair = (id: string) => findCatalogItem(items.find((i) => i.id === id)?.catalogId ?? '')?.category === 'chair';
  const isTable = (id: string) => ['table', 'desk'].includes(findCatalogItem(items.find((i) => i.id === id)?.catalogId ?? '')?.category ?? '');
  const isCurtain = (id: string) => shapeOfId(items.find((i) => i.id === id)?.catalogId ?? '') === 'curtain';
  for (const r of raw.relations) {
    const [a, kindRaw, bRaw, val] = r as [string, string, string | undefined, string | number | undefined];
    if (!ids.has(a)) continue;
    const b = bRaw === undefined ? undefined : target(String(bRaw));
    const num = typeof val === 'number' ? val / 100 : undefined;
    const kind = kindRaw.toLowerCase();
    const isWall = b !== undefined && walls.has(b);
    const known = b !== undefined && (ids.has(b) || existing.some((e) => e.id === b) || b === 'kitchen');
    if (isCurtain(a) && isWall) {
      const w = windowOn(b!, hintOf(a));
      if (w) relations.push({ kind: 'window', item: a, window: w, place: 'over' });
      continue;
    }
    if (isChair(a) && b && isTable(b) && ['front-of', 'next-to', 'left-of', 'right-of', 'beside', 'around'].includes(kind) && !findCatalogItem(items.find((i) => i.id === a)!.catalogId)?.name.includes('Büro')) {
      around.set(b, [...(around.get(b) ?? []), a]);
      continue;
    }
    switch (kind) {
      case 'wall':
      case 'against':
      case 'on-wall':
      case 'centered-on':
        if (isWall) relations.push({ kind: 'wall', item: a, wall: b! });
        break;
      case 'corner': {
        const c = (r as string[])[3];
        if (isWall && typeof c === 'string' && walls.has(c)) relations.push({ kind: 'corner', item: a, walls: [b!, c] });
        else if (isWall) relations.push({ kind: 'wall', item: a, wall: b! });
        break;
      }
      case 'on':
        if (isWall) {
          const w = windowOn(b!, hintOf(a));
          if (w) relations.push({ kind: 'on', item: a, target: w });
        } else if (known) relations.push({ kind: 'on', item: a, target: b! });
        break;
      case 'above':
        if (known) relations.push({ kind: 'above', item: a, target: b!, ...(num !== undefined ? { height: num } : {}) });
        break;
      case 'under':
      case 'under-all':
        if (known) relations.push({ kind: 'under-all', item: a, target: b! });
        break;
      case 'under-front':
        if (known) relations.push({ kind: 'under-front', item: a, target: b! });
        break;
      case 'front-of':
      case 'left-of':
      case 'right-of':
        if (known) relations.push({ kind, item: a, target: b!, ...(num !== undefined ? { gap: num } : {}) });
        break;
      case 'facing':
        if (known) relations.push({ kind: 'facing', item: a, target: b!, ...(num !== undefined ? { distance: num } : {}) });
        break;
      case 'next-to':
      case 'beside':
      case 'near':
        if (known) relations.push({ kind: 'near', item: a, target: b!, max: num !== undefined ? num + 0.6 : 1.0 });
        break;
      case 'away':
        if (known) relations.push({ kind: 'away', item: a, target: b!, ...(num !== undefined ? { min: num } : {}) });
        break;
      case 'center':
        relations.push({ kind: 'center', item: a });
        break;
      default:
        break;
    }
  }
  for (const [table, chairs] of around) relations.unshift({ kind: 'around', items: chairs, target: table });
  const zones = raw.zones.map((z) => {
    const p0 = cm(z.rect[0], z.rect[1]);
    const p1 = cm(z.rect[2], z.rect[3]);
    return { id: z.id, function: z.function, rect: { x0: Math.min(p0.x, p1.x), y0: Math.min(p0.y, p1.y), x1: Math.max(p0.x, p1.x), y1: Math.max(p0.y, p1.y) }, why: z.why };
  });
  // one run in the first trial, a list of runs with the prompts of concept/
  const runs = raw.kitchen ? [raw.kitchen].flat() : [];
  const kitchen = runs.length ? runs.map((k) => ({ wall: k.wall, from: cm(k.from[0], k.from[1]), to: cm(k.to[0], k.to[1]), modules: k.modules })) : undefined;
  return { roomId: room.roomId, reading: raw.reading, zones, items, relations, ...(kitchen ? { kitchen } : {}), walk: raw.walk, check: raw.check };
}
