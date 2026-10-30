import { describe, expect, it } from 'vitest';
import { fromRoomCm, rotationForSide } from '../coords';
import { RECORDED, type RawKitchen, type RawProgram } from '../fixtures/recorded';
import type { RelationKind } from '../types';
import { parseFlatConcept, roomConceptOf } from './flatConcept';
import { buildRoomProgramPrompt, existingLabels, parseRoomProgram, programModel, type RoomProgramInput } from './roomProgram';
import { testFlatInput } from './testFlats';

const flats = { A: testFlatInput('A'), B: testFlatInput('B') };
const concepts = { A: parseFlatConcept(RECORDED.A!.concept, flats.A).value, B: parseFlatConcept(RECORDED.B!.concept, flats.B).value };

function input(key: 'A' | 'B', name: string): RoomProgramInput {
  const f = flats[key];
  const room = f.analysis.rooms.find((r) => r.name === name)!;
  return { project: f.project, concept: concepts[key], room, sketch: f.roomSketch(room.roomId), wishes: f.wishes };
}

const recorded = (key: 'A' | 'B', name: string) => structuredClone(RECORDED[key]!.programs[name]) as RawProgram;

const VOCABULARY: RelationKind[] = ['wall', 'corner', 'center', 'front-of', 'left-of', 'right-of', 'pair', 'facing', 'around', 'above', 'under-front', 'under-all', 'on', 'window', 'near', 'away', 'align'];

describe('room programme prompt', () => {
  it('works in designer order with concept, sketch, rules, catalogue and vocabulary', () => {
    const i = input('B', 'Wohnküche');
    const p = buildRoomProgramPrompt(i);
    const order = ['1. Raum lesen', '2. Zonen festlegen', '3. Je Zone ein Baustein', '4. Lichtplan', '5. Stauraum', '6. Stil', '7. Textilien', '8. Begehung im Kopf', 'Raumfakten:', 'Bausteine', 'Regelwerk (mit Kennungen'];
    expect(order.map((s) => p.indexOf(s)).every((at, k, all) => at > 0 && (k === 0 || at > all[k - 1]))).toBe(true);
    expect(p).toContain(i.sketch);
    expect(p).toContain(concepts.B.living);
    expect(p).toContain('Durchgangszimmer');
    expect(p).toContain('Couchtisch 40–50 cm vor dem Sofa');
    expect(p).toContain('generic-sofa-3:');
    expect(p).toContain('[a,"window","F1","beside"]');
    // the Wohnküche of B cooks and has no kitchen yet
    expect(p).toContain('Hier gibt es noch keine Küchenzeile');
    expect(p).toContain('generic-k-sink-80:');
    expect(p).not.toContain('generic-k-wall-60:');
    expect(p).toContain('Muss in den Raum');
    expect(p).toContain('Esstisch (Funktion Essen)');
    expect(p).not.toContain('"userZone"');
  });

  it('names the existing pieces with labels and leaves the kitchen out where there is none to plan', () => {
    const i = input('B', 'Bad');
    const p = buildRoomProgramPrompt(i);
    const labels = existingLabels(i.project, i.room);
    expect(labels.map((l) => l.label)).toEqual(['B1', 'B2', 'B3']);
    expect(p).toContain(`B1 = ${labels[0].f.name}`);
    expect(p).not.toContain('Küchenmodule');
    expect(p).toContain('In anderen Räumen (hier NICHT planen)');
  });

  it('offers own products of the room type', () => {
    const i = input('B', 'Schlafzimmer');
    const product = { id: 'ikea-test-bed', name: 'Testbett 160', category: 'bed', width: 1.65, depth: 2.08, height: 0.9, color: '#ffffff', model: { type: 'procedural' as const, shape: 'bed' }, approximate: false, solid: true, tags: [], source: 'import' as const };
    const p = buildRoomProgramPrompt({ ...i, products: [product as never] });
    expect(p).toContain('Eigene Produkte des Nutzers');
    expect(p).toContain('ikea-test-bed: Testbett 160');
  });
});

describe('parseRoomProgram on the recorded answers', () => {
  it('reads every recorded room of A and B into plan coordinates and the vocabulary', () => {
    for (const key of ['A', 'B'] as const) {
      for (const name of Object.keys(RECORDED[key]!.programs)) {
        const i = input(key, name);
        const r = parseRoomProgram(recorded(key, name), i);
        // B's bath has a kitchen wall cabinet over the dryer: the one thing to repair
        if (key === 'B' && name === 'Bad') expect(r.problems).toEqual(['Teil „wallcab“: Küchenmodule (generic-k-wall-60) gehören in "kitchen", nicht in "items".']);
        else expect(r.problems, `${key} ${name}`).toEqual([]);
        expect(r.value.roomId).toBe(i.room.roomId);
        expect(r.value.items.length, `${key} ${name}`).toBeGreaterThan(3);
        for (const rel of r.value.relations) expect(VOCABULARY).toContain(rel.kind);
        for (const it of r.value.items) {
          expect(r.value.zones.some((z) => z.id === it.zone)).toBe(true);
          expect(it.hint).toBeDefined();
        }
      }
    }
  });

  it('converts start places and zones from room cm', () => {
    const i = input('B', 'Wohnküche');
    const raw = recorded('B', 'Wohnküche');
    const r = parseRoomProgram(raw, i);
    const sofa = raw.items.find((it) => it.id === 'sofa')!;
    const hint = r.value.items.find((it) => it.id === 'sofa')!.hint!;
    const at = fromRoomCm(i.room.origin, sofa.x, sofa.y);
    expect(hint.x).toBeCloseTo(at.x);
    expect(hint.y).toBeCloseTo(at.y);
    expect(hint.rotation).toBeCloseTo(rotationForSide('O'));
    const zone = r.value.zones.find((z) => z.id === raw.zones[0].id)!;
    expect(zone.rect.x0).toBeCloseTo(i.room.origin.x + raw.zones[0].rect[0] / 100);
    // the kitchen run on W1 with sink and fridge, ends on the wall
    expect(r.value.kitchen).toHaveLength(1);
    expect(r.value.kitchen![0].wall).toBe('W1');
    expect(r.value.kitchen![0].from.y).toBeCloseTo(i.room.origin.y);
    // chairs „next-to“ the table became one „around“
    expect(r.value.relations).toContainEqual({ kind: 'around', items: ['chair_n1', 'chair_n2', 'chair_s1', 'chair_s2'], target: 'table' });
  });

  it('marks the pieces the room needs as required', () => {
    const r = parseRoomProgram(recorded('A', 'Zimmer 1'), input('A', 'Zimmer 1'));
    const bed = r.value.items.find((it) => it.catalogId.startsWith('generic-bed'))!;
    expect(bed.required).toBe(true);
  });

  it('does not take the existing WC again but keeps the hand basin of the WC', () => {
    const r = parseRoomProgram(recorded('A', 'WC'), input('A', 'WC'));
    expect(r.value.items.map((it) => it.catalogId)).not.toContain('generic-toilet');
    expect(r.value.items.map((it) => it.catalogId)).toContain('generic-washbasin');
    expect(r.notes.some((n) => n.includes('Bestand'))).toBe(true);
    // the shelf „above“ the WC goes to the wall the WC stands at
    expect(r.value.relations.some((rel) => rel.kind === 'wall' && rel.item === 'shelf')).toBe(true);
  });
});

describe('answers recorded with these prompts (C–F)', () => {
  it('give a valid concept and a valid programme for every room', () => {
    for (const key of ['C', 'D', 'E', 'F'] as const) {
      const f = testFlatInput(key);
      const run = RECORDED[key]!;
      const c = parseFlatConcept(run.concept, f);
      expect(c.problems, key).toEqual([]);
      for (const room of f.analysis.rooms) {
        const raw = run.programs[room.name];
        expect(raw, `${key} ${room.name}`).toBeDefined();
        const p = parseRoomProgram(raw, { project: f.project, concept: c.value, room, sketch: '', wishes: f.wishes });
        expect(p.problems, `${key} ${room.name}`).toEqual([]);
      }
    }
  });
});

describe('parseRoomProgram finds what has to be repaired', () => {
  it('unknown catalogue ids, zones and places outside the room', () => {
    const raw = recorded('A', 'Zimmer 1');
    raw.items[0].catalogId = 'generic-wasserbett';
    raw.items[1].zone = 'nirgends';
    raw.items[2].x = 900;
    raw.items[3].facing = 'oben';
    raw.zones.push({ id: 'draussen', function: 'x', rect: [500, 0, 700, 100], why: '' });
    const p = parseRoomProgram(raw, input('A', 'Zimmer 1')).problems;
    expect(p.some((x) => x.includes('catalogId „generic-wasserbett“'))).toBe(true);
    expect(p.some((x) => x.includes('Zone „nirgends“ gibt es nicht'))).toBe(true);
    expect(p.some((x) => x.includes('liegt außerhalb des Raums'))).toBe(true);
    expect(p.some((x) => x.includes('Blickrichtung „oben“'))).toBe(true);
    expect(p.some((x) => x.startsWith('Zone „draussen“'))).toBe(true);
  });

  it('a missing bed in the bedroom', () => {
    const raw = recorded('A', 'Zimmer 1');
    raw.items = raw.items.filter((it) => !it.catalogId.startsWith('generic-bed'));
    expect(parseRoomProgram(raw, input('A', 'Zimmer 1')).problems.some((p) => p.startsWith('Es fehlt: Bett'))).toBe(true);
  });

  it('a dining table or guest bed the concept put in another room', () => {
    const raw = recorded('A', 'Wohnzimmer');
    raw.items.push({ id: 'table2', catalogId: 'generic-dining-table-4', zone: raw.zones[0].id, x: 250, y: 250, facing: 'S', why: '' });
    raw.items.push({ id: 'daybed', catalogId: 'generic-bed-90', zone: raw.zones[0].id, x: 100, y: 300, facing: 'O', label: 'Tagesbett', why: '' });
    const p = parseRoomProgram(raw, input('A', 'Wohnzimmer')).problems;
    expect(p).toContain('Teil „table2“ ist ein Esstisch – Essen ist laut Wohnkonzept in „Küche“.');
    expect(p).toContain('Teil „daybed“ ist ein Gästeschlafplatz – der ist laut Wohnkonzept in „Zimmer 2“.');
  });

  it('new sanitary objects', () => {
    const raw = recorded('A', 'Bad');
    raw.items.push({ id: 'wc2', catalogId: 'generic-toilet', zone: raw.zones[0].id, x: 50, y: 50, facing: 'S', label: 'Wand-WC', why: '' });
    raw.items.push({ id: 'shower', catalogId: 'generic-shower', zone: raw.zones[0].id, x: 50, y: 200, facing: 'N', label: 'Dusche', why: '' });
    const p = parseRoomProgram(raw, input('A', 'Bad')).problems;
    expect(p.filter((x) => x.includes('Sanitärobjekte sind fest eingebaut'))).toHaveLength(2);
  });

  it('a kitchen that is missing, on an unknown wall or too long', () => {
    const i = input('B', 'Wohnküche');
    const none = recorded('B', 'Wohnküche');
    delete none.kitchen;
    expect(parseRoomProgram(none, i).problems.some((p) => p.startsWith('Hier wird gekocht, aber "kitchen" fehlt'))).toBe(true);
    const wrong = recorded('B', 'Wohnküche');
    (wrong.kitchen as RawKitchen).wall = 'W9';
    expect(parseRoomProgram(wrong, i).problems.some((p) => p.includes('Wand „W9“'))).toBe(true);
    const long = recorded('B', 'Wohnküche');
    (long.kitchen as RawKitchen).to = [200, 0];
    (long.kitchen as RawKitchen).modules.push('generic-k-hood-60', 'generic-k-base-60');
    const r = parseRoomProgram(long, i);
    expect(r.problems.some((p) => p.includes('nur 96 cm'))).toBe(true);
    expect(r.notes.some((n) => n.includes('setzt die App'))).toBe(true);
    // no kitchen in a bedroom
    const bed = recorded('B', 'Schlafzimmer');
    bed.kitchen = { wall: 'W1', from: [0, 0], to: [100, 0], modules: ['generic-k-sink-80'] };
    expect(parseRoomProgram(bed, input('B', 'Schlafzimmer')).problems.some((p) => p.includes('nicht gekocht'))).toBe(true);
  });

  it('far too many pieces and an empty answer', () => {
    const raw = recorded('A', 'Gang');
    const base = raw.items[0];
    raw.items = Array.from({ length: 50 }, (_, k) => ({ ...base, id: `box${k}`, catalogId: 'generic-storage-box' }));
    const p = parseRoomProgram(raw, input('A', 'Gang')).problems;
    expect(p.some((x) => x.includes('zu viele für einen Raum'))).toBe(true);
    expect(p.some((x) => x.includes('ist zu viel'))).toBe(true);
    const empty = parseRoomProgram({}, input('A', 'Gang')).problems;
    expect(empty).toContain('"items" ist leer.');
    expect(empty.some((x) => x.startsWith('"zones" ist leer'))).toBe(true);
  });

  it('renames doubled ids and keeps relations to existing pieces', () => {
    const raw = recorded('A', 'Bad');
    raw.items.push({ ...raw.items[0] });
    const r = parseRoomProgram(raw, input('A', 'Bad'));
    expect(new Set(r.value.items.map((it) => it.id)).size).toBe(r.value.items.length);
    expect(r.notes.some((n) => n.includes('doppelt, umbenannt'))).toBe(true);
    // „mirrorcab above basin-existing“: the mirror cabinet goes over the fitted washbasin
    const mirror = r.value.relations.find((rel) => rel.kind === 'wall' && rel.item === 'mirrorcab');
    expect(mirror && 'along' in mirror && mirror.along).toBeTruthy();
  });
});

describe('programModel', () => {
  const f = flats.A;
  const rc = (name: string) => roomConceptOf(concepts.A, f.analysis.rooms.find((r) => r.name === name)!);
  const room = (name: string) => f.analysis.rooms.find((r) => r.name === name)!;

  it('asks Opus for main rooms and Sonnet for small ones when thorough, Sonnet when fast', () => {
    expect(programModel(rc('Wohnzimmer'), room('Wohnzimmer'), 'thorough')).toBe('opus');
    expect(programModel(rc('Zimmer 1'), room('Zimmer 1'), 'thorough')).toBe('opus');
    expect(programModel(rc('WC'), room('WC'), 'thorough')).toBe('sonnet');
    expect(programModel(rc('Gang'), room('Gang'), 'thorough')).toBe('sonnet');
    expect(programModel(rc('Wohnzimmer'), room('Wohnzimmer'), 'fast')).toBe('sonnet');
  });
});
