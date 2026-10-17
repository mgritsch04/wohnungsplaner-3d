import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from './factory';
import { addRectRoom, deleteFurniture } from './operations';
import { derivePlan } from './derived';
import { buildPlacementObstacles, collidingObstacles, furnitureObstacles } from './placement';
import {
  createGroup,
  dissolveGroups,
  expandToGroups,
  groupCenter,
  groupMemberIds,
  groupName,
  groupOf,
  moveGroupBy,
  pressFurniture,
  pruneGroups,
  regroupCopies,
  removeFromGroup,
  renameGroup,
  rotateGroupBy,
  selectedGroup,
} from './groups';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { findCatalogItem } from '../catalog/generic';
import { createSampleProject } from './sample';
import type { Furniture, Project } from './schema';
import { parseProject, parseProjectJson, serializeProject } from '../formats/project/projectFile';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import { copySelection, deleteSelection, duplicateSelection, nudgeSelection, pasteClipboard, rotateSelection } from '../ui/actions';
import { groupSelection, pressFurnitureSelection, renameGroupAction, selectSingleFurniture, ungroupSelection } from '../ui/groupActions';
import { contentHash, restoreVersionContent } from '../versions/versions';

const T = 0.12;
/** Room with a clear interior 0..6 × 0..4. */
function roomProject(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 6, depth: 4, name: 'A', thickness: T, height: 2.6 });
  return p;
}

function add(p: Project, x: number, y: number, o: Partial<Furniture> = {}, catalogId = 'generic-sideboard'): Furniture {
  const f = { ...createFurnitureFromCatalog(findCatalogItem(catalogId)!, { x, y }), ...o };
  p.furniture.push(f);
  return f;
}

const get = (p: Project, id: string) => p.furniture.find((f) => f.id === id)!;

/** Three 1 × 0.5 m items side by side in a row (a "kitchen run"), centre row at y = 2. */
function rowProject() {
  const p = roomProject();
  const items = [0, 1, 2].map((i) => add(p, 2 + i, 2, { width: 1, depth: 0.5, rotation: 0 }));
  const ids = items.map((f) => f.id);
  return { p, ids };
}

/** Distances between all pairs of members – unchanged by a rigid move/turn. */
const shape = (p: Project, ids: string[]) =>
  ids.flatMap((a, i) => ids.slice(i + 1).map((b) => Math.hypot(get(p, a).x - get(p, b).x, get(p, a).y - get(p, b).y)));

describe('furniture groups: schema and loading old projects (#65)', () => {
  it('a project saved before #65 (no groups, no groupId) loads unchanged with an empty group list', () => {
    const sample = createSampleProject();
    const raw = JSON.parse(serializeProject(sample)) as Record<string, unknown>;
    delete raw.groups;
    for (const f of raw.furniture as Record<string, unknown>[]) delete f.groupId;
    const loaded = parseProject(raw).project;
    expect(loaded.groups).toEqual([]);
    expect(loaded.furniture.every((f) => f.groupId === undefined)).toBe(true);
    expect(loaded.furniture.map((f) => [f.id, f.x, f.y, f.rotation])).toEqual(sample.furniture.map((f) => [f.id, f.x, f.y, f.rotation]));
    expect(createEmptyProject().groups).toEqual([]);
  });

  it('groups and memberships survive saving and loading', () => {
    const { p, ids } = rowProject();
    const gid = createGroup(p, ids, 'Küchenzeile')!;
    const back = parseProjectJson(serializeProject(p)).project;
    expect(back.groups).toEqual([{ id: gid, name: 'Küchenzeile' }]);
    expect(groupMemberIds(back, gid)).toEqual(ids);
  });

  it('saved states (#66) restore the groups with the furniture; projects without groups keep their content hash', () => {
    const { p, ids } = rowProject();
    const plain = structuredClone(p) as Partial<Project>;
    delete plain.groups;
    expect(contentHash(p)).toBe(contentHash(plain as Project));
    const snapshot = structuredClone(p);
    const gid = createGroup(snapshot, ids, 'Küche')!;
    expect(contentHash(snapshot)).not.toBe(contentHash(p));
    const draft = structuredClone(p);
    restoreVersionContent(draft, snapshot);
    expect(draft.groups).toEqual([{ id: gid, name: 'Küche' }]);
    expect(groupMemberIds(draft, gid)).toEqual(ids);
    // a state saved before #65 restores ungrouped furniture and no stale group names
    const old = structuredClone(p) as Partial<Project>;
    delete old.groups;
    restoreVersionContent(draft, old as Project);
    expect(draft.groups).toEqual([]);
  });

  it('rejects invalid group entries', () => {
    const { p, ids } = rowProject();
    createGroup(p, ids);
    const raw = JSON.parse(serializeProject(p)) as { groups: { name: unknown }[] };
    raw.groups[0].name = 'x'.repeat(101);
    expect(() => parseProject(raw)).toThrow();
  });
});

describe('furniture groups: create, rename, dissolve (#65)', () => {
  it('groups at least two items with a default name „Gruppe N“', () => {
    const { p, ids } = rowProject();
    expect(createGroup(p, ids.slice(0, 1))).toBeNull();
    const g1 = createGroup(p, ids.slice(0, 2))!;
    expect(groupName(p, g1)).toBe('Gruppe 1');
    expect(groupOf(p, ids[0])).toBe(g1);
    expect(groupOf(p, ids[2])).toBeNull();
    // regrouping moves items into the new group; the old one (now one item) dissolves
    const g2 = createGroup(p, ids.slice(1))!;
    expect(groupName(p, g2)).toBe('Gruppe 2');
    expect(groupMemberIds(p, g2)).toEqual(ids.slice(1));
    expect(groupOf(p, ids[0])).toBeNull();
    expect(p.groups.map((g) => g.id)).toEqual([g2]);
  });

  it('renames (trimmed, not empty) and dissolves – the items stay where they are', () => {
    const { p, ids } = rowProject();
    const gid = createGroup(p, ids)!;
    expect(renameGroup(p, gid, '  Küchenzeile ')).toBe(true);
    expect(groupName(p, gid)).toBe('Küchenzeile');
    expect(renameGroup(p, gid, '   ')).toBe(false);
    const before = structuredClone(p.furniture);
    expect(dissolveGroups(p, [gid])).toBe(3);
    expect(p.groups).toEqual([]);
    expect(p.furniture.map((f) => [f.x, f.y, f.rotation, f.groupId])).toEqual(before.map((f) => [f.x, f.y, f.rotation, undefined]));
  });

  it('deleting or removing members prunes groups that are left with one item', () => {
    const { p, ids } = rowProject();
    const gid = createGroup(p, ids)!;
    deleteFurniture(p, [ids[0]]);
    expect(groupMemberIds(p, gid)).toEqual(ids.slice(1));
    expect(removeFromGroup(p, ids[1])).toBe(true);
    expect(p.groups).toEqual([]);
    expect(p.furniture.every((f) => !f.groupId)).toBe(true);
  });

  it('pruneGroups repairs a member list without a name entry', () => {
    const { p, ids } = rowProject();
    for (const id of ids) get(p, id).groupId = 'g_orphan';
    pruneGroups(p);
    expect(p.groups).toEqual([{ id: 'g_orphan', name: 'Gruppe 1' }]);
  });

  it('copies of a whole group form a new group „… (Kopie)“, a lone copied member is not grouped', () => {
    const { p, ids } = rowProject();
    const gid = createGroup(p, ids, 'Küche')!;
    const copies = ids.map((id) => {
      const f = { ...structuredClone(get(p, id)), id: `${id}_c` };
      delete f.groupId;
      p.furniture.push(f);
      return { id: f.id, sourceGroupId: gid };
    });
    regroupCopies(p, copies, structuredClone(p.groups));
    const g2 = groupOf(p, copies[0].id)!;
    expect(g2).not.toBe(gid);
    expect(groupName(p, g2)).toBe('Küche (Kopie)');
    expect(groupMemberIds(p, g2)).toEqual(copies.map((c) => c.id));
    expect(groupMemberIds(p, gid)).toEqual(ids);
    const lone = { ...structuredClone(get(p, ids[0])), id: 'lone' };
    delete lone.groupId;
    p.furniture.push(lone);
    regroupCopies(p, [{ id: 'lone', sourceGroupId: gid }], structuredClone(p.groups));
    expect(groupOf(p, 'lone')).toBeNull();
  });
});

describe('furniture groups: selection rules (#65)', () => {
  const { p, ids } = rowProject();
  const gid = createGroup(p, ids.slice(0, 2))!;
  const loose = ids[2];

  it('first click on a member selects the whole group (clicked item first)', () => {
    expect(pressFurniture(p, [], ids[1], false)).toEqual({ ids: [ids[1], ids[0]], drill: null });
    expect(selectedGroup(p, [ids[1], ids[0]])).toBe(gid);
    expect(selectedGroup(p, [ids[1]])).toBeNull();
    expect(selectedGroup(p, [...ids])).toBeNull();
  });

  it('pressing on the selected group keeps it (for dragging); a click releases to the single item', () => {
    expect(pressFurniture(p, [ids[0], ids[1]], ids[1], false)).toEqual({ ids: [ids[0], ids[1]], drill: ids[1] });
  });

  it('while one member is selected, clicking another member selects that one', () => {
    expect(pressFurniture(p, [ids[0]], ids[1], false)).toEqual({ ids: [ids[1]], drill: null });
    expect(pressFurniture(p, [ids[0]], ids[0], false)).toEqual({ ids: [ids[0]], drill: null });
  });

  it('Shift toggles the whole group; ungrouped items behave as before', () => {
    expect(pressFurniture(p, [loose], ids[0], true).ids).toEqual([loose, ids[0], ids[1]]);
    expect(pressFurniture(p, [loose, ids[0], ids[1]], ids[1], true).ids).toEqual([loose]);
    expect(pressFurniture(p, [], loose, false)).toEqual({ ids: [loose], drill: null });
    expect(pressFurniture(p, [loose, ids[0], ids[1]], loose, false)).toEqual({ ids: [loose, ids[0], ids[1]], drill: null });
  });

  it('expandToGroups pulls in whole groups (selection box)', () => {
    expect(expandToGroups(p, [loose, ids[1]])).toEqual([loose, ids[1], ids[0]]);
  });
});

describe('furniture groups: moving and turning as a whole (#65)', () => {
  it('moves rigidly; members do not block each other', () => {
    const { p, ids } = rowProject();
    const obstacles = buildPlacementObstacles(derivePlan(p));
    const before = shape(p, ids);
    const d = moveGroupBy(p, obstacles, ids, { x: -0.3, y: 0.5 }, { collide: true });
    expect(d.x).toBeCloseTo(-0.3, 6);
    expect(d.y).toBeCloseTo(0.5, 6);
    expect(get(p, ids[0]).x).toBeCloseTo(1.7, 6);
    expect(shape(p, ids)).toEqual(before.map((v) => expect.closeTo(v, 6)));
  });

  it('the whole group stops at the wall the first member reaches – and slides along it', () => {
    const { p, ids } = rowProject();
    const obstacles = buildPlacementObstacles(derivePlan(p));
    const before = shape(p, ids);
    // right item at x 3.5..4.5; the wall face is at 6 → at most 1.5 m to the right
    const d = moveGroupBy(p, obstacles, ids, { x: 2.5, y: 0.4 }, { collide: true });
    expect(d.x).toBeGreaterThan(1.45);
    expect(d.x).toBeLessThanOrEqual(1.5 + 1e-6);
    expect(d.y).toBeCloseTo(0.4, 3); // slides along the wall
    expect(shape(p, ids)).toEqual(before.map((v) => expect.closeTo(v, 6)));
    for (const id of ids) {
      const f = get(p, id);
      expect(collidingObstacles(f, obstacles)).toEqual([]);
    }
  });

  it('one large jump still reaches the wall: adjacent members do not block each other (#210)', () => {
    // bed with a night stand directly on each side, like the sample flat; one 4 m jump to the left
    const p = roomProject();
    const bed = add(p, 3, 2, { width: 1.6, depth: 2, rotation: 0 });
    const left = add(p, 1.95, 1.2, { width: 0.5, depth: 0.4, rotation: 0 });
    const right = add(p, 4.05, 1.2, { width: 0.5, depth: 0.4, rotation: 0 });
    const ids = [bed.id, left.id, right.id];
    const obstacles = buildPlacementObstacles(derivePlan(p));
    const d = moveGroupBy(p, obstacles, ids, { x: -4, y: 0 }, { collide: true });
    // left night stand starts at x 1.7; the wall face is at 0 → 1.7 m
    expect(d.x).toBeLessThan(-1.69);
    expect(d.x).toBeGreaterThanOrEqual(-1.7 - 1e-6);
    expect(get(p, left.id).x - 0.25).toBeCloseTo(0, 2);
    expect(get(p, bed.id).x - get(p, left.id).x).toBeCloseTo(1.05, 6);
  });

  it('stops at furniture outside the group; Alt (collide off) moves freely', () => {
    const { p, ids } = rowProject();
    const sofa = add(p, 3, 3.3, { width: 2, depth: 0.6, rotation: 0 }, 'generic-sideboard'); // y 3.0..3.6
    const obstacles = buildPlacementObstacles(derivePlan(p));
    const d = moveGroupBy(p, obstacles, ids, { x: 0, y: 1 }, { collide: true });
    expect(d.y).toBeLessThanOrEqual(0.75 + 1e-6); // rows end at 2.25 → gap to 3.0
    expect(d.y).toBeGreaterThan(0.7);
    for (const id of ids) expect(collidingObstacles(get(p, id), furnitureObstacles(p, get(p, id)).filter((o) => o.refId === sofa.id))).toEqual([]);
    const free = moveGroupBy(p, obstacles, ids, { x: 0, y: 0.3 }, { collide: false });
    expect(free.y).toBeCloseTo(0.3, 6);
  });

  it('a locked member keeps the whole group in place', () => {
    const { p, ids } = rowProject();
    get(p, ids[1]).locked = true;
    const obstacles = buildPlacementObstacles(derivePlan(p));
    expect(moveGroupBy(p, obstacles, ids, { x: 0.2, y: 0 }, { collide: true })).toEqual({ x: 0, y: 0 });
    expect(rotateGroupBy(p, obstacles, ids, Math.PI / 2)).toBe('locked');
    expect(get(p, ids[0]).x).toBe(2);
  });

  it('turns about the group centre; a full turn returns to the start', () => {
    const { p, ids } = rowProject();
    const obstacles = buildPlacementObstacles(derivePlan(p));
    const items = () => ids.map((id) => get(p, id));
    const c0 = groupCenter(items());
    expect(c0).toEqual({ x: 3, y: 2 });
    const start = structuredClone(items());
    expect(rotateGroupBy(p, obstacles, ids, Math.PI / 2)).toBe('ok');
    // the row is now vertical through the centre, each item turned by 90°
    expect(items().map((f) => [f.x, f.y])).toEqual([
      [3, 1],
      [3, 2],
      [3, 3],
    ]);
    for (const f of items()) expect(f.rotation).toBeCloseTo(Math.PI / 2, 6);
    expect(groupCenter(items()).x).toBeCloseTo(3, 6);
    expect(groupCenter(items()).y).toBeCloseTo(2, 6);
    for (let i = 0; i < 18; i++) rotateGroupBy(p, obstacles, ids, Math.PI / 12); // 90° + 18 × 15° = 360°
    for (const [i, f] of items().entries()) {
      expect(f.x).toBeCloseTo(start[i].x, 2);
      expect(f.y).toBeCloseTo(start[i].y, 2);
      expect(Math.abs(Math.sin(f.rotation - start[i].rotation))).toBeLessThan(1e-6);
    }
  });

  it('a group turned a little into a wall is pushed back into the room as a whole', () => {
    const p = roomProject();
    const ids = [1.5, 2.5].map((x) => add(p, x, 3.4, { width: 1, depth: 0.5, rotation: 0 }).id); // y 3.15..3.65, wall face at 4
    const derived = derivePlan(p);
    const obstacles = buildPlacementObstacles(derived);
    const before = shape(p, ids);
    expect(rotateGroupBy(p, obstacles, ids, Math.PI / 2, derived)).toBe('moved'); // lower item would reach y 4.4
    expect(shape(p, ids)).toEqual(before.map((v) => expect.closeTo(v, 6)));
    for (const id of ids) expect(collidingObstacles(get(p, id), obstacles)).toEqual([]);
    expect(Math.max(...ids.map((id) => get(p, id).y + 0.5))).toBeLessThanOrEqual(4 + 1e-6);
  });

  it('turning into a wall is reported as a conflict (turned anyway, like a single item)', () => {
    const p = roomProject();
    const ids = [0, 1, 2].map((i) => add(p, 1 + i, 3.6, { width: 1, depth: 0.5, rotation: 0 }).id); // along the bottom wall
    const obstacles = buildPlacementObstacles(derivePlan(p));
    expect(rotateGroupBy(p, obstacles, ids, Math.PI / 2)).toBe('conflict');
  });
});

describe('furniture groups: commands, one undo step each (#65)', () => {
  const s = () => useProjectStore.getState();
  const sel = () => selectedFurnitureIds(useUiStore.getState());
  let ids: string[] = [];
  beforeEach(() => {
    const r = rowProject();
    ids = r.ids;
    s().load(r.p);
    useUiStore.getState().setSelection(null);
  });

  it('Strg+G groups the selection, Strg+Umschalt+G dissolves it (one undo step each)', () => {
    useUiStore.getState().selectFurniture(ids.slice(0, 1));
    expect(groupSelection()).toBeNull(); // one item is not enough
    expect(s().past).toHaveLength(0);
    useUiStore.getState().selectFurniture(ids);
    const gid = groupSelection()!;
    expect(s().past).toHaveLength(1);
    expect(groupMemberIds(s().project, gid)).toEqual(ids);
    expect(sel()).toEqual(ids);
    expect(groupSelection()).toBeNull(); // already this group
    renameGroupAction(gid, 'Essgruppe');
    expect(groupName(s().project, gid)).toBe('Essgruppe');
    expect(s().past).toHaveLength(2);
    expect(ungroupSelection()).toBe(1);
    expect(s().project.groups).toEqual([]);
    expect(s().past).toHaveLength(3);
    s().undo();
    expect(groupName(s().project, gid)).toBe('Essgruppe');
  });

  it('click selects the group, a second click (no drag) one item', () => {
    useUiStore.getState().selectFurniture(ids.slice(0, 2));
    groupSelection();
    useUiStore.getState().setSelection(null);
    expect(pressFurnitureSelection(ids[1], false)).toBeNull();
    expect(sel()).toEqual([ids[1], ids[0]]);
    const drill = pressFurnitureSelection(ids[0], false);
    expect(drill).toBe(ids[0]);
    selectSingleFurniture(drill!);
    expect(sel()).toEqual([ids[0]]);
  });

  it('Q/E and arrow keys turn and move the selected group as a whole – one undo step each', () => {
    useUiStore.getState().selectFurniture(ids);
    groupSelection();
    const past = s().past.length;
    const before = shape(s().project, ids);
    rotateSelection(Math.PI / 2);
    expect(s().past.length).toBe(past + 1);
    expect(ids.map((id) => [get(s().project, id).x, get(s().project, id).y])).toEqual([
      [3, 1],
      [3, 2],
      [3, 3],
    ]);
    nudgeSelection(0.1, 0);
    expect(s().past.length).toBe(past + 2);
    expect(ids.map((id) => get(s().project, id).x)).toEqual([3.1, 3.1, 3.1]);
    expect(shape(s().project, ids)).toEqual(before.map((v) => expect.closeTo(v, 6)));
    s().undo();
    s().undo();
    expect(ids.map((id) => get(s().project, id).y)).toEqual([2, 2, 2]);
  });

  it('copy/paste and duplicate of a group create a new group; delete removes the group', async () => {
    useUiStore.getState().selectFurniture(ids);
    const gid = groupSelection()!;
    copySelection();
    pasteClipboard();
    const pasted = sel();
    expect(pasted).toHaveLength(3);
    const g2 = selectedGroup(s().project, pasted)!;
    expect(g2).toBeTruthy();
    expect(g2).not.toBe(gid);
    expect(groupName(s().project, g2)).toBe('Gruppe 1 (Kopie)');
    duplicateSelection();
    const g3 = selectedGroup(s().project, sel())!;
    expect(groupName(s().project, g3)).toBe('Gruppe 1 (Kopie) (Kopie)');
    expect(s().project.groups).toHaveLength(3);
    await deleteSelection();
    expect(s().project.groups.map((g) => g.id)).toEqual([gid, g2]);
    // a single member copied alone is not grouped
    useUiStore.getState().selectFurniture([ids[0]]);
    duplicateSelection();
    expect(groupOf(s().project, sel()[0])).toBeNull();
  });
});
