import { derivePlan } from '../model/derived';
import { createGroup, dissolveGroups, expandToGroups, groupName, groupOf, pressFurniture, removeFromGroup, renameGroup, rotateGroupBy, selectedGroup, type GroupTurnResult } from '../model/groups';
import { buildPlacementObstacles } from '../model/placement';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';

/** Furniture groups (#65): selection rules and commands shared by 2D, 3D, panel and shortcuts. */

const store = () => useProjectStore.getState();
const ui = () => useUiStore.getState();

/** Id of the group that is selected as a whole, or null. */
export function selectedGroupId(): string | null {
  return selectedGroup(store().project, selectedFurnitureIds(ui()));
}

/**
 * Pointer pressed on furniture `id` (2D/3D): applies the group selection rules
 * (see model/groups.pressFurniture). Returns the item to select alone if the press ends
 * as a click without dragging (second click on a selected group), else null.
 */
export function pressFurnitureSelection(id: string, shift: boolean): string | null {
  const r = pressFurniture(store().project, selectedFurnitureIds(ui()), id, shift);
  if (r.ids.length) ui().selectFurniture(r.ids);
  else ui().setSelection(null);
  return r.drill;
}

/** Second click on a member of the selected group: select only that item. */
export function selectSingleFurniture(id: string) {
  ui().selectFurniture([id]);
}

/** Select these items, each with its whole group (selection box). */
export function selectFurnitureWithGroups(ids: string[]) {
  ui().selectFurniture(expandToGroups(store().project, ids));
}

/** Strg+G: group the selected furniture. Returns the new group id. */
export function groupSelection(): string | null {
  const ids = selectedFurnitureIds(ui());
  if (store().txBase) return null;
  if (ids.length < 2) {
    ui().toast('Zum Gruppieren mindestens zwei Möbel auswählen (Umschalt+Klick oder Auswahlrahmen), dann Strg+G.', 'info');
    return null;
  }
  const existing = selectedGroup(store().project, ids);
  if (existing) {
    ui().toast(`Die Auswahl ist bereits die Gruppe „${groupName(store().project, existing)}“.`, 'info');
    return null;
  }
  let gid: string | null = null;
  store().apply((d) => void (gid = createGroup(d, ids)));
  if (gid) {
    // the grouped items stay selected – now as the group
    ui().selectFurniture(ids);
    ui().toast(`Gruppe „${groupName(store().project, gid)}“ aus ${ids.length} Möbeln erstellt. Klick wählt die ganze Gruppe, ein zweiter Klick ein einzelnes Möbel.`, 'success');
  }
  return gid;
}

/** Strg+Umschalt+G: dissolve every group that has a selected member. Returns the number of groups. */
export function ungroupSelection(): number {
  if (store().txBase) return 0;
  const p = store().project;
  const groups = [...new Set(selectedFurnitureIds(ui()).map((id) => groupOf(p, id)).filter((g): g is string => !!g))];
  if (!groups.length) {
    ui().toast('Keine Gruppe ausgewählt.', 'info');
    return 0;
  }
  const names = groups.map((g) => `„${groupName(p, g)}“`).join(', ');
  store().apply((d) => void dissolveGroups(d, groups));
  ui().toast(groups.length === 1 ? `Gruppe ${names} aufgelöst – die Möbel bleiben an ihrem Platz.` : `${groups.length} Gruppen aufgelöst (${names}).`, 'success');
  return groups.length;
}

/** Take a single item out of its group. */
export function removeItemFromGroup(id: string) {
  if (!groupOf(store().project, id) || store().txBase) return;
  store().apply((d) => void removeFromGroup(d, id));
}

export function renameGroupAction(groupId: string, name: string) {
  const g = store().project.groups.find((x) => x.id === groupId);
  if (!g || !name.trim() || name.trim() === g.name) return;
  store().apply((d) => void renameGroup(d, groupId, name));
}

/** Select the whole group of item `id`. */
export function selectGroupOf(id: string) {
  const gid = groupOf(store().project, id);
  if (gid) selectFurnitureWithGroups([id]);
}

/**
 * Turn the selected group by `deltaRad` about its centre: one undo step. Returns false if
 * no group is selected (callers then turn the single item).
 */
export function rotateSelectedGroup(deltaRad: number): boolean {
  const gid = selectedGroupId();
  if (!gid) return false;
  const p = store().project;
  const ids = selectedFurnitureIds(ui());
  const name = groupName(p, gid);
  if (p.furniture.some((f) => ids.includes(f.id) && f.locked)) {
    ui().toast(`Die Gruppe „${name}“ enthält ein gesperrtes Möbel und kann nicht gedreht werden.`, 'info');
    return true;
  }
  const derived = derivePlan(p);
  const obstacles = buildPlacementObstacles(derived);
  const out: { result: GroupTurnResult } = { result: 'ok' };
  store().apply((d) => void (out.result = rotateGroupBy(d, obstacles, ids, deltaRad, derived)));
  reportGroupTurn(out.result, name);
  return true;
}

/** Toast for the outcome of turning a group (keys, panel, 2D handle). */
export function reportGroupTurn(result: GroupTurnResult, name: string) {
  if (result === 'moved') ui().toast(`Gruppe „${name}“ gedreht und etwas verschoben, damit sie nicht in Wand oder Möbel ragt.`, 'info');
  if (result === 'conflict') ui().toast(`Gruppe „${name}“ gedreht – sie überschneidet sich jetzt (rot markiert). Bitte verschieben oder zurückdrehen (Strg+Z).`, 'error');
}
