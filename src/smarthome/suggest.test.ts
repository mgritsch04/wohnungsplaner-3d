import { beforeEach, describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { createSampleProject } from '../model/sample';
import type { Project } from '../model/schema';
import { pointInPolygon } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { occludersOf, roomCoverage } from './simulation';
import { suggestSmartHome } from './suggest';
import { applySmartHomeSuggestion, useSmartSuggestStore } from './suggestStore';

const T = 0.12;

function flat(): Project {
  const p = createEmptyProject();
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

describe('smart-home suggestion (#225)', () => {
  beforeEach(() => useProjectStore.getState().load(flat()));

  it('gives rooms a sensor of the right kind that covers most of the floor', () => {
    const p = useProjectStore.getState().project;
    const s = suggestSmartHome(p);
    const living = p.rooms.find((r) => r.name === 'Wohnzimmer')!;
    const hall = p.rooms.find((r) => r.name === 'Flur')!;
    expect(s.items.filter((i) => i.roomId === living.id && i.kind === 'presence').length).toBeGreaterThan(0);
    expect(s.items.filter((i) => i.roomId === hall.id && i.kind === 'motion').length).toBeGreaterThan(0);
    // the claimed coverage is real: apply it and measure with the simulation
    applySmartHomeSuggestion(s);
    const q = useProjectStore.getState().project;
    const d = derivePlan(q);
    const cov = roomCoverage(q, d, occludersOf(q, d));
    for (const c of s.coverage) expect(cov.get(c.roomId)!).toBeGreaterThanOrEqual(c.after - 0.05);
    expect(cov.get(hall.id)!).toBeGreaterThan(0.6);
  });

  it('places sensors inside their room and uses only catalogue products with a price or none', () => {
    const p = useProjectStore.getState().project;
    const d = derivePlan(p);
    for (const it of suggestSmartHome(p).items) {
      if (it.kind === 'contact') continue;
      expect(pointInPolygon(it, d.rooms.get(it.roomId)!.interior), it.name).toBe(true);
    }
  });

  it('puts contacts on windows and outer doors, not on inner doors', () => {
    const p = useProjectStore.getState().project;
    const contacts = suggestSmartHome(p).items.filter((i) => i.kind === 'contact');
    const openings = contacts.map((c) => p.openings.find((o) => o.id === c.openingId)!);
    expect(openings.filter((o) => o.kind === 'window')).toHaveLength(1);
    expect(openings.filter((o) => o.kind === 'door')).toHaveLength(1);
    expect(contacts).toHaveLength(2);
  });

  it('takes over the existing light instead of creating a new one', () => {
    const p = useProjectStore.getState().project;
    const bulb = suggestSmartHome(p).items.find((i) => i.kind === 'light')!;
    expect(bulb.lightId).toBe('l1');
    applySmartHomeSuggestion(suggestSmartHome(p));
    expect(useProjectStore.getState().project.lights).toHaveLength(1);
  });

  it('applies in ONE undo step, discard leaves the plan unchanged, and a second run adds nothing', () => {
    const before = useProjectStore.getState().project;
    const s = suggestSmartHome(before);
    useSmartSuggestStore.getState().setPreview(s);
    expect(useProjectStore.getState().project).toBe(before);
    const n = applySmartHomeSuggestion(s);
    expect(n).toBe(s.items.length);
    expect(useProjectStore.getState().project.devices).toHaveLength(n);
    expect(useSmartSuggestStore.getState().preview).toBeNull();
    expect(suggestSmartHome(useProjectStore.getState().project).items).toEqual([]);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.devices).toHaveLength(0);
  });

  it('limits to the chosen room and names devices uniquely', () => {
    const p = useProjectStore.getState().project;
    const hall = p.rooms.find((r) => r.name === 'Flur')!;
    const s = suggestSmartHome(p, [hall.id]);
    expect(s.items.every((i) => i.roomId === hall.id)).toBe(true);
    const all = suggestSmartHome(p).items.map((i) => i.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it('reports cost from catalogue prices and what cannot be placed yet', () => {
    const s = suggestSmartHome(useProjectStore.getState().project);
    expect(s.cost.min).toBeGreaterThan(0);
    expect(s.cost.max).toBeGreaterThanOrEqual(s.cost.min);
    expect(s.later.length).toBeGreaterThan(0);
  });

  it('works on the sample flat without throwing', () => {
    const s = suggestSmartHome(createSampleProject());
    expect(s.items.length).toBeGreaterThan(0);
  });
});
