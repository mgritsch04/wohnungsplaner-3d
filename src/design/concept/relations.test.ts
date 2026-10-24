import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../../catalog/generic';
import { fromRoomCm, rotationForSide } from '../coords';
import type { Side } from '../types';
import { thingOf } from './common';
import { parseRelations, relationItems, type RelationContext, type RelationItem } from './relations';
import { testFlatInput } from './testFlats';

// Wohnküche of test flat B: W1 north with F1 and T1 (balcony), W2 east with F2, W3 south with T2, W4 west with T3
const flat = testFlatInput('B');
const room = flat.analysis.rooms.find((r) => r.name === 'Wohnküche')!;

function item(catalogId: string, x: number, y: number, facing: Side): RelationItem {
  return { thing: thingOf(findCatalogItem(catalogId)!), hint: { ...fromRoomCm(room.origin, x, y), rotation: rotationForSide(facing) } };
}

const items = new Map<string, RelationItem>([
  ['sofa', item('generic-sofa-3', 375, 320, 'O')],
  ['coffee', item('generic-coffee-table', 450, 320, 'W')],
  ['table', item('generic-dining-table-4', 210, 300, 'S')],
  ['chair1', item('generic-chair', 170, 250, 'S')],
  ['chair2', item('generic-chair', 250, 250, 'S')],
  ['bed', item('generic-bed-160', 300, 120, 'S')],
  ['ns1', item('generic-nightstand', 200, 30, 'S')],
  ['ns2', item('generic-nightstand', 400, 30, 'S')],
  ['rug', item('generic-rug-160', 420, 320, 'O')],
  ['rug2', item('generic-rug-200', 300, 140, 'S')],
  ['curtain', item('generic-curtain', 194, 3, 'S')],
  // north of the sofa, which faces east: on its left as seen sitting on it
  ['plant', item('generic-plant', 375, 240, 'S')],
  ['herbs', item('generic-plant-small', 190, 5, 'S')],
  ['shelf1', item('generic-shelf-80', 20, 200, 'O')],
  ['shelf2', item('generic-shelf-80', 20, 280, 'O')],
  ['shelf3', item('generic-shelf-80', 20, 360, 'O')],
  ['lamp', item('generic-table-lamp', 200, 30, 'S')],
  ['picture', item('generic-picture-large', 375, 425, 'N')],
]);

const ctx: RelationContext = {
  items,
  walls: room.walls,
  existing: new Map([['B1', { ...fromRoomCm(room.origin, 300, 410), width: 0.6, depth: 0.46, rotation: rotationForSide('N') }]]),
  zones: new Set(['essen', 'wohnen']),
  origin: room.origin,
  loose: new Set(['kitchen', 'room']),
};

const parse = (raw: unknown[]) => parseRelations(raw, ctx);

describe('parseRelations', () => {
  it('keeps relations of the vocabulary and turns cm into m', () => {
    const r = parse([
      ['coffee', 'front-of', 'sofa', 45],
      ['rug', 'under-front', 'sofa'],
      ['picture', 'above', 'sofa', 140],
      ['lamp', 'on', 'ns1'],
      ['plant', 'near', 'sofa', 80],
      ['shelf1', 'away', 'bed', 200],
      ['table', 'center'],
    ]);
    expect(r.problems).toEqual([]);
    expect(r.relations).toEqual([
      { kind: 'front-of', item: 'coffee', target: 'sofa', gap: 0.45 },
      { kind: 'under-front', item: 'rug', target: 'sofa' },
      { kind: 'above', item: 'picture', target: 'sofa', height: 1.4 },
      { kind: 'on', item: 'lamp', target: 'ns1' },
      { kind: 'near', item: 'plant', target: 'sofa', max: 0.8 },
      { kind: 'away', item: 'shelf1', target: 'bed', min: 2 },
      { kind: 'center', item: 'table' },
    ]);
  });

  it('maps next-to and beside by what the target is', () => {
    const r = parse([
      ['chair1', 'next-to', 'table'],
      ['chair2', 'beside', 'table'],
      ['plant', 'next-to', 'sofa'],
      ['herbs', 'on', 'W1'],
      ['curtain', 'beside', 'W1'],
      ['shelf1', 'against', 'W4'],
    ]);
    expect(r.problems).toEqual([]);
    expect(r.relations).toContainEqual({ kind: 'around', items: ['chair1', 'chair2'], target: 'table' });
    expect(r.relations).toContainEqual({ kind: 'left-of', item: 'plant', target: 'sofa' });
    expect(r.relations).toContainEqual({ kind: 'on', item: 'herbs', target: 'F1' });
    expect(r.relations).toContainEqual({ kind: 'window', item: 'curtain', window: 'F1', place: 'over' });
    expect(r.relations).toContainEqual({ kind: 'wall', item: 'shelf1', wall: 'W4' });
  });

  it('side of next-to comes from the start places as seen from the target', () => {
    // the sofa faces east: north of it is its left, south its right
    const sofaRight = new Map(items).set('plant', item('generic-plant', 375, 400, 'S'));
    expect(parseRelations([['plant', 'next-to', 'sofa', 10]], { ...ctx, items: sofaRight }).relations).toEqual([{ kind: 'right-of', item: 'plant', target: 'sofa', gap: 0.1 }]);
  });

  it('collects chairs around a table, joins align groups and reads pairs', () => {
    const r = parse([
      ['chair1', 'around', 'table'],
      ['chair2', 'around', 'table'],
      ['shelf1', 'align', 'shelf2'],
      ['shelf2', 'align', 'shelf3'],
      ['ns1', 'pair', 'ns2', 'bed'],
      ['rug2', 'under', 'bed'],
    ]);
    expect(r.relations).toEqual([
      { kind: 'pair', item: 'ns1', item2: 'ns2', target: 'bed' },
      { kind: 'under-all', item: 'rug2', target: 'bed' },
      { kind: 'around', items: ['chair1', 'chair2'], target: 'table' },
      { kind: 'align', items: ['shelf1', 'shelf2', 'shelf3'] },
    ]);
  });

  it('reads corners from two walls or a corner label, and a wall stretch in room cm', () => {
    const r = parse([
      ['plant', 'corner', 'W2', 'W3'],
      ['shelf3', 'corner', 'E3'],
      ['shelf1', 'wall', 'W4', 150, 400],
      ['shelf2', 'corner', 'W1', 'W3'],
    ]);
    expect(r.relations[0]).toEqual({ kind: 'corner', item: 'plant', walls: ['W2', 'W3'] });
    expect(r.relations[1]).toEqual({ kind: 'corner', item: 'shelf3', walls: ['W3', 'W4'] });
    const along = r.relations[2] as Extract<(typeof r.relations)[number], { kind: 'wall' }>;
    expect(along.wall).toBe('W4');
    const ys = [along.along!.from.y, along.along!.to.y].sort((p, q) => p - q);
    expect(ys[0]).toBeCloseTo(room.origin.y + 1.5);
    expect(ys[1]).toBeCloseTo(room.origin.y + 4);
    // W1 and W3 do not meet: kept as a wall, with a note
    expect(r.relations[3]).toEqual({ kind: 'wall', item: 'shelf2', wall: 'W1' });
    expect(r.notes.join(' ')).toContain('keine Ecke');
  });

  it('puts things above or in front of an existing piece against its wall', () => {
    const r = parse([['picture', 'above', 'B1']]);
    const rel = r.relations[0] as Extract<(typeof r.relations)[number], { kind: 'wall' }>;
    expect(rel.wall).toBe('W3');
    expect(Math.abs(rel.along!.to.x - rel.along!.from.x)).toBeCloseTo(0.6);
  });

  it('drops what the solver cannot use with a note, and asks to repair unknown ids', () => {
    const r = parse([
      ['plant', 'left-of', 'T1'],
      ['coffee', 'hugs', 'sofa'],
      ['coffee', 'front-of', 'kitchen'],
      ['ghost', 'front-of', 'sofa'],
      ['coffee', 'front-of', 'nowhere'],
      'kaputt',
    ]);
    expect(r.relations).toEqual([]);
    expect(r.notes).toHaveLength(3);
    expect(r.problems).toHaveLength(3);
    expect(r.problems[0]).toContain('„ghost“ ist kein Teil');
    expect(r.problems[1]).toContain('Ziel „nowhere“');
  });

  it('takes relations already in the Relation shape', () => {
    const r = parse([{ kind: 'facing', item: 'sofa', target: 'picture', distance: 2.1 }, { kind: 'stack', item: 'sofa' }]);
    expect(r.relations).toEqual([{ kind: 'facing', item: 'sofa', target: 'picture', distance: 2.1 }]);
    expect(r.notes).toHaveLength(1);
  });

  it('removes duplicates and names the pieces of a relation', () => {
    const r = parse([
      ['coffee', 'front-of', 'sofa', 45],
      ['coffee', 'front-of', 'sofa', 45],
    ]);
    expect(r.relations).toHaveLength(1);
    expect(relationItems({ kind: 'pair', item: 'ns1', item2: 'ns2', target: 'bed' })).toEqual(['ns1', 'ns2', 'bed']);
    expect(relationItems({ kind: 'window', item: 'curtain', window: 'F1' })).toEqual(['curtain']);
  });
});
