import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { parseProject } from '../formats/project/projectFile';
import { curtainShownWidth, nextClosed, transmission, closedLabel } from '../model/shading';
import type { Automation, Project } from '../model/schema';
import { coveringItems } from '../budget/purchasePlan';
import { automationsYaml } from './haYaml';
import { ruleSentence } from './rules';
import { blindOverrides, initialState, step } from './simulation';

function flat(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Wohnen', thickness: 0.12, height: 2.6 });
  p.openings.push({ id: 'w1', wallId: p.walls[0].id, kind: 'window', offset: 2, width: 1.2, height: 1.2, sillHeight: 0.9, hinge: 'start', swing: 'left', open: false, shading: { type: 'roller', closed: 0, motor: true, price: 89.9, productName: 'Eigener Rollladen' } });
  p.devices = [{ id: 'b1', name: 'Antrieb Wohnen', kind: 'blind', openingId: 'w1', x: 2, y: 0, elevation: 2.2, rotation: 0 }];
  const a: Automation = { id: 'a1', name: 'Abends zu', enabled: true, trigger: { type: 'time', hour: 20 }, onlyWhenDark: false, action: { deviceIds: ['b1'], on: true } };
  const b: Automation = { id: 'a2', name: 'Morgens auf', enabled: true, trigger: { type: 'time', hour: 7 }, onlyWhenDark: false, action: { deviceIds: ['b1'], on: false } };
  p.automations = [a, b];
  return p;
}

describe('Fensterbehang (#413)', () => {
  it('cycles offen → halb → zu and labels the state', () => {
    expect(nextClosed(0)).toBe(0.5);
    expect(nextClosed(0.5)).toBe(1);
    expect(nextClosed(1)).toBe(0);
    expect(closedLabel(0)).toBe('offen');
    expect(closedLabel(1)).toBe('zu');
    expect(closedLabel(0.5)).toBe('50 % zu');
  });

  it('lets less light through the more it is closed', () => {
    expect(transmission(undefined)).toBe(1);
    expect(transmission({ type: 'roller', closed: 1 })).toBeLessThan(transmission({ type: 'pleated', closed: 1 }));
    expect(transmission({ type: 'venetian', closed: 0.5 })).toBeGreaterThan(transmission({ type: 'venetian', closed: 1 }));
  });

  it('draws a curtain gathered when open and full width when closed', () => {
    expect(curtainShownWidth(2, 0)).toBeCloseTo(0.5);
    expect(curtainShownWidth(2, 1)).toBeCloseTo(2);
    expect(curtainShownWidth(2, undefined)).toBeCloseTo(0.5);
  });

  it('keeps the covering and the curtain state in a saved project', () => {
    const p = flat();
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back.project.openings[0].shading).toMatchObject({ type: 'roller', motor: true, price: 89.9 });
    expect(back.project.devices[0].kind).toBe('blind');
  });

  it('simulation closes the blind in the evening and opens it in the morning', () => {
    const p = flat();
    let s = initialState(p, 19.99);
    expect(s.entities.b1.closed).toBe(0);
    s = step(p, [], s, 120, { person: null, moving: false });
    expect(s.entities.b1.closed).toBe(1);
    expect(blindOverrides(p, s).openings.get('w1')).toBe(1);
    expect(s.events.some((e) => e.text.includes('Antrieb Wohnen zu'))).toBe(true);
    s = { ...s, hour: 6.99 };
    s = step(p, [], s, 120, { person: null, moving: false });
    expect(s.entities.b1.closed).toBe(0);
  });

  it('reads the rule as a sentence and exports Home Assistant cover calls', () => {
    const p = flat();
    expect(ruleSentence(p, p.automations[0]).then).toBe('dann Antrieb Wohnen zu');
    expect(ruleSentence(p, p.automations[1]).then).toBe('dann Antrieb Wohnen auf');
    const yaml = automationsYaml(p);
    expect(yaml).toContain('cover.set_cover_position');
    expect(yaml).toContain('position: 0');
    expect(yaml).toContain('position: 100');
  });

  it('puts a priced covering into the purchase plan', () => {
    const items = coveringItems(flat());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'covering', name: 'Eigener Rollladen', total: 89.9 });
  });
});

describe('coverOpenness (#413)', () => {
  it('is 1 for an open curtain and 0 for a closed one', async () => {
    const { coverOpenness } = await import('../model/windowCover');
    expect(coverOpenness({})).toBe(1);
    expect(coverOpenness({ closed: 0.5 })).toBe(0.5);
    expect(coverOpenness({ closed: 1 })).toBe(0);
  });
});
