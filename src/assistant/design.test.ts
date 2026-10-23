import { describe, expect, it } from 'vitest';
import type { CatalogItem } from '../catalog/types';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import { applyFurnishing, suggestFurnishing } from '../suggest/furnishing';
import { buildDesignPrompt, EMPTY_WISHES, MAX_PICKS, parseDesignAnswer, preselect, proposalTotal, realProducts } from './design';
import { summarizePlan } from './planSummary';

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

function roomProject() {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 4.5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: 4 + 0.06 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = closestWall(p, { x: 2, y: -0.06 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

describe('Einrichtungsvorschlag mit echten Produkten (#350)', () => {
  it('bietet nur IKEA-/Möbelix-Produkte mit Produktseite und Maßen an, filterbar nach Händler', () => {
    expect(realProducts(PRODUCTS).map((c) => c.id)).toEqual(['ik-sofa', 'mx-shelf', 'ik-lamp', 'ik-bed']);
    expect(realProducts(PRODUCTS, 'ikea').map((c) => c.id)).toEqual(['ik-sofa', 'ik-lamp', 'ik-bed']);
    expect(realProducts(PRODUCTS, 'moebelix').map((c) => c.id)).toEqual(['mx-shelf']);
  });

  it('Vorauswahl: passende Kategorien zuerst, nichts über dem Budget, begrenzt', () => {
    const all = realProducts(PRODUCTS);
    expect(preselect(all, 'living').map((c) => c.id)).toEqual(['ik-sofa', 'mx-shelf', 'ik-lamp', 'ik-bed']);
    expect(preselect(all, 'bedroom')[0].id).toBe('ik-bed');
    expect(preselect(all, 'living', 1000).map((c) => c.id)).not.toContain('ik-bed');
    expect(preselect(all, 'living', 0, 2)).toHaveLength(2);
  });

  it('Prompt enthält Wünsche, Raum und Produkte mit Preis, aber keine Links und keinen Projektnamen', () => {
    const p = roomProject();
    const plan = summarizePlan(p, { focusRoomId: p.rooms[0].id });
    const prompt = buildDesignPrompt({ ...EMPTY_WISHES, interests: 'Gaming, Lesen', needs: 'Stauraum', wants: 'großes Sofa', style: 'gemütlich', budget: 1200 }, plan, realProducts(PRODUCTS));
    expect(prompt).toContain('Interessen/Hobbys: Gaming, Lesen');
    expect(prompt).toContain('Stil: gemütlich');
    expect(prompt).toContain('höchstens 1200 €');
    expect(prompt).toContain('„Wohnzimmer“');
    expect(prompt).toContain('ik-sofa: TESTSOFA 3er (IKEA), 200×90×80 cm, sofa, 499 €');
    expect(prompt).toContain('mx-shelf: TESTREGAL Möbelix (Möbelix)');
    expect(prompt).toContain('Preis unbekannt');
    expect(prompt).not.toContain('Mustermann');
    expect(prompt).not.toContain('https://');
  });

  it('Antwort: nur angebotene Produkte, Mengen begrenzt, doppelte zusammengefasst', () => {
    const offer = realProducts(PRODUCTS);
    const r = parseDesignAnswer(
      {
        summary: 'Gemütliche Leseecke',
        items: [
          { catalogId: 'ik-sofa', quantity: 1, reason: 'Großes Sofa wie gewünscht.' },
          { catalogId: 'erfunden-123', quantity: 1 },
          { catalogId: 'generic-x', quantity: 1 },
          { catalogId: 'mx-shelf', quantity: 99 },
          { catalogId: 'ik-sofa', quantity: 1 },
        ],
      },
      offer,
    );
    expect(r.summary).toBe('Gemütliche Leseecke');
    expect(r.picks).toEqual([
      { catalogId: 'ik-sofa', quantity: 2, reason: 'Großes Sofa wie gewünscht.' },
      { catalogId: 'mx-shelf', quantity: 6, reason: '' },
    ]);
    expect(r.dropped).toBe(2);
    expect(() => parseDesignAnswer({ items: [{ catalogId: 'erfunden' }] }, offer)).toThrow();
    expect(() => parseDesignAnswer('kein json', offer)).toThrow();
    const many = parseDesignAnswer({ items: Array.from({ length: 20 }, (_, i) => ({ catalogId: i % 2 ? 'ik-sofa' : 'mx-shelf' })) }, offer);
    expect(many.picks.length).toBeLessThanOrEqual(MAX_PICKS);
  });

  it('Gesamtpreis aus Katalogdaten, Stücke ohne Preis gezählt', () => {
    expect(proposalTotal([{ catalogId: 'ik-sofa', quantity: 1 }, { catalogId: 'mx-shelf', quantity: 2 }, { catalogId: 'ik-lamp', quantity: 1 }], PRODUCTS)).toEqual({ total: 499 + 2 * 89.9, unpriced: 1 });
  });

  it('übernommene Produkte stehen kollisionsfrei, mit Händler und Produktseite', () => {
    const p = roomProject();
    const offer = realProducts(PRODUCTS);
    const r = parseDesignAnswer({ items: [{ catalogId: 'ik-sofa' }, { catalogId: 'mx-shelf' }, { catalogId: 'ik-lamp' }] }, offer);
    const s = suggestFurnishing(p, [{ roomId: p.rooms[0].id, type: 'living', wishes: r.picks.map(({ catalogId, quantity }) => ({ catalogId, quantity })) }], offer);
    expect(s.items).toHaveLength(3);
    applyFurnishing(p, s);
    const d = derivePlan(p);
    for (const f of p.furniture) expect(placementIssues(p, d, f).map((i) => `${f.name}: ${i.message}`)).toEqual([]);
    const shelf = p.furniture.find((f) => f.catalogId === 'mx-shelf')!;
    expect(shelf.retailer).toBe('Möbelix Österreich');
    expect(shelf.productUrl).toBe('https://www.moebelix.at/p/mx-shelf');
  });
});
