import { describe, expect, it } from 'vitest';
import type { ProgramItem, Relation, RoomProgram } from '../types';
import { completeDecor, pictureFor } from './decor';

const item = (id: string, catalogId: string, extra: Partial<ProgramItem> = {}): ProgramItem => ({ id, catalogId, zone: 'z', hint: { x: 2, y: 2, rotation: 0 }, why: '', ...extra });
const program = (items: ProgramItem[], relations: Relation[] = []): RoomProgram => ({ roomId: 'r', reading: '', zones: [{ id: 'z', function: 'Sitzen', rect: { x0: 0, y0: 0, x1: 5, y1: 4 }, why: '' }], items, relations, walk: '', check: [] });
const pictures = (p: RoomProgram) => p.items.filter((i) => i.catalogId.startsWith('generic-picture'));
const above = (p: RoomProgram, target: string) => p.relations.find((r) => r.kind === 'above' && r.target === target) as Extract<Relation, { kind: 'above' }> | undefined;

describe('Wanddeko und Pflanzen (#436)', () => {
  it('wählt das Bild nach zwei Dritteln der Möbelbreite (R7)', () => {
    expect(pictureFor(2.2)).toBe('generic-picture-wide');
    expect(pictureFor(1.6)).toBe('generic-picture-large');
    expect(pictureFor(0.9)).toBe('generic-picture');
    expect(pictureFor(0.5)).toBeNull();
  });

  it('hängt im Wohnzimmer ein Bild über das Sofa und stellt eine Pflanze dazu', () => {
    const { program: p, notes } = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true })]), 'living', 22, [], '#c46a3b');
    const pic = pictures(p)[0];
    expect(pic).toMatchObject({ catalogId: 'generic-picture-wide', color: '#c46a3b' });
    expect(above(p, 'sofa')).toMatchObject({ item: pic.id });
    expect(above(p, 'sofa')!.height).toBeGreaterThan(1);
    expect(p.items.some((i) => i.catalogId === 'generic-plant')).toBe(true);
    expect(notes.join(' ')).toContain('Wanddeko ergänzt');
  });

  it('hängt im Schlafzimmer ein Bild über das Bett und einen Spiegel zum Schrank', () => {
    const { program: p } = completeDecor(program([item('bett', 'generic-bed-160', { required: true }), item('schrank', 'generic-wardrobe-200')]), 'bedroom', 14, []);
    expect(above(p, 'bett')).toBeDefined();
    expect(p.items.some((i) => i.catalogId === 'generic-mirror')).toBe(true);
  });

  it('gibt dem Gang einen Spiegel und ein Bild, ohne Pflanze', () => {
    const { program: p } = completeDecor(program([item('garderobe', 'generic-coat-rack', { required: true })]), 'hall', 6, []);
    expect(p.items.map((i) => i.catalogId).sort()).toEqual(['generic-coat-rack', 'generic-mirror-round', 'generic-picture']);
  });

  it('lässt Bad, Küche und Balkon in Ruhe und überspringt kleine Räume ohne Pflanze', () => {
    const base = program([item('sofa', 'generic-sofa-3')]);
    for (const t of ['bath', 'kitchen', 'balcony', 'utility'] as const) expect(completeDecor(base, t, 12, []).program).toBe(base);
    expect(completeDecor(program([item('bett', 'generic-bed-90')]), 'bedroom', 8, []).program.items.some((i) => i.catalogId === 'generic-plant')).toBe(false);
  });

  it('behält, was Claude plante, und hält das Budget ein', () => {
    const planned = program(
      [item('sofa', 'generic-sofa-3'), item('bild1', 'generic-picture-large'), item('bild2', 'generic-picture'), item('bild3', 'generic-picture'), item('palme', 'generic-plant')],
      [{ kind: 'above', item: 'bild1', target: 'sofa', height: 1.1 }],
    );
    const { program: p } = completeDecor(planned, 'living', 22, []);
    expect(pictures(p)).toHaveLength(3);
    expect(p.items.filter((i) => i.catalogId === 'generic-plant')).toHaveLength(1);
    expect(above(p, 'sofa')).toMatchObject({ item: 'bild1', height: 1.1 });
  });

  it('hängt kein Bild über den Fernseher-Schrank und keines über ein Sideboard unter dem Fernseher', () => {
    const { program: p } = completeDecor(program([item('tvb', 'generic-tv-sideboard'), item('tv', 'generic-tv')], [{ kind: 'on', item: 'tv', target: 'tvb' }]), 'living', 22, []);
    expect(above(p, 'tvb')).toBeUndefined();
  });

  it('hängt ein Bild über ein freies Sideboard', () => {
    const { program: p } = completeDecor(program([item('sb', 'generic-sideboard')]), 'dining', 14, []);
    expect(above(p, 'sb')).toMatchObject({ height: 1 });
  });
});
