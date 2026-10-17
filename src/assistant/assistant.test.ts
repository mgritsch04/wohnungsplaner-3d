import { afterEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { placementIssues } from '../model/placement';
import { createSampleProject } from '../model/sample';
import { applyFurnishing, suggestFurnishing, WISH_CATALOG } from '../suggest/furnishing';
import { buildPrompt, MAX_QUANTITY, MAX_SUGGESTIONS, parseAnswer } from './answer';
import { summarizePlan } from './planSummary';

function roomProject() {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3.5, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: 3.5 + 0.06 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = closestWall(p, { x: 2, y: -0.06 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

describe('Plan-Zusammenfassung für Claude (#151)', () => {
  it('nennt Räume mit Fläche, Türen, Fenstern und Möbeln, aber keinen Projektnamen', () => {
    const p = roomProject();
    const s = summarizePlan(p);
    expect(s.roomKeys).toEqual({ R1: p.rooms[0].id });
    expect(s.text).toContain('R1 „Wohnzimmer“ (Typ: Wohnzimmer)');
    expect(s.text).toMatch(/Fläche 1[34](\.\d+)? m²/);
    expect(s.text).toContain('Türen 1');
    expect(s.text).toContain('Fenster 1');
    expect(s.text).toContain('Möbel: keine');
    expect(s.text).not.toContain('Mustermann');
  });

  it('zählt Möbel je Raum und kann auf einen Raum eingeschränkt werden', () => {
    const p = createSampleProject();
    const all = summarizePlan(p);
    expect(Object.keys(all.roomKeys)).toHaveLength(p.rooms.length);
    expect(all.text).toContain('Sofa');
    const living = p.rooms.find((r) => r.name === 'Wohnzimmer')!;
    const one = summarizePlan(p, { focusRoomId: living.id });
    expect(one.text).toContain('Gewählter Raum');
    expect(one.text.match(/^- R\d+/gm)).toHaveLength(1);
    // the key stays the one of the whole plan, so answers map back correctly
    const key = Object.entries(one.roomKeys).find(([, id]) => id === living.id)![0];
    expect(one.text).toContain(`${key} „Wohnzimmer“`);
  });

  it('der Prompt enthält Frage, Plan und nur Katalog-Ids, keine Preise', () => {
    const p = roomProject();
    const prompt = buildPrompt('  Wie wird es gemütlicher?  ', summarizePlan(p), WISH_CATALOG);
    expect(prompt).toContain('Frage: Wie wird es gemütlicher?');
    expect(prompt).toContain('generic-armchair: Sessel');
    expect(prompt).not.toMatch(/€|EUR/);
  });
});

describe('Antwort von Claude prüfen (#151)', () => {
  const p = roomProject();
  const plan = summarizePlan(p);
  const roomId = p.rooms[0].id;

  it('übernimmt nur Möbel aus dem Katalog und ordnet Räume zu', () => {
    const out = parseAnswer(
      {
        suggestions: [
          { title: 'Leseecke', detail: 'Sessel und Stehlampe ans Fenster.', room: 'r1', furniture: [{ catalogId: 'generic-armchair', quantity: 1 }, { catalogId: 'generic-floor-lamp' }, { catalogId: 'ikea-erfunden-123', quantity: 1 }] },
          { title: 'Hellere Wandfarbe', detail: 'Warmes Weiß.', room: null, furniture: [] },
        ],
      },
      plan,
      WISH_CATALOG,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Leseecke', roomId, dropped: 1 });
    expect(out[0].furniture).toEqual([
      { catalogId: 'generic-armchair', quantity: 1 },
      { catalogId: 'generic-floor-lamp', quantity: 1 },
    ]);
    expect(out[1]).toMatchObject({ roomId: null, furniture: [] });
  });

  it('begrenzt Anzahl und Menge, verwirft Möbel ohne Raum und leere Titel', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ title: `V${i}`, room: 'R9', furniture: [{ catalogId: 'generic-chair', quantity: 50 }] }));
    const out = parseAnswer([{ title: '' }, ...many], plan, WISH_CATALOG);
    expect(out.length).toBeLessThanOrEqual(MAX_SUGGESTIONS);
    // unknown room key without focus → no room → furniture cannot be placed
    expect(out[0]).toMatchObject({ roomId: null, furniture: [], dropped: 1 });
    const focused = parseAnswer([{ title: 'Stühle', furniture: [{ catalogId: 'generic-chair', quantity: 50 }] }], plan, WISH_CATALOG, roomId);
    expect(focused[0].furniture).toEqual([{ catalogId: 'generic-chair', quantity: MAX_QUANTITY }]);
  });

  it('wirft bei unbrauchbarer Antwort', () => {
    expect(() => parseAnswer('Hallo', plan, WISH_CATALOG)).toThrow();
    expect(() => parseAnswer({ suggestions: [] }, plan, WISH_CATALOG)).toThrow();
  });

  it('Möbel-Vorschläge werden kollisionsfrei aufgestellt und in einem Schritt übernommen', () => {
    const [s] = parseAnswer({ suggestions: [{ title: 'Leseecke', room: 'R1', furniture: [{ catalogId: 'generic-armchair', quantity: 2 }] }] }, plan, WISH_CATALOG);
    const preview = suggestFurnishing(p, [{ roomId: s.roomId!, type: 'living', wishes: s.furniture }]);
    expect(preview.items.length).toBe(2);
    const d = structuredClone(p);
    applyFurnishing(d, preview);
    const dp = derivePlan(d);
    for (const f of d.furniture) expect(placementIssues(d, dp, f)).toEqual([]);
  });
});

describe('Claude-Laufzeit (#151)', () => {
  afterEach(() => {
    delete (globalThis as { claude?: unknown }).claude;
  });
  it('ohne Artefakt-Laufzeit ist Claude nicht verfügbar', async () => {
    const { loadSample } = await import('./claude');
    await expect(loadSample()).resolves.toBeNull();
  });
});
