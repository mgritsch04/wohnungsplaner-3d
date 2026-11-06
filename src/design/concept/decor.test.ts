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

  it('lässt Balkon und Abstellraum in Ruhe und überspringt kleine Räume ohne Pflanze', () => {
    const base = program([item('sofa', 'generic-sofa-3')]);
    for (const t of ['balcony', 'utility'] as const) expect(completeDecor(base, t, 12, []).program).toBe(base);
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

  it('wählt für ein 1,8-m-Möbel das Bild 120×80', () => {
    expect(pictureFor(1.8)).toBe('generic-picture-xl');
  });

  it('stellt ein Deko-Set auf Lowboard und breites Sideboard mit Lampe, nicht auf eine schmale Kommode mit Lampe (SL6)', () => {
    const { program: p } = completeDecor(
      program(
        [item('tvb', 'generic-tv-sideboard'), item('tv', 'generic-tv'), item('sb', 'generic-sideboard'), item('lsb', 'generic-table-lamp'), item('kom', 'generic-dresser'), item('lk', 'generic-table-lamp')],
        [{ kind: 'above', item: 'tv', target: 'tvb' }, { kind: 'on', item: 'lsb', target: 'sb' }, { kind: 'on', item: 'lk', target: 'kom' }],
      ),
      'living',
      22,
      [],
    );
    const targets = p.items.filter((i) => i.catalogId === 'generic-decor-set').map((i) => (p.relations.find((r) => r.kind === 'on' && r.item === i.id) as { target: string }).target);
    expect(targets.sort()).toEqual(['sb', 'tvb']);
  });

  describe('Textilien und Tischdeko', () => {
    const on = (p: RoomProgram, target: string) => p.relations.flatMap((r) => (r.kind === 'on' && r.target === target ? [p.items.find((i) => i.id === r.item)!] : []));
    const catalogOn = (p: RoomProgram, target: string) => on(p, target).map((i) => i.catalogId).sort();

    it('legt Kissen in der Akzentfarbe und eine Decke aufs Sofa, ein Kissen in den Sessel', () => {
      const { program: p, notes } = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true }), item('sessel', 'generic-armchair')]), 'living', 22, [], '#c46a3b', { textile: '#cdbfa8' });
      expect(catalogOn(p, 'sofa')).toEqual(['generic-cushions', 'generic-throw']);
      expect(on(p, 'sofa').find((i) => i.catalogId === 'generic-cushions')!.color).toBe('#c46a3b');
      expect(on(p, 'sofa').find((i) => i.catalogId === 'generic-throw')!.color).toBe('#cdbfa8');
      expect(catalogOn(p, 'sessel')).toEqual(['generic-cushion']);
      expect(notes.join(' ')).toContain('Textilien ergänzt');
    });

    it('nimmt eine andere Farbe, wenn das Sofa selbst in der Akzentfarbe ist', () => {
      const { program: p } = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true, color: '#C46A3B' })]), 'living', 22, [], '#c46a3b', { textile: '#cdbfa8' });
      expect(on(p, 'sofa').find((i) => i.catalogId === 'generic-cushions')!.color).toBe('#cdbfa8');
    });

    it('legt Kissen und ein Plaid aufs Bett, im Kinderzimmer nur Kissen', () => {
      expect(catalogOn(completeDecor(program([item('bett', 'generic-bed-160', { required: true })]), 'bedroom', 14, []).program, 'bett')).toEqual(['generic-bed-throw', 'generic-cushions']);
      expect(catalogOn(completeDecor(program([item('bett', 'generic-bed-90', { required: true })]), 'kids', 12, []).program, 'bett')).toEqual(['generic-cushion']);
    });

    it('stellt Kerzen auf den Couchtisch, eine Vase auf den Esstisch und ein Set auf den Schreibtisch', () => {
      const p = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true }), item('couch', 'generic-coffee-table'), item('tisch', 'generic-dining-table-4'), item('pult', 'generic-desk')]), 'living', 28, []).program;
      expect(catalogOn(p, 'couch')).toEqual(['generic-candle-tray']);
      expect(catalogOn(p, 'tisch')).toEqual(['generic-vase']);
      expect(catalogOn(p, 'pult')).toEqual(['generic-desk-set']);
    });

    it('lässt Tische in Ruhe, auf denen schon etwas steht, und Schreibtische mit Lampe nur mit Platz', () => {
      const p = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true }), item('tisch', 'generic-dining-table-4'), item('schale', 'generic-decor-set')], [{ kind: 'on', item: 'schale', target: 'tisch' }]), 'living', 28, []).program;
      expect(catalogOn(p, 'tisch')).toEqual(['generic-decor-set']);
      const q = completeDecor(program([item('pult', 'generic-desk-small'), item('lampe', 'generic-table-lamp')], [{ kind: 'on', item: 'lampe', target: 'pult' }]), 'office', 10, []).program;
      expect(catalogOn(q, 'pult')).toEqual(['generic-desk-set', 'generic-table-lamp']);
    });

    it('stellt Kräuter ans Fenster der Küche, eine Obstschale auf den Tisch und hängt eine Uhr auf; ohne Fenster keine Kräuter', () => {
      const kitchen = program([item('tisch', 'generic-dining-table-4', { required: true })]);
      const { program: p } = completeDecor(kitchen, 'kitchen', 9, [], undefined, { windows: [{ id: 'F1' }] });
      expect(p.items.map((i) => i.catalogId).sort()).toEqual(['generic-dining-table-4', 'generic-fruit-bowl', 'generic-herbs', 'generic-wall-clock']);
      expect(completeDecor(kitchen, 'kitchen', 9, []).program.items.some((i) => i.catalogId === 'generic-herbs')).toBe(false);
    });

    it('findet für eine Küche ohne Möbel eine Zone als Anker', () => {
      const { program: p } = completeDecor(program([]), 'kitchen', 9, [], undefined, { windows: [{ id: 'F1' }] });
      expect(p.items.map((i) => i.catalogId).sort()).toEqual(['generic-herbs', 'generic-wall-clock']);
    });

    it('hängt im Bad eine Handtuchstange neben den Waschtisch', () => {
      const { program: p } = completeDecor(program([item('becken', 'generic-washbasin', { required: true })]), 'bath', 5, [], undefined, { textile: '#d8d2c6' });
      expect(p.items.find((i) => i.catalogId === 'generic-towels')).toMatchObject({ color: '#d8d2c6' });
    });

    it('stellt im Gang eine Vase auf den Schuhschrank', () => {
      const p = completeDecor(program([item('schuhe', 'generic-shoe-cabinet', { required: true })]), 'hall', 6, []).program;
      expect(catalogOn(p, 'schuhe')).toEqual(['generic-vase']);
    });

    it('bleibt in der Stufe „günstig“ bei Bildern und Pflanze', () => {
      const { program: p } = completeDecor(program([item('sofa', 'generic-sofa-3', { required: true }), item('couch', 'generic-coffee-table')]), 'living', 22, [], '#c46a3b', { level: 'basic' });
      expect(p.items.map((i) => i.catalogId).filter((c) => /cushion|throw|vase|tray/.test(c))).toEqual([]);
      expect(completeDecor(program([item('becken', 'generic-washbasin')]), 'bath', 5, [], undefined, { level: 'basic' }).program.items).toHaveLength(1);
    });
  });
});
