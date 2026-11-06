import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../../catalog/generic';
import { createFurnitureFromCatalog } from '../../catalog/instantiate';
import { FLAT_KEYS, TEST_FLATS } from '../fixtures/flats';
import { analyzeFlat } from './flat';
import { flatSketch, roomSketch } from './sketch';

function sketches(key: (typeof FLAT_KEYS)[number]) {
  const project = TEST_FLATS[key].build();
  const flat = analyzeFlat(project);
  const ctx = { project, flat };
  return { flat: flatSketch(ctx), rooms: new Map(flat.rooms.map((r) => [r.name, roomSketch(ctx, r)])) };
}

describe.each(FLAT_KEYS)('Raumskizze, Testwohnung %s', (key) => {
  const s = sketches(key);

  it('matches the reviewed text', async () => {
    await expect([s.flat, ...s.rooms.values()].join('\n\n') + '\n').toMatchFileSnapshot(`__snapshots__/sketch-${key}.txt`);
  });

  it('uses whole centimetres for every position', () => {
    for (const text of s.rooms.values()) {
      for (const m of text.matchAll(/\((-?\d[^()\s]*)\)/g)) expect(m[1]).toMatch(/^-?\d+,-?\d+$/);
      for (const m of text.matchAll(/[xy]=(-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)/g)) expect(m[0]).toMatch(/^[xy]=-?\d+–-?\d+$/);
    }
  });
});

describe('Raumskizze, Inhalt', () => {
  it('B: the Wohnküche tells where the doors lead, how they swing and which ways stay free', () => {
    const text = sketches('B').rooms.get('Wohnküche')!;
    expect(text).toContain('Raum „Wohnküche“ (Durchgangszimmer): 25,2 m², Innenmaß 588 × 428 cm, rechteckig');
    expect(text).toContain('Tür T3 bei y=49–139 (90 cm) zu „Vorraum“, schlägt herein');
    expect(text).toContain('Tür T2 bei x=24–104 (80 cm) zu „Schlafzimmer“, schlägt nach außen auf');
    expect(text).toMatch(/- T2 → T3 \(„Schlafzimmer“ → „Vorraum“, Hauptweg\): [\d,]+ m, 90 cm breit/);
    expect(text).toContain('Beim Hereinkommen durch T3 blickt man nach Osten auf W2 mit F2.');
  });

  it('B: the hall names the entrance door', () => {
    const text = sketches('B').rooms.get('Vorraum')!;
    expect(text).toContain('(mit der Wohnungstür, Durchgangszimmer)');
    expect(text).toMatch(/Wohnungstür T\d bei y=/);
  });

  it('F: existing kitchen, the yoga area and the reading place', () => {
    const s = sketches('F');
    expect(s.rooms.get('Wohnküche')!).toMatch(/Vorhandene Einbauküche \(bleibt, keine zweite planen\) an W1 bei x=0–\d+, \d+ cm tief: /);
    expect(s.rooms.get('Wohnküche')!).toMatch(/Vom Nutzer markiert: Z1 „frei lassen \(Yogamatte\)“ bei x=\d+–\d+, y=\d+–\d+: hier nichts hinstellen\./);
    expect(s.rooms.get('Schlafzimmer')!).toContain('Z2 „Leseplatz“');
    expect(s.rooms.get('Wohnküche')!).toContain('Glaselement F1 bis zum Boden');
    expect(s.flat).toContain('Wege vom Eingang durch andere Räume: ');
  });

  it('E: the bay walls are slanted and its shoulders stick into the room', () => {
    const text = sketches('E').rooms.get('Wohnzimmer')!;
    expect(text).toContain('8 Wände, teils schräg');
    expect(text.match(/schräge Wand/g)).toHaveLength(2);
    expect(text.match(/springt in den Raum vor/g)).toHaveLength(2);
  });
});

describe('Raumskizze, Blickziel (#436)', () => {
  it('an existing sofa says what it looks at, worked out by the code', () => {
    const project = TEST_FLATS.B.build();
    const home = analyzeFlat(project).rooms.find((r) => r.name === 'Wohnküche')!;
    const south = home.walls.find((w) => w.side === 'S')!;
    // sofa with its back to the south wall, looking north
    const f = createFurnitureFromCatalog(findCatalogItem('generic-sofa-3')!, { x: south.a.x - 3.2, y: south.a.y - 0.45, rotation: Math.PI });
    f.existing = true;
    project.furniture.push(f);
    const flat = analyzeFlat(project);
    const text = roomSketch({ project, flat }, flat.rooms.find((r) => r.name === 'Wohnküche')!);
    expect(text).toMatch(/Bestand \(bleibt stehen, nicht neu planen\): Sofa 3-Sitzer.*Front nach [NOSW], schaut auf: /);
  });
});
