import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { derivePlan } from './derived';
import { addOpening, closestWall } from './operations';
import { runPlanCheck } from './planCheck';
import { createSampleProject } from './sample';
import type { Project } from './schema';
import { findScreenGlare, glareSpansLabel } from './screenGlare';

function put(p: Project, catalogId: string, x: number, y: number, rotation = 0) {
  const item = findCatalogItem(catalogId)!;
  const f = createFurnitureFromCatalog(item, { x, y, rotation });
  p.furniture.push(f);
  return f;
}
const glare = (p: Project) => findScreenGlare(p, derivePlan(p));
const check = (p: Project) => runPlanCheck(p, derivePlan(p));

/** Wohnzimmer der Beispielwohnung, ohne Sofa/Fernseher-Vorgabe: Sofa im Westen, Fernseher an der Ostwand, Westfenster. */
function westWindowScene(): Project {
  const p = createSampleProject();
  p.furniture = p.furniture.filter((f) => !/sofa|sideboard/i.test(f.name));
  const w = closestWall(p, { x: -0.06, y: 2 }, 0.2)!;
  addOpening(p, w.wall.id, 'window', w.s, { width: 1.8 });
  put(p, 'generic-sofa-3', 1.0, 2.0, -Math.PI / 2); // schaut nach Osten
  const tv = put(p, 'generic-tv', 4.9, 2.0, Math.PI / 2); // schaut nach Westen
  return Object.assign(p, { tvId: tv.id }) as Project;
}

describe('Blendung am Bildschirm (#495)', () => {
  it('Fenster hinter dem Sofa: Spiegelung am Nachmittag/Abend mit Uhrzeit', () => {
    const p = westWindowScene();
    const g = glare(p).filter((x) => x.kind === 'reflection');
    expect(g).toHaveLength(1);
    expect(g[0].spans.length).toBeGreaterThan(0);
    for (const s of g[0].spans) expect(s.from).toBeGreaterThanOrEqual(12); // Westsonne
    expect(glareSpansLabel(g[0].spans)).toMatch(/Uhr/);
    const item = check(p).items.find((i) => i.category === 'glare' && i.id.includes('reflection'));
    expect(item?.title).toMatch(/Spiegelung \d+:\d\d–\d+:\d\d Uhr im (Winter|Frühling\/Herbst|Sommer)/);
    expect(item?.detail).toMatch(/Schätzung/);
  });

  it('Himmelsrichtung ändern: die Uhrzeiten verschieben sich (Osten statt Westen)', () => {
    const p = westWindowScene();
    p.settings.northDirection = 180;
    const g = glare(p).filter((x) => x.kind === 'reflection');
    expect(g).toHaveLength(1);
    for (const s of g[0].spans) expect(s.to).toBeLessThanOrEqual(13);
  });

  it('Vorhang/Rollo am Fenster: keine Spiegelung mehr', () => {
    const p = westWindowScene();
    const window = p.openings.find((o) => o.kind === 'window' && o.wallId === closestWall(p, { x: -0.06, y: 2 }, 0.2)!.wall.id)!;
    window.shading = { type: 'roller', closed: 1, motor: false } as typeof window.shading;
    expect(glare(p).filter((x) => x.kind === 'reflection')).toHaveLength(0);
  });

  it('Fernseher vor dem Fenster: Gegenlicht; seitlich versetzt: weg', () => {
    const p = createSampleProject();
    p.furniture = p.furniture.filter((f) => !/sideboard/i.test(f.name));
    const tv = put(p, 'generic-tv', 2.5, 0.1, 0); // vor dem Nordfenster, schaut ins Zimmer
    const g = glare(p).filter((x) => x.kind === 'backlight');
    expect(g).toHaveLength(1);
    expect(check(p).items.some((i) => i.category === 'glare' && i.id === `glare:backlight:${tv.id}`)).toBe(true);
    tv.x = 4.6;
    expect(glare(p).filter((x) => x.kind === 'backlight')).toHaveLength(0);
  });

  it('Schreibtisch vor dem Fenster: Gegenlicht; seitlich zum Fenster gedreht: weg', () => {
    const p = createSampleProject();
    const desk = put(p, 'generic-desk', 2.5, 0.45, 0); // Rücken zum Nordfenster, Platz im Süden
    expect(glare(p).some((x) => x.kind === 'backlight' && x.furnitureId === desk.id)).toBe(true);
    const turned = check(p).items.find((i) => i.id === `glare:backlight:${desk.id}`);
    expect(turned?.detail).toMatch(/seitlich zum Fenster drehen/);
    desk.rotation = Math.PI / 2;
    desk.x = 4.5;
    desk.y = 2;
    expect(glare(p).filter((x) => x.furnitureId === desk.id)).toHaveLength(0);
  });

  it('ohne Bildschirm kein Eintrag und Kategorie nicht geprüft', () => {
    const p = createSampleProject();
    expect(glare(p)).toHaveLength(0);
    const r = check(p);
    expect(r.perCategory.find((c) => c.category === 'glare')?.checked).toBe(false);
  });
});
