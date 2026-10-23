import { describe, expect, it } from 'vitest';
import { derivePlan } from './derived';
import { runPlanCheck } from './planCheck';
import { createSampleProject } from './sample';

const run = (p = createSampleProject()) => runPlanCheck(p, derivePlan(p));

describe('Wohnungs-Check (#357)', () => {
  it('Beispielwohnung: keine Probleme, Ampel nicht rot', () => {
    const r = run();
    expect(r.counts.error).toBe(0);
    expect(r.traffic).not.toBe('red');
    expect(r.perCategory.map((c) => c.category)).toContain('doorSwing');
  });

  it('Möbel in der Wand: Eintrag mit Stelle, rote Ampel; nach dem Verschieben weg', () => {
    const p = createSampleProject();
    const sofa = p.furniture.find((f) => f.name.toLowerCase().includes('sofa'))!;
    const { x, y } = sofa;
    sofa.y = 4.2; // hinten in die Südwand
    const bad = run(p);
    const item = bad.items.find((i) => i.select?.id === sofa.id && i.category === 'collision');
    expect(item).toBeTruthy();
    expect(item!.at).toEqual({ x: sofa.x, y: sofa.y });
    expect(bad.traffic).toBe('red');
    sofa.x = x;
    sofa.y = y;
    const good = run(p);
    expect(good.items.some((i) => i.select?.id === sofa.id && i.category === 'collision')).toBe(false);
    expect(good.counts.error).toBeLessThanOrEqual(bad.counts.error - 1);
  });

  it('Möbel im Türaufschlag wird als Türaufschlag gemeldet', () => {
    const p = createSampleProject();
    const f = p.furniture.find((x) => x.name.toLowerCase().includes('nacht'))!;
    // vor die Innentür (x≈5,06, y≈2) stellen
    f.x = 4.7;
    f.y = 2;
    f.rotation = 0;
    const r = run(p);
    expect(r.items.some((i) => i.category === 'doorSwing' && i.select?.id === f.id)).toBe(true);
  });

  it('Engstelle zwischen zwei Möbeln wird gelistet', () => {
    const p = createSampleProject();
    const wardrobe = p.furniture.find((f) => f.name.toLowerCase().includes('schrank'))!;
    const bed = p.furniture.find((f) => f.name.toLowerCase().includes('bett'))!;
    wardrobe.x = bed.x - bed.width / 2 - wardrobe.width / 2 - 0.3; // 30 cm Lücke
    wardrobe.y = bed.y;
    wardrobe.rotation = 0;
    expect(run(p).items.some((i) => i.category === 'passage')).toBe(true);
  });

  it('sortiert: Probleme vor Hinweisen', () => {
    const p = createSampleProject();
    p.furniture[0].y = 4.2;
    const order = { error: 0, warn: 1, info: 2 };
    const sev = run(p).items.map((i) => order[i.severity]);
    expect(sev).toEqual([...sev].sort((a, b) => a - b));
  });
});
