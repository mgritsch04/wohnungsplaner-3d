import { describe, expect, it } from 'vitest';
import { placeKitchenRun } from '../kitchen/kitchen';
import { generateCountertops } from '../kitchen/kitchen';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom } from '../model/operations';
import { placementIssues, buildPlacementObstacles, issueLevel } from '../model/placement';
import type { Project } from '../model/schema';
import { closestPointOnSegment } from '../model/vec';
import { applyFurnishing, suggestFurnishing, WISH_CATALOG } from '../suggest/furnishing';
import { buildEditInput, buildEditPrompt, parseEditAnswer, planEdits } from './planEdit';

/** Living room 5×4 m with a window in the lower wall, sofa and desk; bedroom to the right. */
function flat() {
  const p = createEmptyProject();
  p.name = 'Wohnung Mustermann, Beispielstraße 1';
  addRectRoom(p, { x: 0, y: 0, width: 5, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 5, y: 0, width: 3, depth: 4, name: 'Schlafzimmer', thickness: 0.12, height: 2.6 });
  const bottom = p.walls.find((w) => {
    const a = p.nodes.find((n) => n.id === w.a)!;
    const b = p.nodes.find((n) => n.id === w.b)!;
    return a.y > 3.9 && b.y > 3.9 && Math.min(a.x, b.x) < 0;
  })!;
  addOpening(p, bottom.id, 'window', 2.5, { width: 1.2, sillHeight: 0.9 });
  const [living] = p.rooms;
  applyFurnishing(
    p,
    suggestFurnishing(p, [{ roomId: living.id, type: 'living', wishes: [{ catalogId: 'generic-sofa-3', quantity: 1 }, { catalogId: 'generic-desk', quantity: 1 }] }]),
  );
  return p;
}

const keyOf = (input: ReturnType<typeof buildEditInput>, p: Project, name: string) => Object.entries(input.itemKeys).find(([, id]) => p.furniture.find((f) => f.id === id)?.name === name)![0];

function noCollision(p: Project) {
  const d = derivePlan(p);
  const obstacles = buildPlacementObstacles(d);
  return p.furniture.every((f) => !placementIssues(p, d, f, obstacles).some((i) => issueLevel(i.kind) === 'error'));
}

describe('Plan per Textanweisung ändern (#415)', () => {
  it('Prompt: Wände mit Lage, Fenster und Nachbarraum, Möbel mit Schlüssel, keine persönlichen Angaben', () => {
    const p = flat();
    const input = buildEditInput(p, null);
    const prompt = buildEditPrompt('Sofa ans Fenster', input, WISH_CATALOG);
    expect(prompt).toContain('Anweisung: Sofa ans Fenster');
    expect(prompt).toMatch(/W\d \(unten\): 4,94 m, 1 Fenster/);
    expect(prompt).toContain('grenzt an R2 „Schlafzimmer“');
    expect(prompt).toMatch(/M\d: Sofa 3-Sitzer, 210×90 cm, steht an W\d/);
    expect(prompt).not.toContain('Mustermann');
    // one room: only its walls and furniture
    const one = buildEditInput(p, p.rooms[1].id);
    expect(one.text).not.toContain('Sofa');
    expect(one.roomIds).toEqual([p.rooms[1].id]);
  });

  it('Antwort: Unbekanntes, Fixiertes und erfundene Katalog-Ids fallen weg', () => {
    const p = flat();
    const desk = p.furniture.find((f) => f.name.startsWith('Schreibtisch'))!;
    desk.locked = true;
    const input = buildEditInput(p, null);
    const d = derivePlan(p);
    const sofa = keyOf(input, p, 'Sofa 3-Sitzer');
    const a = parseEditAnswer(
      {
        summary: 'x',
        changes: [
          { op: 'move', item: sofa, near: 'window', why: 'Licht' },
          { op: 'remove', item: keyOf(input, p, desk.name) },
          { op: 'add', room: 'R1', catalogId: 'ikea-erfunden-123' },
          { op: 'move', item: 'M99', wall: 'W1' },
          { op: 'teleport', item: sofa },
        ],
        notPossible: ['Wand zum Schlafzimmer entfernen: Wände ändert die App nicht.'],
      },
      input,
      p,
      d,
      WISH_CATALOG,
    );
    expect(a.changes).toEqual([expect.objectContaining({ op: 'move', near: { kind: 'window' } })]);
    expect(a.dropped).toBe(4);
    expect(a.notPossible).toHaveLength(1);
    expect(() => parseEditAnswer({ changes: [{ op: 'remove', item: 'M99' }] }, input, p, d, WISH_CATALOG)).toThrow();
  });

  it('Sofa ans Fenster, Schreibtisch dafür an die alte Sofa-Wand: gleiche Möbel, neue Stellen, ohne Kollision', () => {
    const p = flat();
    const input = buildEditInput(p, null);
    const sofa = p.furniture.find((f) => f.name === 'Sofa 3-Sitzer')!;
    const desk = p.furniture.find((f) => f.name.startsWith('Schreibtisch'))!;
    const w = input.walls[p.rooms[0].id].findIndex((x) => x.side === 'unten');
    const old = input.walls[p.rooms[0].id].findIndex((x) => x.side === 'oben');
    const a = parseEditAnswer(
      {
        changes: [
          { op: 'move', item: keyOf(input, p, sofa.name), wall: `W${w + 1}`, near: 'window', why: 'Licht' },
          { op: 'move', item: keyOf(input, p, desk.name), wall: `W${old + 1}`, why: 'Platz' },
        ],
      },
      input,
      p,
      derivePlan(p),
      WISH_CATALOG,
    );
    const plan = planEdits(p, input, a);
    expect(plan.results).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    expect(plan.results.every((r) => !r.note)).toBe(true);
    expect(plan.preview.items.map((f) => f.id).sort()).toEqual([sofa.id, desk.id].sort());
    expect(plan.preview.replaces?.sort()).toEqual([sofa.id, desk.id].sort());
    const moved = plan.preview.items.find((f) => f.id === sofa.id)!;
    const wall = input.walls[p.rooms[0].id][w];
    expect(closestPointOnSegment(moved, wall.a, wall.b).distance).toBeLessThan(moved.depth / 2 + 0.05);
    expect(Math.abs(moved.x - 2.5)).toBeLessThan(1);
    // taking it: one piece moved, nothing else changed
    const next = structuredClone(p);
    applyFurnishing(next, plan.preview);
    expect(next.furniture).toHaveLength(p.furniture.length);
    expect(next.furniture.find((f) => f.id === desk.id)!.y).toBeLessThan(1);
    expect(noCollision(next)).toBe(true);
  });

  it('Entfernen, Tauschen und Hinzufügen in einem Schritt', () => {
    const p = flat();
    const input = buildEditInput(p, null);
    const desk = p.furniture.find((f) => f.name.startsWith('Schreibtisch'))!;
    const sofa = p.furniture.find((f) => f.name === 'Sofa 3-Sitzer')!;
    const a = parseEditAnswer(
      {
        changes: [
          { op: 'replace', item: keyOf(input, p, desk.name), catalogId: 'generic-shelf-80', why: 'mehr Stauraum' },
          { op: 'remove', item: keyOf(input, p, sofa.name), why: 'raus' },
          { op: 'add', room: 'R2', catalogId: 'generic-armchair', quantity: 1, why: 'Leseecke' },
        ],
      },
      input,
      p,
      derivePlan(p),
      WISH_CATALOG,
    );
    const plan = planEdits(p, input, a, { catalog: WISH_CATALOG });
    expect(plan.results.every((r) => r.ok)).toBe(true);
    expect(plan.preview.replaces?.sort()).toEqual([desk.id, sofa.id].sort());
    const next = structuredClone(p);
    applyFurnishing(next, plan.preview);
    expect(next.furniture.map((f) => f.name).sort()).toEqual(['Regal 80×190', 'Sessel']);
    const d = derivePlan(next);
    expect(next.furniture.find((f) => f.name === 'Sessel')).toBeDefined();
    expect(d.rooms.size).toBe(2);
    expect(noCollision(next)).toBe(true);
  });

  it('Küchenzeile an die gegenüberliegende Wand: alle Module ziehen um, Arbeitsplatte neu', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 3, name: 'Küche', thickness: 0.12, height: 2.6 });
    const top = p.walls.find((w) => p.nodes.find((n) => n.id === w.a)!.y < 0 && p.nodes.find((n) => n.id === w.b)!.y < 0)!;
    const d0 = derivePlan(p);
    const fp = d0.footprints.get(top.id)!;
    const inside = fp.normal.y > 0 ? 1 : -1;
    placeKitchenRun(p, { wallId: top.id, side: inside as 1 | -1, start: 0.2, modules: [{ catalogId: 'generic-k-fridge' }, { catalogId: 'generic-k-sink-80' }, { catalogId: 'generic-k-base-60' }, { catalogId: 'generic-k-wall-60' }, { catalogId: 'generic-k-oven' }] });
    generateCountertops(p);
    const modules = p.furniture.filter((f) => f.kitchen && f.kitchen.type !== 'countertop');
    const input = buildEditInput(p, null);
    expect(input.text).toMatch(/K1: Küchenzeile an W1, 5 Module/);
    const w = input.walls[p.rooms[0].id].findIndex((x) => x.side === 'unten');
    const a = parseEditAnswer({ changes: [{ op: 'kitchen', run: 'K1', wall: `W${w + 1}`, why: 'andere Seite' }] }, input, p, derivePlan(p), WISH_CATALOG);
    const plan = planEdits(p, input, a);
    expect(plan.results[0]).toMatchObject({ ok: true });
    const next = structuredClone(p);
    applyFurnishing(next, plan.preview);
    const after = next.furniture.filter((f) => f.kitchen && f.kitchen.type !== 'countertop');
    expect(after.map((f) => f.id).sort()).toEqual(modules.map((f) => f.id).sort());
    expect(after.every((f) => f.y > 2)).toBe(true);
    const tops = next.furniture.filter((f) => f.kitchen?.type === 'countertop');
    expect(tops.length).toBe(1);
    expect(tops[0].y).toBeGreaterThan(2);
    expect(noCollision(next)).toBe(true);
  });
});
