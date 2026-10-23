import { beforeEach, describe, expect, it } from 'vitest';
import { summarizePlan } from '../assistant/planSummary';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import type { Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { budgetOf, buildConceptPrompt, conceptByRules, EMPTY_CONCEPT_WISHES, itemsUpTo, parseConceptAnswer, suggestionOf } from './concept';
import { useConceptStore } from './conceptStore';
import { productById } from './catalog';
import { suggestSmartHome } from './suggest';
import { applySmartHomeSuggestion, useSmartSuggestStore } from './suggestStore';

const T = 0.12;

function flat(): Project {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 6, name: 'Wohnzimmer', thickness: T, height: 2.6 });
  addRectRoom(p, { x: 4 + T, y: 0, width: 1.4, depth: 4, name: 'Flur', thickness: T, height: 2.6 });
  const win = closestWall(p, { x: 2, y: -T / 2 }, 0.2);
  if (win) addOpening(p, win.wall.id, 'window', win.s);
  const inner = closestWall(p, { x: 4 + T / 2, y: 2 }, 0.3);
  if (inner) addOpening(p, inner.wall.id, 'door', inner.s);
  const entrance = closestWall(p, { x: 5, y: 4 + T / 2 }, 0.3);
  if (entrance) addOpening(p, entrance.wall.id, 'door', entrance.s);
  p.lights.push({ id: 'l1', name: 'Deckenlampe', x: 2, y: 3, elevation: 2.4, temperature: 2700, intensity: 1, on: false });
  return p;
}

function setup() {
  const project = useProjectStore.getState().project;
  const plan = summarizePlan(project);
  const base = suggestSmartHome(project);
  const key = (name: string) => Object.entries(plan.roomKeys).find(([, id]) => project.rooms.find((r) => r.id === id)?.name === name)![0];
  return { project, plan, base, living: key('Wohnzimmer'), hall: key('Flur') };
}

describe('Smart-Home-Konzept für die ganze Wohnung (#375)', () => {
  beforeEach(() => {
    useProjectStore.getState().load(flat());
    useSmartSuggestStore.getState().setPreview(null);
    useConceptStore.getState().set({ concept: null, upTo: 3 });
  });

  it('regelbasiert: alle Räume, Phasen nach Gerätetyp, Szenen nur mit vorhandenen Geräten, Zentrale lokal', () => {
    const { project, base } = setup();
    const c = conceptByRules(project, base);
    expect(c.source).toBe('rules');
    expect(c.rooms.map((r) => project.rooms.find((x) => x.id === r.roomId)!.name).sort()).toEqual(['Flur', 'Wohnzimmer']);
    expect(c.items).toHaveLength(base.items.length);
    expect(c.items.filter((i) => i.kind === 'contact').every((i) => i.phase === 1)).toBe(true);
    expect(c.scenes.map((s) => s.name)).toEqual(expect.arrayContaining(['Abwesend', 'Nacht', 'Ankunft', 'Lüften']));
    // without any device no scene is offered
    const empty = conceptByRules(project, { ...base, items: [] });
    expect(empty.scenes).toEqual([]);
    expect(c.network.facts.join(' ')).toContain('Zigbee');
  });

  it('Budget: nur aus Katalogpreisen, je Raum und gesamt, Zentrale getrennt und mit Quelle', () => {
    const { project, base } = setup();
    const c = conceptByRules(project, base);
    const b = budgetOf(c, 3);
    let min = 0;
    for (const it of c.items) min += productById(it.productId)?.priceEur?.[0] ?? 0;
    expect(b.devices.min).toBeCloseTo(min, 2);
    expect(b.rooms.map((r) => r.cost.min).reduce((t, v) => t + v, 0)).toBeCloseTo(min, 2);
    expect(b.central.parts[0].name).toBe('Home Assistant Green');
    expect(b.central.parts.every((p) => p.source.startsWith('https://') && p.price > 0)).toBe(true);
    expect(b.total.min).toBeCloseTo(min + b.central.total, 2);
    // Phase 1 is cheaper than everything
    expect(budgetOf(c, 1).total.max).toBeLessThanOrEqual(b.total.max);
    expect(budgetOf(c, 1).devices.max).toBeLessThan(b.devices.max);
    // nothing placed → no central unit
    expect(budgetOf(conceptByRules(project, { ...base, items: [] }), 3).central.parts).toEqual([]);
  });

  it('Prompt: ganze Wohnung, Geräte mit Schlüssel, keine Positionen, kein Projektname, keine Links', () => {
    const { project, plan, base } = setup();
    const prompt = buildConceptPrompt({ ...EMPTY_CONCEPT_WISHES, habits: 'zwei Personen', wants: 'Licht nachts gedimmt', budget: 300 }, plan, base, project);
    expect(prompt).toContain('ganzheitliches Konzept');
    expect(prompt).toContain('Alltag: zwei Personen');
    expect(prompt).toContain('höchstens 300 €');
    expect(prompt).toContain('K1:');
    expect(prompt).toContain('„Wohnzimmer“');
    expect(prompt).not.toContain('Mustermann');
    expect(prompt).not.toContain('https://');
    expect(prompt).not.toMatch(/\bx[:=]/);
  });

  it('Claude-Antwort: unbekannte Schlüssel/Räume weg, Weglassen und Phasen übernommen, Rest bleibt, Positionen unverändert', () => {
    const { project, plan, base, living, hall } = setup();
    const motion = base.items.findIndex((i) => i.kind === 'motion');
    const contact = base.items.findIndex((i) => i.kind === 'contact');
    const raw = {
      summary: 'Flur zuerst, Wohnzimmer danach.',
      rooms: [
        { room: living, role: 'Aufenthalt' },
        { room: 'R99', role: 'gibt es nicht' },
      ],
      devices: [
        { key: `K${motion + 1}`, keep: true, phase: 1, reason: 'Licht im Flur per Bewegung.' },
        { key: `K${contact + 1}`, keep: false, reason: 'Fenster wird selten geöffnet.' },
        { key: 'K99', keep: true, phase: 1 },
      ],
      scenes: [
        { name: 'Abwesend', trigger: 'Alle weg', actions: 'Alles aus', rooms: [living, hall, 'R77'] },
        { name: '', actions: '', rooms: [] },
      ],
      phases: [{ phase: 1, title: 'Flur', why: 'Alltag' }, { phase: 7, title: 'x' }],
      network: 'Zigbee lokal.',
      voice: true,
      questions: [{ question: 'Budget?', proposal: 'Phase 1' }],
      later: [{ room: hall, text: 'Feuchtesensor' }, { room: 'R88', text: 'nein' }],
    };
    const c = parseConceptAnswer(raw, { plan, project, base });
    expect(c.source).toBe('claude');
    expect(c.left).toHaveLength(1);
    expect(c.items).toHaveLength(base.items.length - 1);
    expect(c.items.find((i) => i.key === base.items[motion].key)).toMatchObject({ phase: 1, reason: 'Licht im Flur per Bewegung.', x: base.items[motion].x, y: base.items[motion].y, productId: base.items[motion].productId });
    expect(c.scenes).toHaveLength(1);
    expect(c.scenes[0].roomIds).toHaveLength(2);
    expect(c.phases[1].title).toBe('Flur');
    expect(c.voice).toBe(true);
    expect(c.later.some((l) => l.text === 'Feuchtesensor')).toBe(true);
    expect(c.dropped).toBeGreaterThanOrEqual(4);
    expect(budgetOf(c, 3).central.parts.map((p) => p.id)).toContain('ha-voice-pe');
    expect(() => parseConceptAnswer({ devices: [{ key: 'K99' }] }, { plan, project, base })).toThrow();
    expect(() => parseConceptAnswer('quatsch', { plan, project, base })).toThrow();
  });

  it('Phase wählen: Vorschau und Übernehmen nur bis zur Phase, ein Undo-Schritt, Verwerfen lässt den Plan unverändert', () => {
    const { project, base } = setup();
    const c = conceptByRules(project, base);
    const before = useProjectStore.getState().project;
    useConceptStore.getState().set({ concept: c });
    useConceptStore.getState().show(1);
    expect(useProjectStore.getState().project).toBe(before);
    const preview = useSmartSuggestStore.getState().preview!;
    expect(preview.concept).toBe(true);
    expect(preview.items).toHaveLength(itemsUpTo(c, 1).length);
    expect(preview.items.length).toBeLessThan(base.items.length);
    useConceptStore.getState().discard();
    expect(useSmartSuggestStore.getState().preview).toBeNull();
    expect(useConceptStore.getState().concept).toBeNull();
    expect(useProjectStore.getState().project).toBe(before);

    useConceptStore.getState().set({ concept: c });
    useConceptStore.getState().show(3);
    const n = applySmartHomeSuggestion(suggestionOf(c, 3));
    expect(n).toBe(base.items.length);
    expect(useProjectStore.getState().project.devices).toHaveLength(n);
    // the plan changed → the concept is stale
    expect(useConceptStore.getState().concept).toBeNull();
    expect(useSmartSuggestStore.getState().preview).toBeNull();
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.devices).toHaveLength(0);
  });
});
