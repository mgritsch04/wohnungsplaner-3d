/**
 * Synthetic room programmes for solver tests (#440): a template per room kind with Claude-like
 * relations and random start places. Used where no recorded Claude answer exists (random rooms,
 * test flats C–F). Not used by the app.
 */
import type { ProgramItem, Relation, RoomAnalysis, RoomProgram } from '../types';
import { Rng } from './rng';

export type Kind = 'living' | 'bedroom' | 'dining' | 'office' | 'hall' | 'kitchen';

export const TEMPLATES: Record<Kind, { items: [string, string, boolean?][]; relations: (ids: Set<string>) => Relation[] }> = {
  living: {
    items: [['sofa', 'generic-sofa-3', true], ['coffee', 'generic-coffee-table'], ['rug', 'generic-rug-200'], ['armchair', 'generic-armchair'], ['tvboard', 'generic-tv-sideboard'], ['tv', 'generic-tv'], ['shelf', 'generic-shelf-80'], ['plant', 'generic-plant'], ['lamp', 'generic-floor-lamp'], ['pendant', 'generic-pendant']],
    relations: () => [
      { kind: 'front-of', item: 'coffee', target: 'sofa', gap: 0.45 },
      { kind: 'under-front', item: 'rug', target: 'sofa' },
      { kind: 'above', item: 'tv', target: 'tvboard' },
      { kind: 'facing', item: 'tvboard', target: 'sofa', distance: 2.2 },
      { kind: 'right-of', item: 'lamp', target: 'armchair' },
      { kind: 'above', item: 'pendant', target: 'coffee' },
    ],
  },
  bedroom: {
    items: [['bed', 'generic-bed-160', true], ['ns1', 'generic-nightstand'], ['ns2', 'generic-nightstand'], ['l1', 'generic-table-lamp'], ['l2', 'generic-table-lamp'], ['wardrobe', 'generic-wardrobe-150', true], ['rug', 'generic-rug-200'], ['art', 'generic-picture-large'], ['plant', 'generic-plant']],
    relations: () => [
      { kind: 'pair', item: 'ns1', item2: 'ns2', target: 'bed' },
      { kind: 'on', item: 'l1', target: 'ns1' },
      { kind: 'on', item: 'l2', target: 'ns2' },
      { kind: 'under-all', item: 'rug', target: 'bed' },
      { kind: 'above', item: 'art', target: 'bed' },
    ],
  },
  dining: {
    items: [['table', 'generic-dining-table-4', true], ['c1', 'generic-chair'], ['c2', 'generic-chair'], ['c3', 'generic-chair'], ['c4', 'generic-chair'], ['pendant', 'generic-pendant'], ['sideboard', 'generic-sideboard'], ['lamp', 'generic-table-lamp'], ['art', 'generic-picture'], ['plant', 'generic-plant']],
    relations: () => [
      { kind: 'around', items: ['c1', 'c2', 'c3', 'c4'], target: 'table' },
      { kind: 'above', item: 'pendant', target: 'table' },
      { kind: 'on', item: 'lamp', target: 'sideboard' },
      { kind: 'above', item: 'art', target: 'sideboard' },
      { kind: 'center', item: 'table' },
    ],
  },
  hall: {
    items: [['shoes', 'generic-shoe-cabinet'], ['coat', 'generic-coat-rack'], ['mirror', 'generic-mirror'], ['runner', 'generic-runner'], ['pendant', 'generic-pendant'], ['lamp', 'generic-table-lamp']],
    relations: () => [
      { kind: 'on', item: 'lamp', target: 'shoes' },
      { kind: 'near', item: 'coat', target: 'shoes', max: 1.2 },
    ],
  },
  kitchen: {
    items: [['table', 'generic-dining-table-4', true], ['c1', 'generic-chair'], ['c2', 'generic-chair'], ['c3', 'generic-chair'], ['c4', 'generic-chair'], ['pendant', 'generic-pendant'], ['herbs', 'generic-plant-small']],
    relations: () => [
      { kind: 'around', items: ['c1', 'c2', 'c3', 'c4'], target: 'table' },
      { kind: 'above', item: 'pendant', target: 'table' },
    ],
  },
  office: {
    items: [['desk', 'generic-desk', true], ['chair', 'generic-office-chair'], ['dlamp', 'generic-table-lamp'], ['shelf1', 'generic-shelf-80'], ['shelf2', 'generic-shelf-80'], ['sofa', 'generic-sofa-2'], ['plant', 'generic-plant'], ['rug', 'generic-rug-160']],
    relations: () => [
      { kind: 'front-of', item: 'chair', target: 'desk', gap: 0 },
      { kind: 'on', item: 'dlamp', target: 'desk' },
      { kind: 'align', items: ['shelf1', 'shelf2'] },
      { kind: 'under-front', item: 'rug', target: 'sofa' },
    ],
  },
};

export function randomProgram(a: RoomAnalysis, kind: Kind, seed: number): RoomProgram {
  const rng = new Rng(seed * 13 + 5);
  const xs = a.polygon.map((p) => p.x);
  const ys = a.polygon.map((p) => p.y);
  const rect = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  const t = TEMPLATES[kind];
  const items: ProgramItem[] = t.items.map(([id, catalogId, required]) => ({
    id,
    catalogId,
    zone: 'z',
    hint: { x: rect.x0 + (rect.x1 - rect.x0) * rng.next(), y: rect.y0 + (rect.y1 - rect.y0) * rng.next(), rotation: (Math.floor(rng.next() * 4) * Math.PI) / 2 },
    why: 'Zufall',
    ...(required ? { required: true } : {}),
  }));
  const program: RoomProgram = { roomId: a.roomId, reading: '', zones: [{ id: 'z', function: kind, rect, why: '' }], items, relations: t.relations(new Set(items.map((i) => i.id))), walk: '', check: [] };
  if (kind === 'kitchen') {
    // a straight run on the longest wall without openings
    const wall = [...a.walls].filter((w) => !w.openings.length && w.length >= 2.5).sort((p, q) => q.length - p.length)[0];
    if (wall) {
      const at = (t: number) => ({ x: wall.a.x + wall.dir.x * t, y: wall.a.y + wall.dir.y * t });
      // a short wall does without the dishwasher, never without worktop
      const modules = wall.length >= 3.3 ? ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-oven', 'generic-k-drawer-60'] : ['generic-k-fridge', 'generic-k-sink-80', 'generic-k-drawer-60', 'generic-k-oven'];
      program.kitchen = [{ wall: wall.id, from: at(0), to: at(wall.length), modules }];
    }
  }
  return program;
}

