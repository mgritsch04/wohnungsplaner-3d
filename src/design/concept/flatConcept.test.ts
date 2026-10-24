import { describe, expect, it } from 'vitest';
import { RECORDED } from '../fixtures/recorded';
import { buildFlatConceptPrompt, parseFlatConcept, parseRoomType, repairPrompt, roomConceptOf, wishList, wishWords } from './flatConcept';
import { testFlatInput } from './testFlats';

const A = testFlatInput('A');
const B = testFlatInput('B');
const rawA = () => structuredClone(RECORDED.A!.concept) as unknown as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('flat concept prompt', () => {
  const prompt = buildFlatConceptPrompt(A);

  it('numbers the wishes and carries the flat overview', () => {
    expect(wishList(A.wishes).map((w) => w.text)).toEqual(['Lesen', 'Kochen', 'PC-Spiele', 'Arbeitsplatz mit Monitor', 'viel Stauraum', 'Schlafplatz für Gäste', 'gemütliche Leseecke', 'Pflanzen', 'Esstisch für 4']);
    expect(prompt).toContain('Wunsch 9: Esstisch für 4');
    expect(prompt).toContain(A.sketch);
    for (const r of A.analysis.rooms) expect(prompt).toContain(r.name);
  });

  it('states the rules of the concept', () => {
    expect(prompt).toContain('GENAU EINEM Raum');
    expect(prompt).toContain('Esstisch, Gästeschlafplatz und Küchenzeile gibt es in der Wohnung nur einmal');
    expect(prompt).toContain('fest eingebaut');
    expect(prompt).toContain('"wishes"');
  });

  it('names the areas the user marked', () => {
    const F = testFlatInput('F');
    const zones = F.analysis.rooms.flatMap((r) => r.userZones);
    expect(zones.length).toBeGreaterThan(0);
    expect(buildFlatConceptPrompt(F)).toContain(`Bereich ${zones[0].id}`);
  });
});

describe('parseRoomType', () => {
  it('reads ids, German names and a few synonyms', () => {
    expect(parseRoomType('bedroom')).toBe('bedroom');
    expect(parseRoomType('Schlafzimmer')).toBe('bedroom');
    expect(parseRoomType('WC')).toBe('bath');
    expect(parseRoomType('Gang')).toBe('hall');
    expect(parseRoomType('sonstiges')).toBe('other');
    expect(parseRoomType('Raumschiff')).toBeNull();
  });
});

describe('parseFlatConcept', () => {
  it('reads the recorded concepts of A and B without problems', () => {
    for (const flat of [A, B]) {
      const key = flat === A ? 'A' : 'B';
      const c = parseFlatConcept(RECORDED[key]!.concept, flat);
      expect(c.problems, key).toEqual([]);
      expect(c.value.rooms).toHaveLength(flat.analysis.rooms.length);
      expect(c.value.style.palette.length).toBeGreaterThanOrEqual(4);
    }
    const c = parseFlatConcept(RECORDED.A!.concept, A);
    expect(roomConceptOf(c.value, { roomId: A.roomId('Zimmer 1'), name: 'Zimmer 1' }).type).toBe('bedroom');
    expect(roomConceptOf(c.value, { roomId: A.roomId('Zimmer 2'), name: 'Zimmer 2' }).anchors[0]).toContain('Schreibtisch');
    // every function names a room of the flat, and that room lists it
    for (const f of c.value.functions) expect(c.value.rooms.find((r) => r.roomId === f.roomId)!.functions).toContain(f.function);
  });

  it('finds wishes without a room, also without wish numbers', () => {
    const raw = rawA();
    raw.functions = [
      { function: 'Schlafen', room: 'Zimmer 1', why: '' },
      { function: 'Kochen', room: 'Küche', why: '' },
    ];
    raw.rooms = raw.rooms.map((r: object) => ({ ...r, role: '', functions: [], anchor: '' }));
    const open = (raw2: unknown) => parseFlatConcept(raw2, A).problems.filter((p) => p.startsWith('Wunsch'));
    expect(open(raw)).toContain('Wunsch 9 „Esstisch für 4“ ist keiner Funktion zugeordnet (in "functions" bei "wishes" angeben).');
    expect(open(raw).some((p) => p.startsWith('Wunsch 6 '))).toBe(true);
    // „Kochen“ is in the words of the concept
    expect(open(raw).some((p) => p.startsWith('Wunsch 2 '))).toBe(false);
    // wish numbers count even when the words differ
    raw.functions.push({ function: 'Gemeinsame Mahlzeiten', room: 'Küche', why: '', wishes: [9] }, { function: 'Übernachtungsbesuch', room: 'Zimmer 2', why: '', wishes: ['6'] });
    expect(open(raw).some((p) => p.startsWith('Wunsch 9 ') || p.startsWith('Wunsch 6 '))).toBe(false);
  });

  it('allows the single functions only once', () => {
    const raw = rawA();
    raw.functions.push({ function: 'Essen', room: 'Wohnzimmer', why: 'zweiter Tisch' }, { function: 'Gästeschlafplatz', room: 'Wohnzimmer', why: 'Tagesbett' });
    const problems = parseFlatConcept(raw, A).problems;
    expect(problems.some((p) => p.startsWith('Esstisch ist in mehreren Räumen geplant'))).toBe(true);
    expect(problems.some((p) => p.startsWith('Gästeschlafplatz ist in mehreren Räumen geplant'))).toBe(true);
    // a guest WC is no second guest bed
    const wc = rawA();
    wc.functions.push({ function: 'Gäste-WC', room: 'WC', why: '' });
    expect(parseFlatConcept(wc, A).problems).toEqual([]);
  });

  it('wants sleeping in a bedroom and cooking somewhere', () => {
    const raw = rawA();
    raw.rooms.find((r: { room: string }) => r.room === 'Zimmer 1').functions = ['Kleidung'];
    raw.functions = raw.functions.filter((f: { function: string }) => f.function !== 'Schlafen' && f.function !== 'Kochen');
    raw.rooms.find((r: { room: string }) => r.room === 'Küche').functions = ['Essen'];
    const problems = parseFlatConcept(raw, A).problems;
    expect(problems).toContain('Raum „Zimmer 1“ ist ein Schlafzimmer, hat aber nicht die Funktion Schlafen.');
    expect(problems).toContain('Kein Raum hat die Funktion Schlafen.');
    expect(problems).toContain('Kochen ist keinem Raum zugeordnet.');
  });

  it('refuses new sanitary objects but lets a WC without basin have a hand basin', () => {
    const raw = rawA();
    const bad = raw.rooms.find((r: { room: string }) => r.room === 'Bad');
    bad.anchor = 'zusätzliches Wand-WC neben der Wanne';
    const wc = raw.rooms.find((r: { room: string }) => r.room === 'WC');
    wc.anchor = 'Handwaschbecken 40 cm neben dem WC';
    const zimmer = raw.rooms.find((r: { room: string }) => r.room === 'Zimmer 2');
    zimmer.anchors = ['Schreibtisch', 'Dusche in der Ecke'];
    const problems = parseFlatConcept(raw, A).problems;
    expect(problems.filter((p) => p.includes('Sanitärobjekt'))).toHaveLength(2);
    expect(problems.some((p) => p.startsWith('Raum „Bad“'))).toBe(true);
    expect(problems.some((p) => p.startsWith('Raum „Zimmer 2“'))).toBe(true);
  });

  it('asks for every room once, with names of the flat and known types', () => {
    const raw = rawA();
    raw.rooms = raw.rooms.filter((r: { room: string }) => r.room !== 'Balkon');
    raw.rooms.push({ room: 'Dachboden', type: 'other' }, { ...raw.rooms[0] });
    raw.rooms[1].type = 'Raumschiff';
    raw.functions.push({ function: 'Sauna', room: 'Keller' });
    const problems = parseFlatConcept(raw, A).problems;
    expect(problems).toContain('Raum „Balkon“ fehlt in "rooms".');
    expect(problems.some((p) => p.startsWith('Raum „Dachboden“ gibt es in der Wohnung nicht'))).toBe(true);
    expect(problems).toContain('Raum „Wohnzimmer“ steht mehrmals in "rooms".');
    expect(problems.some((p) => p.includes('Raumtyp „Raumschiff“'))).toBe(true);
    expect(problems.some((p) => p.startsWith('Funktion „Sauna“'))).toBe(true);
  });

  it('cleans colours and lists form errors', () => {
    const raw = rawA();
    raw.style.palette = [{ name: 'Weiß', hex: '#FFF' }, 'Salbei #9caf88', { name: 'kaputt', hex: 'grün' }];
    raw.rooms[0].accent = 'grün';
    const c = parseFlatConcept(raw, A);
    expect(c.value.style.palette).toEqual([
      { name: 'Weiß', hex: '#ffffff' },
      { name: 'Salbei', hex: '#9caf88' },
    ]);
    expect(c.value.rooms[0].accent).toBeUndefined();
    expect(c.notes.some((n) => n.includes('Akzentfarbe'))).toBe(true);
    expect(parseFlatConcept('Hallo', A).problems[0]).toContain('kein JSON-Objekt');
  });
});

describe('repairPrompt', () => {
  it('repeats the task, the last answer and the problems', () => {
    const p = repairPrompt('AUFGABE', { living: 'x' }, ['Raum „Bad“ fehlt in "rooms".']);
    expect(p.startsWith('AUFGABE')).toBe(true);
    expect(p).toContain('{"living":"x"}');
    expect(p).toContain('- Raum „Bad“ fehlt in "rooms".');
    expect(p).toContain('vollständigen JSON');
  });

  it('stems the words of a wish', () => {
    expect(wishWords('Esstisch für 4')).toEqual(['essti']);
    expect(wishWords('Schlafplatz für Gäste')).toEqual(['schla', 'gäst']);
    expect(wishWords('PC-Spiele')).toEqual(['pc', 'spie']);
  });
});
