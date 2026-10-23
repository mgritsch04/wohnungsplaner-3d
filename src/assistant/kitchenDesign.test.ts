import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createEmptyProject } from '../model/factory';
import { addOpening, addRectRoom, closestWall } from '../model/operations';
import { derivePlan } from '../model/derived';
import { buildPlacementObstacles, furnitureConflicts } from '../model/placement';
import { applyFurnishing, roomIdAt, suggestFurnishing } from '../suggest/furnishing';
import { buildDesignPrompt, EMPTY_WISHES, parseDesignAnswer, proposalTotal, PLACEHOLDERS } from './design';
import { furnishWithKitchens, hasKitchen, kitchenFaces, kitchenShoppingList, parseKitchen, placeKitchen, resolveWith, runLength } from './kitchenDesign';
import { summarizePlan } from './planSummary';
import { foundToCatalog, notFoundReason, openPlaceholders, replaceKitchenWithFound, searchErrorReason, searchLeft, searchTargets } from './productSearch';

/** Kitchen 3.6 × 3 m with a door in the south wall and a window in the north wall, living room next to it. */
function flat() {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 3.6, depth: 3, name: 'Küche', thickness: 0.12, height: 2.6 });
  addRectRoom(p, { x: 3.6, y: 0, width: 4, depth: 3, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
  const south = closestWall(p, { x: 0.8, y: 3 + 0.06 }, 0.2);
  if (south) addOpening(p, south.wall.id, 'door', south.s);
  const north = closestWall(p, { x: 1.8, y: -0.06 }, 0.2);
  if (north) addOpening(p, north.wall.id, 'window', north.s);
  return p;
}

const kitchenId = (p: ReturnType<typeof flat>) => p.rooms.find((r) => r.name === 'Küche')!.id;

const RUN = [
  { catalogId: 'generic-k-tall-60', search: 'Hochschrank weiß' },
  { catalogId: 'generic-k-sink-80', search: 'Spülenschrank 80' },
  { catalogId: 'generic-k-dishwasher', search: 'Geschirrspüler vollintegriert' },
  { catalogId: 'generic-k-oven', search: 'Backofen Einbau', above: [{ catalogId: 'generic-k-cooktop', search: 'Induktionskochfeld' }, { catalogId: 'generic-k-hood-60', search: 'Dunstabzug 60' }] },
  { catalogId: 'generic-k-base-60', width_cm: 50, search: 'Unterschrank weiß', above: [{ catalogId: 'generic-k-wall-60', search: 'Oberschrank weiß' }] },
];

const answer = (runs: unknown[] = [RUN]) => ({ fronts: 'weiß matt, Arbeitsplatte Eiche', frontColor: '#FFFFFF', reason: 'hell und schlicht', runs });

describe('kitchen in the furnishing proposal (#350)', () => {
  it('lists the wall faces inside the kitchen, with door and window', () => {
    const p = flat();
    const faces = kitchenFaces(p, kitchenId(p));
    expect(faces).toHaveLength(4);
    expect(faces[0].length).toBeGreaterThan(3.3);
    expect(faces.flatMap((f) => f.openings.map((o) => o.kind)).sort()).toEqual(['door', 'window']);
    expect(hasKitchen(p, kitchenId(p))).toBe(false);
  });

  it('asks for a kitchen run with wall lengths and modules only for a kitchen without one', () => {
    const p = flat();
    const plan = summarizePlan(p, { focusRoomId: kitchenId(p) });
    const with_ = buildDesignPrompt(EMPTY_WISHES, plan, [], PLACEHOLDERS, undefined, kitchenFaces(p, kitchenId(p)));
    expect(with_).toContain('Plane die Küchenzeile im Feld "kitchen"');
    expect(with_).toContain('generic-k-sink-80');
    expect(with_).toMatch(/Wand 1: nutzbar \d+ cm/);
    expect(with_).toContain('Fenster');
    expect(with_).not.toContain('keine Küchenzeilen planen');
    const without = buildDesignPrompt(EMPTY_WISHES, plan, [], PLACEHOLDERS);
    expect(without).toContain('keine Küchenzeilen planen');
    expect(without).not.toContain('generic-k-sink-80');
  });

  it('parses the kitchen: known modules only, above-modules only above, widths clamped', () => {
    const { kitchen, dropped } = parseKitchen(
      answer([[...RUN, { catalogId: 'generic-k-wall-60' }, { catalogId: 'erfunden-123' }, { catalogId: 'generic-k-base-40', width_cm: 500, above: [{ catalogId: 'generic-k-base-60' }] }]]),
    );
    expect(dropped).toBe(3);
    expect(kitchen!.frontColor).toBe('#ffffff');
    const run = kitchen!.runs[0];
    expect(run.map((s) => s.catalogId)).toEqual(['generic-k-tall-60', 'generic-k-sink-80', 'generic-k-dishwasher', 'generic-k-oven', 'generic-k-base-60', 'generic-k-base-40']);
    expect(run[3].above.map((a) => a.catalogId)).toEqual(['generic-k-cooktop', 'generic-k-hood-60']);
    expect(run[4].width).toBe(0.5);
    expect(run[5].width).toBe(1.2);
    expect(run[5].above).toEqual([]);
    expect(parseKitchen({ runs: [[{ catalogId: 'nix' }]] }).kitchen).toBeNull();
  });

  it('takes the kitchen only for kitchen rooms; a room with only a kitchen is usable', () => {
    const p = flat();
    const plan = summarizePlan(p);
    const key = (name: string) => Object.entries(plan.roomKeys).find(([, id]) => p.rooms.find((r) => r.id === id)?.name === name)![0];
    const raw = {
      rooms: [
        { room: key('Küche'), type: 'kitchen', items: [], kitchen: answer() },
        { room: key('Wohnzimmer'), type: 'living', items: [{ catalogId: 'generic-sofa-3' }], kitchen: answer() },
      ],
    };
    const res = parseDesignAnswer(raw, plan, p.rooms.map((r) => r.id), [], PLACEHOLDERS, [kitchenId(p)]);
    expect(res.rooms.find((r) => r.roomId === kitchenId(p))!.kitchen!.runs[0]).toHaveLength(5);
    expect(res.rooms.find((r) => r.roomId !== kitchenId(p))!.kitchen).toBeUndefined();
    expect(res.dropped).toBe(1);
    // the kitchen counts into the guide total (modules + countertop)
    expect(proposalTotal(res, PLACEHOLDERS).placeholder).toBeGreaterThan(2000);
  });

  it('places the run collision-free against a free wall of the kitchen, with countertop', () => {
    const p = flat();
    const { kitchen } = parseKitchen(answer());
    const resolve = resolveWith([]);
    const { items, missing } = placeKitchen(p, kitchenId(p), kitchen!, resolve);
    expect(missing).toEqual([]);
    const d = derivePlan(p);
    for (const f of items) expect(roomIdAt(p, d, f)).toBe(kitchenId(p));
    expect(items.filter((f) => f.kitchen?.type === 'countertop')).toHaveLength(1);
    expect(items.every((f) => f.kitchen?.type === 'countertop' || f.kitchen?.frontColor === '#ffffff')).toBe(true);
    // in the project: no conflicts with walls, door or window
    const q = structuredClone(p);
    q.furniture.push(...items);
    const dq = derivePlan(q);
    expect([...furnitureConflicts(q, dq, buildPlacementObstacles(dq)).values()].flatMap((c) => c.issues.map((i) => i.message))).toEqual([]);
    expect(runLength(kitchen!.runs[0], resolve)).toBeCloseTo(0.6 + 0.8 + 0.6 + 0.6 + 0.5, 6);
  });

  it('puts a second row on another wall (L shape) and reports modules without room', () => {
    const p = flat();
    const long = Array.from({ length: 9 }, () => ({ catalogId: 'generic-k-base-60' }));
    const { kitchen } = parseKitchen(answer([RUN, long]));
    const { items, missing } = placeKitchen(p, kitchenId(p), kitchen!, resolveWith([]));
    const walls = new Set(items.filter((f) => f.kitchen?.type !== 'countertop').map((f) => Math.round(f.rotation * 100)));
    expect(walls.size).toBe(2);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.every((m) => m === 'Unterschrank 60 cm')).toBe(true);
  });

  it('places the other furniture around the kitchen in the preview and takes all in one step', () => {
    const p = flat();
    const { kitchen } = parseKitchen(answer());
    const id = kitchenId(p);
    const preview = furnishWithKitchens(p, [{ roomId: id, roomName: 'Küche', type: 'kitchen', kitchen: kitchen! }], resolveWith([]), (draft) =>
      suggestFurnishing(draft, [{ roomId: id, type: 'kitchen', wishes: [{ catalogId: 'generic-dining-table-4', quantity: 1 }] }]),
    );
    const room = preview.rooms.find((r) => r.roomId === id)!;
    expect(room.placed.filter((f) => f.kitchen).length).toBeGreaterThanOrEqual(8);
    applyFurnishing(p, preview);
    expect(hasKitchen(p, id)).toBe(true);
    const d = derivePlan(p);
    expect([...furnitureConflicts(p, d, buildPlacementObstacles(d)).values()].flatMap((c) => c.issues.map((i) => i.message))).toEqual([]);
  });

  it('searches each distinct kitchen module once and swaps all of them for the found product', () => {
    const p = flat();
    const plan = summarizePlan(p, { focusRoomId: kitchenId(p) });
    const twice = [...RUN, { catalogId: 'generic-k-base-60', search: 'Unterschrank weiß' }];
    const proposal = parseDesignAnswer({ rooms: [{ room: 'R1', items: [{ catalogId: 'generic-dining-table-4' }], kitchen: answer([twice]) }] }, plan, [kitchenId(p)], [], PLACEHOLDERS, [kitchenId(p)]);
    const open = openPlaceholders(proposal);
    expect(open.filter((t) => t.kitchen)).toHaveLength(8);
    expect(open.filter((t) => !t.kitchen)).toHaveLength(1);
    const size = (id: string) => {
      const c = findCatalogItem(id)!;
      return c.width * c.depth * c.height;
    };
    const { targets, skipped } = searchTargets(proposal, size, 3);
    // biggest pieces first: dining table, tall cabinet, then the next largest module
    expect(targets.map((t) => t.kitchen?.split('|')[0] ?? 'pick')).toEqual(['pick', 'generic-k-tall-60', expect.stringMatching(/^generic-k-/)]);
    expect(skipped).toBe(6);

    const key = kitchenShoppingList(proposal.rooms[0].kitchen!).find((x) => x.part.base === 'generic-k-base-60')!.key;
    const found = foundToCatalog({ name: 'TEST Unterschrank', url: 'https://www.ikea.com/at/de/p/test-1', shop: 'IKEA', price: 99, width: 0.6, depth: 0.61, height: 0.8, why: '' }, findCatalogItem('generic-k-base-60')!);
    expect(found.kitchen?.type).toBe('base');
    const next = replaceKitchenWithFound(proposal, kitchenId(p), key, [found]);
    const swapped = next.rooms[0].kitchen!.runs[0].filter((s) => s.catalogId === found.id);
    expect(swapped).toHaveLength(2);
    expect(swapped.every((s) => s.width === undefined)).toBe(true);
    expect(openPlaceholders(next)).toHaveLength(open.length - 1);
    // the found product stands in the run like the module
    const placed = placeKitchen(p, kitchenId(p), next.rooms[0].kitchen!, resolveWith([found]));
    expect(placed.items.filter((f) => f.catalogId === found.id)).toHaveLength(2);
    expect(proposalTotal(next, [found, ...PLACEHOLDERS]).real).toBe(198);
  });

  it('says how many products are still searched and why one was not found', () => {
    expect(searchLeft({ done: 5, total: 12 })).toBe('noch 7 von 12 offen');
    expect(searchLeft({ done: 12, total: 12 })).toBe('alle 12 fertig');
    expect(notFoundReason({ products: [] }, 0)).toBe('kein passendes Produkt im Shop gefunden');
    expect(notFoundReason({ products: [{ name: 'x' }, { name: 'y' }] }, 0)).toMatch(/^2 Treffer ohne vollständige Angaben/);
    expect(searchErrorReason({ code: 'invalid_json' })).toBe('Antwort von Claude war nicht lesbar');
    expect(searchErrorReason({ code: 'upstream_error', message: 'HTTP 502' })).toBe('Suche fehlgeschlagen (HTTP 502)');
  });
});
