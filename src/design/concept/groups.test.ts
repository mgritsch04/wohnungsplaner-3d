import { describe, expect, it } from 'vitest';
import type { ProgramItem, Relation, RoomProgram } from '../types';
import { COFFEE_GAP, completeGroups } from './groups';

const item = (id: string, catalogId: string, zone = 'z', extra: Partial<ProgramItem> = {}): ProgramItem => ({ id, catalogId, zone, hint: { x: 2, y: 2, rotation: 0 }, why: '', ...extra });
const program = (items: ProgramItem[], relations: Relation[] = []): RoomProgram => ({ roomId: 'r', reading: '', zones: [{ id: 'z', function: 'Sitzen', rect: { x0: 0, y0: 0, x1: 5, y1: 4 }, why: '' }], items, relations, walk: '', check: [] });
const ids = (p: RoomProgram, catalogId: string) => p.items.filter((i) => i.catalogId === catalogId).map((i) => i.id);
const rel = (p: RoomProgram, kind: Relation['kind'], item: string) => p.relations.find((r) => r.kind === kind && 'item' in r && r.item === item);

describe('furniture groups (#436)', () => {
  it('completes a bare sofa in a living room to a seating group', () => {
    const { program: p, notes } = completeGroups(program([item('sofa', 'generic-sofa-3', 'z', { required: true })]), 'living', 22, 2);
    const coffee = ids(p, 'generic-coffee-table')[0];
    expect(rel(p, 'front-of', coffee)).toMatchObject({ target: 'sofa', gap: COFFEE_GAP });
    // the rug is wider than the sofa (W6)
    expect(rel(p, 'under-front', ids(p, 'generic-rug-200')[0])).toMatchObject({ target: 'sofa' });
    const lamp = ids(p, 'generic-floor-lamp')[0];
    const side = ids(p, 'generic-side-table')[0];
    expect(rel(p, 'left-of', lamp) ?? rel(p, 'right-of', lamp)).toMatchObject({ target: 'sofa' });
    expect((rel(p, 'left-of', side) ?? rel(p, 'right-of', side))!.kind).not.toBe((rel(p, 'left-of', lamp) ?? rel(p, 'right-of', lamp))!.kind);
    expect(ids(p, 'generic-pendant')).toEqual(['deckenlicht']);
    expect(notes.join(' ')).toContain('Sitzgruppe „sofa“ ergänzt');
  });

  it('puts only as many pieces at the sofa arms as its zone holds (flat B, #436)', () => {
    // zone 2.8 m along the sofa (rotation 90°: its width runs along y), a plant of Claude's already at one arm
    const narrow: RoomProgram = { ...program([item('sofa', 'generic-sofa-3', 'z', { hint: { x: 1, y: 2, rotation: Math.PI / 2 } }), item('plant', 'generic-plant')], [{ kind: 'right-of', item: 'plant', target: 'sofa' }]), zones: [{ id: 'z', function: 'Sitzen', rect: { x0: 0, y0: 0.6, x1: 5, y1: 3.4 }, why: '' }] };
    const { program: p } = completeGroups(narrow, 'living', 25, 2);
    expect(ids(p, 'generic-side-table')).toEqual([]);
    expect(ids(p, 'generic-floor-lamp')).toEqual([]);
  });

  it('takes Claude\'s rug from another zone or under the armchair instead of laying a second one', () => {
    const { program: p } = completeGroups(
      program([item('sofa', 'generic-sofa-3'), item('chair', 'generic-armchair'), item('rug', 'generic-rug-200', 'weg')], [{ kind: 'under-front', item: 'rug', target: 'chair' }]),
      'living',
      22,
      2,
    );
    expect(p.items.filter((i) => i.catalogId.startsWith('generic-rug')).map((i) => i.id)).toEqual(['rug']);
  });

  it('keeps what Claude planned and binds loose pieces: coffee table gap, armchair at the table end, bigger rug', () => {
    const { program: p } = completeGroups(
      program(
        [item('sofa', 'generic-sofa-3'), item('ct', 'generic-coffee-table'), item('rug', 'generic-rug-160'), item('chair', 'generic-armchair'), item('lamp', 'generic-floor-lamp'), item('top', 'generic-pendant')],
        [
          { kind: 'front-of', item: 'ct', target: 'sofa', gap: 0.9 },
          { kind: 'facing', item: 'chair', target: 'sofa' },
          { kind: 'near', item: 'lamp', target: 'sofa' },
        ],
      ),
      'living',
      22,
      2,
    );
    expect(ids(p, 'generic-coffee-table')).toEqual(['ct']);
    expect(rel(p, 'front-of', 'ct')).toMatchObject({ gap: COFFEE_GAP });
    expect(p.items.find((i) => i.id === 'rug')).toMatchObject({ catalogId: 'generic-rug-200', fallbacks: expect.arrayContaining(['generic-rug-160']) });
    expect(rel(p, 'flank', 'chair')).toMatchObject({ target: 'ct' });
    // the planned ceiling light stays the only one
    expect(ids(p, 'generic-pendant')).toEqual(['top']);
  });

  it('gives a sofa in a study only its lamp, and a compact studio no extra side table', () => {
    const study = completeGroups(program([item('sofa', 'generic-sofa-2')]), 'office', 10, 2).program;
    expect(study.items.map((i) => i.catalogId).sort()).toEqual(['generic-floor-lamp', 'generic-pendant', 'generic-sofa-2']);
    const studio = completeGroups(program([item('sofa', 'generic-sofa-2'), item('bed', 'generic-bed-140')]), 'living', 26, 4).program;
    expect(ids(studio, 'generic-side-table')).toEqual([]);
    expect(ids(studio, 'generic-coffee-table-round').length).toBe(1);
  });

  it('completes a bed: nightstands as a pair with lamps, a rug under it', () => {
    const { program: p } = completeGroups(program([item('bed', 'generic-bed-160')]), 'bedroom', 14, 1);
    const [a, b] = ids(p, 'generic-nightstand');
    expect(p.relations).toContainEqual({ kind: 'pair', item: a, item2: b, target: 'bed' });
    expect(ids(p, 'generic-table-lamp').map((l) => (rel(p, 'on', l) as { target: string }).target).sort()).toEqual([a, b].sort());
    expect(rel(p, 'under-all', ids(p, 'generic-rug-200')[0])).toMatchObject({ target: 'bed' });
  });

  it('hangs the pendant 65 cm over the dining table and lights the desk', () => {
    const { program: p } = completeGroups(
      program([item('t', 'generic-dining-table-4'), item('c1', 'generic-chair'), item('c2', 'generic-chair'), item('d', 'generic-desk')], [{ kind: 'around', items: ['c1', 'c2'], target: 't' }]),
      'dining',
      16,
      2,
    );
    expect(rel(p, 'above', ids(p, 'generic-pendant').find((id) => id !== 'deckenlicht')!)).toMatchObject({ target: 't', height: 1.4 });
    expect(rel(p, 'front-of', ids(p, 'generic-office-chair')[0])).toMatchObject({ target: 'd' });
    expect(rel(p, 'on', ids(p, 'generic-table-lamp')[0])).toMatchObject({ target: 'd' });
  });

  it('hangs curtains as a pair at every window of a bedroom without them, in the zone by the window (R8)', () => {
    const plan: RoomProgram = { ...program([item('bed', 'generic-bed-160', 'z', { required: true }), item('c', 'generic-curtain', 'z')], [{ kind: 'window', item: 'c', window: 'F1', place: 'over' }]), zones: [{ id: 'z', function: 'Schlafen', rect: { x0: 0, y0: 0, x1: 3, y1: 4 }, why: '' }, { id: 'k', function: 'Kleidung', rect: { x0: 3.2, y0: 0, x1: 4, y1: 4 }, why: '' }] };
    const windows = [{ id: 'F1', x: 1, y: 0, rotation: 0 }, { id: 'F2', x: 4, y: 2, rotation: Math.PI / 2 }];
    const { program: p } = completeGroups(plan, 'bedroom', 14, 2, [], windows);
    const added = p.items.filter((i) => i.catalogId === 'generic-curtain' && i.id !== 'c');
    expect(added.map((i) => rel(p, 'window', i.id))).toEqual([expect.objectContaining({ window: 'F2', place: 'over' }), expect.objectContaining({ window: 'F2', place: 'over' })]);
    expect(added.every((i) => i.zone === 'k')).toBe(true);
    // a kitchen gets none
    expect(completeGroups(plan, 'kitchen', 14, 2, [], windows).program.items.filter((i) => i.catalogId === 'generic-curtain')).toHaveLength(1);
  });

  it('leaves baths, halls and balconies as planned', () => {
    const plan = program([item('sofa', 'generic-sofa-2')]);
    expect(completeGroups(plan, 'balcony', 6, 1).program).toBe(plan);
  });
});

describe('curtain sizes (R8)', () => {
  it('picks the panel by window width: fabric of the pair about 1.6 times the rod', async () => {
    const { curtainFor } = await import('./groups');
    expect(curtainFor(0.8).id).toBe('generic-curtain-100');
    expect(curtainFor(1.2).id).toBe('generic-curtain');
    expect(curtainFor(2.2).id).toBe('generic-curtain-200');
    expect(curtainFor(3.5).id).toBe('generic-curtain-280');
    expect(curtainFor(2.2).fallbacks[0]).toBe('generic-curtain');
  });
});
