/**
 * Relations of a room programme (stage 2): Claude writes them as short lists
 * `[item, relation, target, value?]` with values in cm; the parser turns them into the closed
 * vocabulary of `Relation` (../types.ts). Words outside the vocabulary that Claude still uses
 * („next-to“, „beside“, „against“ …) are mapped by what the target is (a piece, a wall, a window);
 * what cannot be mapped is dropped with a note, Claude's start place still holds the idea.
 */
import type { Vec2 } from '../../model/vec';
import { add, dist, dot, scale, sub } from '../../model/vec';
import type { Relation, RelationKind, WallInfo } from '../types';
import { num, str, type Thing } from './common';

/** Relation words Claude may write (lower case, spaces and underscores as „-“) → what they mean. */
const WORDS: Record<string, RelationKind | 'next-to' | 'under' | 'around-one'> = {
  wall: 'wall',
  against: 'wall',
  'against-wall': 'wall',
  'on-wall': 'wall',
  'at-wall': 'wall',
  'back-to-wall': 'wall',
  'centered-on': 'wall',
  wand: 'wall',
  'an-wand': 'wall',
  corner: 'corner',
  'in-corner': 'corner',
  ecke: 'corner',
  center: 'center',
  centre: 'center',
  centered: 'center',
  'centered-in': 'center',
  middle: 'center',
  mitte: 'center',
  'front-of': 'front-of',
  'in-front-of': 'front-of',
  before: 'front-of',
  vor: 'front-of',
  'left-of': 'left-of',
  'links-von': 'left-of',
  'right-of': 'right-of',
  'rechts-von': 'right-of',
  'next-to': 'next-to',
  beside: 'next-to',
  besides: 'next-to',
  neben: 'next-to',
  by: 'next-to',
  adjacent: 'next-to',
  'adjacent-to': 'next-to',
  flank: 'flank',
  'end-of': 'flank',
  stirnseite: 'flank',
  pair: 'pair',
  'both-sides': 'pair',
  flanking: 'pair',
  facing: 'facing',
  faces: 'facing',
  opposite: 'facing',
  'opposite-of': 'facing',
  gegenüber: 'facing',
  around: 'around-one',
  'at-table': 'around-one',
  um: 'around-one',
  above: 'above',
  over: 'above',
  über: 'above',
  'hangs-above': 'above',
  'centered-above': 'above',
  'under-front': 'under-front',
  'under-all': 'under-all',
  under: 'under',
  unter: 'under',
  on: 'on',
  'on-top-of': 'on',
  'on-sill': 'on',
  auf: 'on',
  window: 'window',
  'at-window': 'window',
  'by-window': 'window',
  'am-fenster': 'window',
  near: 'near',
  'close-to': 'near',
  nahe: 'near',
  bei: 'near',
  away: 'away',
  'away-from': 'away',
  'far-from': 'away',
  align: 'align',
  aligned: 'align',
  'in-line': 'align',
  flush: 'align',
  bündig: 'align',
};

const WINDOW_PLACES: Record<string, 'beside' | 'front' | 'over'> = { beside: 'beside', neben: 'beside', seitlich: 'beside', front: 'front', vor: 'front', davor: 'front', over: 'over', über: 'over', 'davor-hängend': 'over' };

/** A programme piece as far as the relations need it. */
export interface RelationItem {
  thing: Thing;
  /** Start place (plan coordinates, rotation as `Furniture.rotation`). */
  hint?: { x: number; y: number; rotation: number };
}

export interface RelationContext {
  items: ReadonlyMap<string, RelationItem>;
  walls: readonly WallInfo[];
  /** Furniture already in the room (by id) with its place: targets only through the wall it stands at. */
  existing: ReadonlyMap<string, { x: number; y: number; width: number; depth: number; rotation: number }>;
  /** Zone ids of the programme (`center` may name the zone instead of the piece's own). */
  zones: ReadonlySet<string>;
  /** Room coordinates: (0,0) of the cm values. */
  origin: Vec2;
  /** Targets that are not pieces but still mean something (the room, the kitchen run, a zone): the relation is dropped with a note. */
  loose?: ReadonlySet<string>;
}

export interface ParsedRelations {
  relations: Relation[];
  problems: string[];
  notes: string[];
}

const front = (rotation: number): Vec2 => ({ x: -Math.sin(rotation), y: Math.cos(rotation) });

const isCurtain = (t: Thing) => t.shape === 'curtain';
const isSeat = (t: Thing) => t.category === 'chair' || t.shape === 'stool';
const isTable = (t: Thing) => t.category === 'table';
const lying = (t: Thing) => t.category === 'bed' || t.shape === 'bed' || (t.category === 'table' && t.height >= 0.6);

/** Cm value → m; null when absent or not a number. */
const metres = (v: unknown): number | undefined => {
  const n = num(v);
  return n === null ? undefined : n / 100;
};

function show(raw: unknown): string {
  try {
    return JSON.stringify(raw).slice(0, 160);
  } catch {
    return String(raw);
  }
}

/**
 * Turns Claude's relation lists into `Relation`s. Accepts `[a, word, b, value?]` (values in cm,
 * `corner` with two walls, `pair` as [a, "pair", b, target], `wall` with an optional stretch
 * [a, "wall", "W2", from, to] in room cm along the wall) and objects already in the `Relation`
 * shape (distances in m). Several `[chair, "around", table]` become one `around`; `align` lists
 * that share a piece are joined.
 */
export function parseRelations(raw: unknown, ctx: RelationContext): ParsedRelations {
  const out: Relation[] = [];
  const problems: string[] = [];
  const notes: string[] = [];
  const around = new Map<string, string[]>();
  const aligns: string[][] = [];
  const wallById = new Map(ctx.walls.map((w) => [w.id, w]));
  const windowWall = new Map(ctx.walls.flatMap((w) => w.openings.filter((o) => o.kind === 'window').map((o) => [o.id, w] as const)));
  const doors = new Set(ctx.walls.flatMap((w) => w.openings.filter((o) => o.kind !== 'window').map((o) => o.id)));
  const label = (s: unknown) => str(s, 60);
  const isItem = (s: string) => ctx.items.has(s);
  const isWall = (s: string) => wallById.has(s.toUpperCase());
  const isWindow = (s: string) => windowWall.has(s.toUpperCase());
  const isDoor = (s: string) => doors.has(s.toUpperCase());
  const isCorner = (s: string) => /^E\d+$/i.test(s) && Number(s.slice(1)) >= 1 && Number(s.slice(1)) <= ctx.walls.length;

  /** Window of a wall that is closest to the piece's start place (or the only one). */
  const windowOn = (wallId: string, item: string): string | null => {
    const w = wallById.get(wallId.toUpperCase());
    const wins = w?.openings.filter((o) => o.kind === 'window') ?? [];
    if (!w || !wins.length) return null;
    const hint = ctx.items.get(item)?.hint;
    if (!hint || wins.length === 1) return wins[0].id;
    const at = (o: (typeof wins)[number]) => add(w.a, scale(w.dir, (o.t0 + o.t1) / 2));
    return wins.reduce((best, o) => (dist(at(o), hint) < dist(at(best), hint) ? o : best)).id;
  };

  /** Wall an existing piece stands with its back against: the one nearest to its centre. */
  const wallOfExisting = (id: string): WallInfo | null => {
    const e = ctx.existing.get(id);
    if (!e || !ctx.walls.length) return null;
    const off = (w: WallInfo) => Math.abs(dot(sub(e, w.a), w.inward));
    return ctx.walls.reduce((best, w) => (off(w) < off(best) ? w : best));
  };

  /** Wall relation over the stretch an existing piece takes up along its wall (mirror over the fitted washbasin). */
  const overExisting = (item: string, id: string): Relation | null => {
    const w = wallOfExisting(id);
    const e = ctx.existing.get(id);
    if (!w || !e) return null;
    const t = dot(sub(e, w.a), w.dir);
    const half = Math.abs(dot(front(e.rotation), w.dir)) > 0.7 ? e.depth / 2 : e.width / 2;
    const p = (s: number) => add(w.a, scale(w.dir, Math.max(0, Math.min(w.length, s))));
    return { kind: 'wall', item, wall: w.id, along: { from: p(t - half), to: p(t + half) } };
  };

  /** Stretch [from, to] in room cm along a wall (x for walls running east–west, y otherwise). */
  const stretch = (w: WallInfo, a: unknown, b: unknown): { from: Vec2; to: Vec2 } | undefined => {
    const v0 = num(a);
    const v1 = num(b);
    if (v0 === null || v1 === null) return undefined;
    const horiz = Math.abs(w.dir.x) >= Math.abs(w.dir.y);
    const t = (v: number) => {
      const target = (horiz ? ctx.origin.x : ctx.origin.y) + v / 100;
      const base = horiz ? w.a.x : w.a.y;
      const d = horiz ? w.dir.x : w.dir.y;
      return Math.max(0, Math.min(w.length, (target - base) / d));
    };
    const [s0, s1] = [t(v0), t(v1)].sort((x, y) => x - y);
    if (s1 - s0 < 0.05) return undefined;
    return { from: add(w.a, scale(w.dir, s0)), to: add(w.a, scale(w.dir, s1)) };
  };

  /** Left or right of `target` as seen from its front, from the two start places; null without them. */
  const sideOf = (item: string, target: string): 'left-of' | 'right-of' | null => {
    const a = ctx.items.get(item)?.hint;
    const b = ctx.items.get(target)?.hint;
    if (!a || !b) return null;
    const f = front(b.rotation);
    return dot(sub(a, b), { x: f.y, y: -f.x }) >= 0 ? 'left-of' : 'right-of';
  };

  const drop = (r: unknown, why: string) => notes.push(`Beziehung ${show(r)} weggelassen: ${why}`);

  const list = Array.isArray(raw) ? raw : [];
  if (raw !== undefined && !Array.isArray(raw)) problems.push('"relations" muss eine Liste sein.');
  for (const r of list.slice(0, 200)) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const rel = fromObject(r as Record<string, unknown>);
      if (rel) out.push(rel);
      continue;
    }
    if (!Array.isArray(r) || r.length < 2) {
      problems.push(`Beziehung ${show(r)} hat nicht die Form [Teil, Beziehung, Ziel, Wert].`);
      continue;
    }
    const item = label(r[0]);
    const word = str(r[1], 40).toLowerCase().replace(/[\s_]+/g, '-');
    const kind = WORDS[word];
    const target = label(r[2]);
    if (!kind) {
      drop(r, `„${str(r[1], 40)}“ gehört nicht zum Vokabular`);
      continue;
    }
    if (!isItem(item)) {
      problems.push(`Beziehung ${show(r)}: „${item}“ ist kein Teil in "items".`);
      continue;
    }
    const thing = ctx.items.get(item)!.thing;
    const unknownTarget = () => problems.push(`Beziehung ${show(r)}: Ziel „${target}“ ist weder ein Teil in "items" noch eine Wand, ein Fenster oder Bestand dieses Raums.`);
    const known = isItem(target) || isWall(target) || isWindow(target) || isDoor(target) || ctx.existing.has(target) || isCorner(target);

    // targets that are not pieces: walls, windows, doors, corners, existing pieces
    if (!isItem(target) && kind !== 'center' && kind !== 'align') {
      if (!known) {
        if (ctx.zones.has(target) || ctx.loose?.has(target.toLowerCase())) drop(r, `„${target}“ ist kein Teil, der Startplatz bleibt`);
        else unknownTarget();
        continue;
      }
      if (isDoor(target)) {
        drop(r, 'Beziehungen zu Türen kennt der Aufsteller nicht (der Startplatz bleibt)');
        continue;
      }
      if (isCorner(target)) {
        const k = Number(target.slice(1));
        out.push({ kind: 'corner', item, walls: [ctx.walls[k - 1].id, ctx.walls[k % ctx.walls.length].id] });
        continue;
      }
      if (kind === 'corner') {
        const other = label(r[3]);
        if (isWall(target) && isWall(other)) {
          const i = ctx.walls.findIndex((w) => w.id === target.toUpperCase());
          const k = ctx.walls.findIndex((w) => w.id === other.toUpperCase());
          const n = ctx.walls.length;
          if ((i + 1) % n === k || (k + 1) % n === i) out.push({ kind: 'corner', item, walls: [ctx.walls[i].id, ctx.walls[k].id] });
          else {
            out.push({ kind: 'wall', item, wall: ctx.walls[i].id });
            notes.push(`Beziehung ${show(r)}: ${target} und ${other} bilden keine Ecke, als Wand ${target} übernommen.`);
          }
        } else if (isWall(target)) {
          out.push({ kind: 'wall', item, wall: target.toUpperCase() });
          notes.push(`Beziehung ${show(r)}: Ecke mit „${other}“ als Wand ${target} übernommen.`);
        } else if (ctx.existing.has(target)) {
          const w = wallOfExisting(target);
          if (w) out.push({ kind: 'wall', item, wall: w.id });
          notes.push(`Beziehung ${show(r)}: Ecke am Bestand als Wand ${w?.id ?? '?'} übernommen.`);
        } else drop(r, 'Ecke ohne zwei Wände');
        continue;
      }
      if (ctx.existing.has(target)) {
        const rel = kind === 'above' || kind === 'on' ? overExisting(item, target) : (() => {
          const w = wallOfExisting(target);
          return w ? ({ kind: 'wall', item, wall: w.id } as Relation) : null;
        })();
        if (rel) {
          out.push(rel);
          notes.push(`Beziehung ${show(r)}: Bestand „${target}“ ist kein Programm-Teil, als Wand ${(rel as { wall: string }).wall} übernommen.`);
        } else drop(r, 'Bestand ohne Wand');
        continue;
      }
      const win = isWindow(target) ? target.toUpperCase() : null;
      const wall = isWall(target) ? target.toUpperCase() : windowWall.get(target.toUpperCase())!.id;
      if (kind === 'window' || win || (isCurtain(thing) && windowOn(wall, item))) {
        const w = win ?? windowOn(wall, item);
        if (!w) {
          out.push({ kind: 'wall', item, wall });
          notes.push(`Beziehung ${show(r)}: Wand ${wall} hat kein Fenster, als Wand übernommen.`);
          continue;
        }
        if (kind === 'on') {
          out.push({ kind: 'on', item, target: w });
          continue;
        }
        const place = WINDOW_PLACES[str(r[3], 20).toLowerCase()] ?? (isCurtain(thing) || kind === 'above' ? 'over' : kind === 'front-of' ? 'front' : 'beside');
        out.push({ kind: 'window', item, window: w, place });
        continue;
      }
      if (kind === 'on') {
        const w = windowOn(wall, item);
        if (w) out.push({ kind: 'on', item, target: w });
        else drop(r, `auf Wand ${wall} ohne Fenster`);
        continue;
      }
      // a wall as target: back against that wall, optionally over a stretch
      const along = kind === 'wall' ? stretch(wallById.get(wall)!, r[3], r[4]) : undefined;
      out.push({ kind: 'wall', item, wall, ...(along ? { along } : {}) });
      if (kind !== 'wall') notes.push(`Beziehung ${show(r)}: als Wand ${wall} übernommen.`);
      continue;
    }

    switch (kind) {
      case 'wall':
      case 'next-to': {
        const t = ctx.items.get(target)!.thing;
        if (isSeat(thing) && isTable(t)) around.set(target, [...(around.get(target) ?? []), item]);
        else {
          const side = sideOf(item, target);
          const gap = metres(r[3]);
          out.push(side ? { kind: side, item, target, ...(gap !== undefined ? { gap } : {}) } : { kind: 'near', item, target });
          if (word !== 'left-of' && word !== 'right-of') notes.push(`Beziehung ${show(r)} als ${side ?? 'near'} übernommen.`);
        }
        break;
      }
      case 'corner':
        drop(r, 'Ecke braucht zwei Wände');
        break;
      case 'center':
        out.push({ kind: 'center', item });
        break;
      case 'front-of':
      case 'left-of':
      case 'right-of': {
        const gap = metres(r[3]);
        out.push({ kind, item, target, ...(gap !== undefined ? { gap } : {}) });
        break;
      }
      case 'flank': {
        const gap = metres(r[3]);
        const side = str(r[4], 10).toLowerCase();
        out.push({ kind: 'flank', item, target, ...(side === 'left' || side === 'right' ? { side } : {}), ...(gap !== undefined ? { gap } : {}) });
        break;
      }
      case 'pair': {
        const second = label(r[3]);
        if (isItem(second)) out.push({ kind: 'pair', item, item2: target, target: second });
        else drop(r, 'Paar braucht [Teil, "pair", zweites Teil, Mitte]');
        break;
      }
      case 'facing': {
        const distance = metres(r[3]);
        out.push({ kind: 'facing', item, target, ...(distance !== undefined ? { distance } : {}) });
        break;
      }
      case 'around-one':
        around.set(target, [...(around.get(target) ?? []), item]);
        break;
      case 'above': {
        const height = metres(r[3]);
        out.push({ kind: 'above', item, target, ...(height !== undefined ? { height } : {}) });
        break;
      }
      case 'under':
        out.push({ kind: lying(ctx.items.get(target)!.thing) ? 'under-all' : 'under-front', item, target });
        break;
      case 'under-front':
      case 'under-all':
      case 'on':
        out.push({ kind, item, target });
        break;
      case 'window':
        drop(r, 'Fenster-Beziehung braucht ein Fenster F1 …');
        break;
      case 'near': {
        const max = metres(r[3]);
        out.push({ kind: 'near', item, target, ...(max !== undefined ? { max } : {}) });
        break;
      }
      case 'away': {
        const min = metres(r[3]);
        out.push({ kind: 'away', item, target, ...(min !== undefined ? { min } : {}) });
        break;
      }
      case 'align': {
        const members = r.filter((_, i) => i !== 1).map(label).filter(isItem);
        if (members.length >= 2) aligns.push(members);
        else drop(r, 'Flucht braucht mindestens zwei Teile');
        break;
      }
    }
    if (kind === 'center' && target && !isItem(target) && target !== 'room' && !ctx.zones.has(target)) notes.push(`Beziehung ${show(r)}: „${target}“ als Zonenmitte gelesen.`);
  }

  for (const [target, items] of around) out.push({ kind: 'around', items: [...new Set(items)], target });
  for (const group of joinGroups(aligns)) out.push({ kind: 'align', items: group });
  return { relations: dedupe(out), problems, notes };

  function fromObject(o: Record<string, unknown>): Relation | null {
    const kind = str(o.kind, 30) as RelationKind;
    const ids = ['item', 'item2', 'target'].map((k) => (o[k] === undefined ? undefined : label(o[k])));
    const bad = ids.filter((id): id is string => id !== undefined && !isItem(id) && !(ids.indexOf(id) === 2 && (isWindow(id) || isWall(id))));
    const known: RelationKind[] = ['wall', 'corner', 'center', 'front-of', 'left-of', 'right-of', 'pair', 'flank', 'facing', 'around', 'above', 'under-front', 'under-all', 'on', 'window', 'near', 'away', 'align'];
    if (!known.includes(kind)) {
      drop(o, `„${kind}“ gehört nicht zum Vokabular`);
      return null;
    }
    if (bad.length) {
      problems.push(`Beziehung ${show(o)}: ${bad.map((b) => `„${b}“`).join(', ')} ist kein Teil in "items".`);
      return null;
    }
    return o as unknown as Relation;
  }
}

/** Joins lists that share a member (align A–B and B–C → A, B, C). */
function joinGroups(groups: string[][]): string[][] {
  const out: Set<string>[] = [];
  for (const g of groups) {
    const hit = out.filter((s) => g.some((x) => s.has(x)));
    const merged = new Set([...hit.flatMap((s) => [...s]), ...g]);
    for (const s of hit) out.splice(out.indexOf(s), 1);
    out.push(merged);
  }
  return out.map((s) => [...s]);
}

function dedupe(list: Relation[]): Relation[] {
  const seen = new Set<string>();
  return list.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Ids of the programme pieces a relation names (items and pieces as targets, not walls or windows). */
export function relationItems(r: Relation): string[] {
  switch (r.kind) {
    case 'around':
      return [...r.items, r.target];
    case 'align':
      return r.items;
    case 'pair':
      return [r.item, r.item2, r.target];
    case 'wall':
    case 'corner':
    case 'center':
    case 'window':
      return [r.item];
    default:
      return [r.item, r.target];
  }
}
