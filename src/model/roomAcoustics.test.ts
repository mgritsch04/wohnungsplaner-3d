import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { derivePlan } from './derived';
import { runPlanCheck } from './planCheck';
import { formatSeconds, roomAcoustics, sabine, suggestionText, targetReverb } from './roomAcoustics';
import { createSampleProject } from './sample';
import type { Project } from './schema';

const acoustics = (p: Project) => roomAcoustics(p, derivePlan(p));
const living = (p: Project) => acoustics(p).find((r) => r.name === 'Wohnzimmer')!;
const put = (p: Project, id: string, x: number, y: number, rotation = 0) => p.furniture.push(createFurnitureFromCatalog(findCatalogItem(id)!, { x, y, rotation }));

function emptyLiving(): Project {
  const p = createSampleProject();
  p.furniture = [];
  return p;
}

describe('Raumakustik (#494)', () => {
  it('Sabine und Zielwert', () => {
    expect(sabine(50, 8.05)).toBeCloseTo(1, 2);
    expect(targetReverb(50)).toBeCloseTo(0.49, 2);
    expect(targetReverb(10)).toBeCloseTo(targetReverb(30), 5); // Formel gilt ab 30 m³
    expect(formatSeconds(1.234)).toBe('1,2 s');
  });

  it('leeres Wohnzimmer mit Parkett: hallt, mit Nachhallzeit über dem Zielbereich', () => {
    const r = living(emptyLiving());
    expect(r.level).toBe('poor');
    expect(r.reverb).toBeGreaterThan(1.2);
    expect(r.reverb).toBeLessThan(3);
    expect(r.reverb).toBeGreaterThan(r.limit);
  });

  it('Teppich, Sofa und Vorhang: Wert sinkt und die Ampel wird besser', () => {
    const p = emptyLiving();
    const before = living(p);
    put(p, 'generic-sofa-3', 2.85, 3.5, Math.PI);
    put(p, 'generic-rug-200', 2.85, 2.3);
    const mid = living(p);
    expect(mid.reverb).toBeLessThan(before.reverb);
    expect(mid.level).not.toBe('poor');
    put(p, 'generic-curtain', 2.5, 0.2);
    expect(living(p).reverb).toBeLessThan(mid.reverb);
  });

  it('Teppichboden hallt weniger als Parkett', () => {
    const wood = living(emptyLiving());
    const p = emptyLiving();
    p.rooms.find((r) => r.name === 'Wohnzimmer')!.floorMaterialId = 'mat_floor_carpet';
    expect(living(p).reverb).toBeLessThan(wood.reverb);
  });

  it('jeder Vorschlag nennt eine ungefähre Wirkung in Sekunden', () => {
    const r = living(emptyLiving());
    expect(r.suggestions.length).toBeGreaterThanOrEqual(3);
    for (const s of r.suggestions) {
      expect(s.delta).toBeLessThanOrEqual(-0.05);
      expect(suggestionText(s)).toMatch(/bringt ca\. −\d,\d s$/);
    }
    expect(r.suggestions.some((s) => /Teppich/.test(s.label))).toBe(true);
    // am stärksten wirkende zuerst
    const deltas = r.suggestions.map((s) => s.delta);
    expect(deltas).toEqual([...deltas].sort((a, b) => a - b));
  });

  it('mit großem Teppich wird kein zweiter vorgeschlagen', () => {
    const p = emptyLiving();
    put(p, 'generic-rug-200', 2.85, 2.3);
    expect(living(p).suggestions.some((s) => /Teppich/.test(s.label))).toBe(false);
  });

  it('Bad, Flur und Balkon werden nicht bewertet', () => {
    const p = emptyLiving();
    const room = p.rooms.find((r) => r.name === 'Schlafzimmer')!;
    room.name = 'Bad';
    expect(acoustics(p).map((r) => r.name)).toEqual(['Wohnzimmer']);
    room.name = 'Balkon';
    expect(acoustics(p).map((r) => r.name)).toEqual(['Wohnzimmer']);
  });

  it('Arbeitszimmer wird strenger bewertet als Wohnzimmer', () => {
    const p = emptyLiving();
    const same = living(p);
    p.rooms.find((r) => r.name === 'Wohnzimmer')!.name = 'Arbeitszimmer';
    const work = acoustics(p).find((r) => r.name === 'Arbeitszimmer')!;
    expect(work.usage).toBe('work');
    expect(work.limit).toBeLessThan(same.limit);
  });

  it('Wohnungs-Check: eigene Kategorie, als Schätzung gekennzeichnet; Beispielwohnung bleibt nicht rot', () => {
    const p = emptyLiving();
    const r = runPlanCheck(p, derivePlan(p));
    const item = r.items.find((i) => i.category === 'acoustics' && i.select?.type === 'room');
    expect(item?.title).toMatch(/hallt: Nachhallzeit ca. \d,\d s/);
    expect(item?.detail).toMatch(/Schätzung/);
    expect(item?.detail).toMatch(/bringt ca\. −/);
    expect(item?.severity).toBe('warn');
    expect(r.perCategory.find((c) => c.category === 'acoustics')?.checked).toBe(true);
    const sample = createSampleProject();
    expect(runPlanCheck(sample, derivePlan(sample)).traffic).not.toBe('red');
  });
});
