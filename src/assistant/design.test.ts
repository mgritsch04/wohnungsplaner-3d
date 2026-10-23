import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import { applyFurnishing, suggestFurnishing } from '../suggest/furnishing';
import { buildDesignPrompt, EMPTY_WISHES, parseDesignAnswer, PLACEHOLDERS, preselect, proposalTotal, realProducts, searchLinks, swapPick } from './design';
import { summarizePlan } from './planSummary';
import { designWishes, placementReport } from './designRun';
import { polygonInside, polygonsOverlap, rectPoints } from '../model/zones';
import { furnitureCorners } from '../editor2d/furnitureGeometry';

/** Synthetic retailer products (no real product data). */
function product(id: string, over: Partial<CatalogItem> = {}): CatalogItem {
  const moebelix = id.startsWith('mx');
  return {
    id,
    name: `TEST ${id}`,
    category: 'storage',
    width: 0.8,
    depth: 0.4,
    height: 1.2,
    color: '#cccccc',
    model: { type: 'procedural', shape: 'shelf' },
    price: { amount: 100, currency: 'EUR', status: 'confirmed' },
    retailer: moebelix ? 'Möbelix Österreich' : 'IKEA Österreich',
    productUrl: moebelix ? `https://www.moebelix.at/p/${id}` : `https://www.ikea.com/at/de/p/${id}`,
    approximate: true,
    solid: true,
    tags: [],
    source: 'imported',
    ...over,
  } as CatalogItem;
}

const SOFA = product('ik-sofa', { name: 'TESTSOFA 3er', category: 'sofa', width: 2, depth: 0.9, height: 0.8, model: { type: 'procedural', shape: 'sofa' }, price: { amount: 499, currency: 'EUR', status: 'confirmed' } });
const SHELF = product('mx-shelf', { name: 'TESTREGAL Möbelix', price: { amount: 89.9, currency: 'EUR', status: 'confirmed' } });
const LAMP = product('ik-lamp', { name: 'TESTLAMPE', category: 'lighting', width: 0.4, depth: 0.4, height: 1.6, model: { type: 'procedural', shape: 'floor-lamp' }, price: undefined });
const BED = product('ik-bed', { name: 'TESTBETT', category: 'bed', width: 1.6, depth: 2.1, height: 0.5, model: { type: 'procedural', shape: 'bed' }, price: { amount: 2500, currency: 'EUR', status: 'confirmed' } });
const GENERIC = { ...product('generic-x'), retailer: undefined, productUrl: undefined, source: 'generic' } as CatalogItem;
const NO_LINK = product('ik-nolink', { productUrl: undefined });
const FLAT = product('ik-flat', { height: 0 });
const PRODUCTS = [SOFA, SHELF, LAMP, BED, GENERIC, NO_LINK, FLAT];

function flatProject() {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 4.5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 4.5, y: 0, width: 3.5, depth: 4, name: 'Schlafzimmer', thickness: 0.12, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: 4 + 0.06 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = closestWall(p, { x: 2, y: -0.06 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  const mid = closestWall(p, { x: 4.5, y: 3 }, 0.2);
  if (mid) addOpening(p, mid.wall.id, 'door', mid.s);
  return p;
}

const keys = (p: ReturnType<typeof flatProject>) => {
  const plan = summarizePlan(p);
  const key = (name: string) => Object.entries(plan.roomKeys).find(([, id]) => p.rooms.find((r) => r.id === id)?.name === name)![0];
  return { plan, living: key('Wohnzimmer'), bed: key('Schlafzimmer') };
};

describe('Einrichtungsvorschlag mit Claude für die ganze Wohnung (#350)', () => {
  it('bietet nur IKEA-/Möbelix-Produkte mit Produktseite und Maßen an, filterbar nach Händler', () => {
    expect(realProducts(PRODUCTS).map((c) => c.id)).toEqual(['ik-sofa', 'mx-shelf', 'ik-lamp', 'ik-bed']);
    expect(realProducts(PRODUCTS, 'ikea').map((c) => c.id)).toEqual(['ik-sofa', 'ik-lamp', 'ik-bed']);
    expect(realProducts(PRODUCTS, 'moebelix').map((c) => c.id)).toEqual(['mx-shelf']);
    expect(PLACEHOLDERS.some((c) => c.category === 'stairs' || c.kitchen)).toBe(false);
  });

  it('Vorauswahl: Kategorien der geplanten Räume zuerst, nichts über dem Budget, begrenzt', () => {
    const all = realProducts(PRODUCTS);
    expect(preselect(all, ['living']).map((c) => c.id)).toEqual(['ik-sofa', 'mx-shelf', 'ik-lamp', 'ik-bed']);
    expect(preselect(all, ['bedroom'])[0].id).toBe('ik-bed');
    expect(preselect(all, ['living', 'bedroom']).slice(0, 2).map((c) => c.id).sort()).toEqual(['ik-bed', 'ik-sofa']);
    expect(preselect(all, ['living'], 1000).map((c) => c.id)).not.toContain('ik-bed');
    expect(preselect(all, ['living'], 0, 2)).toHaveLength(2);
  });

  it('Prompt: ganze Wohnung, Wünsche, eigene Produkte und Platzhalter, aber keine Links und kein Projektname', () => {
    const p = flatProject();
    const { plan } = keys(p);
    const prompt = buildDesignPrompt({ ...EMPTY_WISHES, interests: 'Gaming, Lesen', needs: 'Stauraum', wants: 'großes Sofa', style: 'gemütlich', budget: 3000 }, plan, realProducts(PRODUCTS));
    expect(prompt).toContain('ganzheitlich');
    expect(prompt).toContain('Interessen/Hobbys: Gaming, Lesen');
    expect(prompt).toContain('Stil: gemütlich');
    expect(prompt).toContain('höchstens 3000 €');
    expect(prompt).toContain('„Wohnzimmer“');
    expect(prompt).toContain('„Schlafzimmer“');
    expect(prompt).toContain('ik-sofa: TESTSOFA 3er (IKEA), 200×90×80 cm, sofa, 499 €');
    expect(prompt).toContain('mx-shelf: TESTREGAL Möbelix (Möbelix)');
    expect(prompt).toContain('generic-bed-160: Doppelbett 160×200');
    expect(prompt).toContain('alternatives');
    expect(prompt).not.toContain('Mustermann');
    expect(prompt).not.toContain('https://');
  });

  it('Antwort: Räume über Kürzel, nur angebotene Einträge, Platzhalter mit Beschreibung und Suchbegriff, Alternativen', () => {
    const p = flatProject();
    const { plan, living, bed } = keys(p);
    const offer = realProducts(PRODUCTS);
    const r = parseDesignAnswer(
      {
        summary: 'Warm und ruhig.',
        rooms: [
          {
            room: living,
            type: 'living',
            concept: 'Gaming-Ecke',
            items: [
              { catalogId: 'ik-sofa', quantity: 1, reason: 'Großes Sofa.', alternatives: [{ catalogId: 'generic-sofa-corner', label: 'Ecksofa grau', search: 'Ecksofa grau' }, { catalogId: 'erfunden' }, { catalogId: 'ik-sofa' }] },
              { catalogId: 'erfunden-123' },
              { catalogId: 'mx-shelf', quantity: 99 },
              { catalogId: 'generic-armchair', reason: 'Lesen.', label: 'Lesesessel Cord', search: 'Sessel Cord' },
            ],
          },
          { room: bed, type: 'bedroom', items: [{ catalogId: 'generic-bed-160', label: '', search: '' }] },
          { room: 'R99', items: [{ catalogId: 'ik-sofa' }] },
        ],
      },
      plan,
      p.rooms.map((x) => x.id),
      offer,
    );
    expect(r.summary).toBe('Warm und ruhig.');
    expect(r.rooms).toHaveLength(2);
    const lr = r.rooms[0];
    expect(lr.type).toBe('living');
    expect(lr.picks.map((x) => [x.catalogId, x.quantity, x.placeholder])).toEqual([
      ['ik-sofa', 1, false],
      ['mx-shelf', 6, false],
      ['generic-armchair', 1, true],
    ]);
    expect(lr.picks[0].alternatives.map((a) => a.catalogId)).toEqual(['generic-sofa-corner']);
    expect(lr.picks[2]).toMatchObject({ label: 'Lesesessel Cord', search: 'Sessel Cord' });
    // empty label/search fall back to the placeholder's name
    expect(r.rooms[1].picks[0]).toMatchObject({ label: 'Doppelbett 160×200', search: 'Doppelbett 160×200' });
    expect(r.dropped).toBe(2);
    expect(() => parseDesignAnswer({ rooms: [{ room: living, items: [{ catalogId: 'erfunden' }] }] }, plan, p.rooms.map((x) => x.id), offer)).toThrow();
    expect(() => parseDesignAnswer('kein json', plan, p.rooms.map((x) => x.id), offer)).toThrow();
    // a single-room request only keeps that room
    const one = parseDesignAnswer({ rooms: [{ room: living, items: [{ catalogId: 'ik-sofa' }] }, { room: bed, items: [{ catalogId: 'ik-bed' }] }] }, plan, [plan.roomKeys[bed]], offer);
    expect(one.rooms.map((x) => x.roomId)).toEqual([plan.roomKeys[bed]]);
  });

  it('Alternative tauschen und zurücktauschen', () => {
    const p = flatProject();
    const { plan, living } = keys(p);
    const r = parseDesignAnswer({ rooms: [{ room: living, items: [{ catalogId: 'ik-sofa', quantity: 1, alternatives: [{ catalogId: 'generic-sofa-2', label: 'Kleines Sofa', search: 'Sofa 2-Sitzer' }] }] }] }, plan, p.rooms.map((x) => x.id), realProducts(PRODUCTS));
    const id = plan.roomKeys[living];
    const swapped = swapPick(r, id, 0, 0);
    expect(swapped.rooms[0].picks[0]).toMatchObject({ catalogId: 'generic-sofa-2', placeholder: true, quantity: 1 });
    expect(swapped.rooms[0].picks[0].alternatives.map((a) => a.catalogId)).toEqual(['ik-sofa']);
    expect(swapPick(swapped, id, 0, 0).rooms[0].picks[0].catalogId).toBe('ik-sofa');
    expect(r.rooms[0].picks[0].catalogId).toBe('ik-sofa');
  });

  it('Summen: eigene Produkte aus Produktseiten, Platzhalter als Richtwert, Stücke ohne Preis gezählt', () => {
    const p = flatProject();
    const { plan, living } = keys(p);
    const offer = realProducts(PRODUCTS);
    const r = parseDesignAnswer({ rooms: [{ room: living, items: [{ catalogId: 'ik-sofa' }, { catalogId: 'mx-shelf', quantity: 2 }, { catalogId: 'ik-lamp' }, { catalogId: 'generic-armchair' }] }] }, plan, p.rooms.map((x) => x.id), offer);
    expect(proposalTotal(r, [...offer, ...PLACEHOLDERS])).toEqual({ real: 499 + 2 * 89.9, placeholder: 280, unpriced: 1 });
  });

  it('Links zur Shop-Suche je Händlerwahl', () => {
    expect(searchLinks('Sofa grau', 'both').map((l) => l.url)).toEqual(['https://www.ikea.com/at/de/search/?q=Sofa%20grau', 'https://www.moebelix.at/s/?s=Sofa%20grau']);
    expect(searchLinks('Sofa', 'ikea')).toHaveLength(1);
    expect(searchLinks('  ', 'both')).toEqual([]);
  });

  it('ganze Wohnung wird kollisionsfrei aufgestellt, eigene Produkte behalten Händler und Produktseite', () => {
    const p = flatProject();
    const { plan, living, bed } = keys(p);
    const offer = realProducts(PRODUCTS);
    const r = parseDesignAnswer(
      { rooms: [{ room: living, items: [{ catalogId: 'ik-sofa' }, { catalogId: 'mx-shelf' }, { catalogId: 'generic-armchair' }] }, { room: bed, items: [{ catalogId: 'ik-bed' }, { catalogId: 'generic-nightstand', quantity: 2 }] }] },
      plan,
      p.rooms.map((x) => x.id),
      offer,
    );
    const s = suggestFurnishing(p, r.rooms.map((x) => ({ roomId: x.roomId, type: x.type ?? 'other', wishes: x.picks.map(({ catalogId, quantity }) => ({ catalogId, quantity })) })), offer);
    expect(s.items).toHaveLength(6);
    applyFurnishing(p, s);
    const d = derivePlan(p);
    for (const f of p.furniture) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
    const shelf = p.furniture.find((f) => f.catalogId === 'mx-shelf')!;
    expect(shelf.retailer).toBe('Möbelix Österreich');
    expect(shelf.productUrl).toBe('https://www.moebelix.at/p/mx-shelf');
  });
});

describe('markierte Bereiche im Einrichtungsvorschlag (#416)', () => {
  const withZones = () => {
    const p = flatProject();
    p.zones.push(
      { id: 'zw', purpose: 'Arbeitsecke', points: rectPoints({ x: 2.6, y: 0 }, { x: 4.4, y: 1.6 }) },
      { id: 'zf', purpose: 'frei lassen', points: rectPoints({ x: 0, y: 0 }, { x: 1.2, y: 1.2 }) },
      { id: 'zs', purpose: 'Leseplatz', points: rectPoints({ x: 6.5, y: 3 }, { x: 8, y: 4 }) },
    );
    return p;
  };

  it('Plan-Zusammenfassung und Prompt nennen die Bereiche mit Zweck und Lage als verbindliche Vorgabe', () => {
    const p = withZones();
    const { plan } = keys(p);
    expect(plan.text).toContain('Z1 „Arbeitsecke“');
    expect(plan.text).toContain('Z2 „frei lassen“ (frei lassen)');
    expect(plan.text).toContain('1,8 × 1,6 m');
    const prompt = buildDesignPrompt(EMPTY_WISHES, plan, []);
    expect(prompt).toContain('verbindliche Vorgabe');
    expect(prompt).toContain('"zone":"');
    // a request for the bedroom only lists the bedroom's area
    const bedPlan = summarizePlan(p, { focusRoomId: p.rooms[1].id });
    expect(bedPlan.listedZones).toEqual(['Z3']);
    expect(buildDesignPrompt(EMPTY_WISHES, summarizePlan(flatProject()), [])).not.toContain('"zone"');
  });

  it('Antwort: Zone nur, wenn sie im selben Raum liegt; gleiche Möbel in verschiedenen Zonen bleiben getrennt; Aufstellung im Bereich', () => {
    const p = withZones();
    const { plan, living } = keys(p);
    const r = parseDesignAnswer(
      {
        rooms: [
          {
            room: living,
            items: [
              { catalogId: 'generic-desk', zone: 'z1' },
              { catalogId: 'generic-office-chair', zone: 'Z1' },
              { catalogId: 'generic-floor-lamp', zone: 'Z3' },
              { catalogId: 'generic-floor-lamp' },
              { catalogId: 'generic-sofa-3' },
            ],
          },
        ],
      },
      plan,
      p.rooms.map((x) => x.id),
      [],
    );
    const picks = r.rooms[0].picks;
    expect(picks.map((x) => x.zone ?? null)).toEqual(['zw', 'zw', null, null]);
    expect(picks[2].quantity).toBe(2);
    const s = suggestFurnishing(p, [{ roomId: r.rooms[0].roomId, type: 'living', wishes: designWishes(r.rooms[0]) }]);
    expect(s.rooms[0].notes).toEqual([]);
    const desk = s.items.find((f) => f.catalogId === 'generic-desk')!;
    expect(polygonInside(furnitureCorners(desk), p.zones[0].points)).toBe(true);
    for (const f of s.items) expect(polygonsOverlap(furnitureCorners(f), p.zones[1].points)).toBe(false);
  });

  it('Nachprüfung meldet, in welchem Bereich ein Möbel steht und welcher Bereich leer blieb', () => {
    const p = withZones();
    const room = { roomId: p.rooms[0].id, type: 'living' as const, concept: '', picks: [{ catalogId: 'generic-sofa-3', quantity: 1, reason: '', placeholder: true, label: '', search: '', alternatives: [] }] };
    const report = placementReport(p, room, 'living', []);
    expect(report).toContain('Bereich Z1 „Arbeitsecke“ ist leer geblieben');
    expect(report).not.toContain('Z2 „frei lassen“ ist leer');
  });
});
