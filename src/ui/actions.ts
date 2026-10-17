import { createFurnitureFromCatalog } from '../catalog/instantiate';
import type { CatalogItem } from '../catalog/types';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { deleteFurniture, deleteNode, deleteRoom, deleteWalls, duplicateFurniture, hasLeaf, setOpeningOpen } from '../model/operations';
import { createSampleProject } from '../model/sample';
import { roundMm } from '../model/units';
import { pointInPolygon } from '../model/vec';
import { buildPlacementObstacles, moveFurnitureTo, canDropAt, placeDroppedFurniture, rotateFurnitureTo } from '../model/placement';
import { buildPackage, parsePackageOrProject } from '../formats/project/packageFile';
import { FileFormatError } from '../formats/zodErrors';
import { db } from '../persistence/db';
import { loadProject, saveProject } from '../persistence/projects';
import { exportVersions, replaceVersions } from '../persistence/versions';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import type { Furniture, FurnitureGroup } from '../model/schema';
import { moveGroupBy, regroupCopies } from '../model/groups';
import { rotateSelectedGroup, selectedGroupId } from './groupActions';
import { confirmDialog } from './dialogStore';
import { downloadBlob, pickFile, safeFileName } from './fileUtils';
import { newId } from '../model/ids';

const store = () => useProjectStore.getState();
const ui = () => useUiStore.getState();

export function reportError(e: unknown, context: string) {
  console.error(context, e);
  if (e instanceof FileFormatError) {
    ui().toast(`${e.message}${e.details.length ? ' – ' + e.details.slice(0, 3).join('; ') : ''}`, 'error');
  } else {
    ui().toast(`${context}: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}

export async function deleteSelection() {
  const sel = ui().selection;
  if (!sel) return;
  const p = store().project;
  if (sel.type === 'room') {
    const room = p.rooms.find((r) => r.id === sel.id);
    const ok = await confirmDialog(`Raum „${room?.name ?? ''}“ entfernen? Die Wände bleiben erhalten.`, { confirmLabel: 'Entfernen', danger: true });
    if (!ok) return;
    store().apply((d) => deleteRoom(d, sel.id));
  } else if (sel.type === 'wall') {
    store().apply((d) => deleteWalls(d, [sel.id]));
  } else if (sel.type === 'node') {
    const count = p.walls.filter((w) => w.a === sel.id || w.b === sel.id).length;
    if (count > 1 && !(await confirmDialog(`Ecke mit ${count} angeschlossenen Wänden löschen?`, { confirmLabel: 'Löschen', danger: true }))) return;
    store().apply((d) => deleteNode(d, sel.id));
  } else if (sel.type === 'opening') {
    store().apply((d) => {
      d.openings = d.openings.filter((o) => o.id !== sel.id);
    });
  } else if (sel.type === 'furniture') {
    const ids = selectedFurnitureIds(ui());
    store().apply((d) => deleteFurniture(d, ids));
    ui().setSelection(null);
  } else if (sel.type === 'light') {
    store().apply((d) => {
      d.lights = d.lights.filter((l) => l.id !== sel.id);
    });
  }
  ui().setSelection(null);
}

export function duplicateSelection() {
  const ids = selectedFurnitureIds(ui());
  if (!ids.length) return;
  const created: string[] = [];
  store().apply((d) => {
    const copies: { id: string; sourceGroupId?: string }[] = [];
    for (const id of ids) {
      const nid = duplicateFurniture(d, id);
      if (nid) {
        created.push(nid);
        copies.push({ id: nid, sourceGroupId: d.furniture.find((f) => f.id === id)?.groupId });
      }
    }
    // duplicating a whole group gives a new group (#65)
    regroupCopies(d, copies, structuredClone(d.groups));
  });
  ui().selectFurniture(created);
}

/** Furniture copied with Ctrl+C (kept in memory for this tab, pasted with Ctrl+V). */
let clipboard: Furniture[] = [];
/** Names of the groups of the copied items (#65) – pasting a whole group creates a new one. */
let clipboardGroups: FurnitureGroup[] = [];
let pasteCount = 0;

export function copySelection(): number {
  const ids = new Set(selectedFurnitureIds(ui()));
  clipboard = store().project.furniture.filter((f) => ids.has(f.id)).map((f) => structuredClone(f));
  clipboardGroups = structuredClone(store().project.groups);
  pasteCount = 0;
  if (clipboard.length) ui().toast(`${clipboard.length} Möbel kopiert – Strg+V fügt ein`, 'info');
  return clipboard.length;
}

/** Paste the copied furniture, shifted a bit further on each paste; one undo step. */
export function pasteClipboard() {
  if (!clipboard.length) return;
  pasteCount++;
  const off = 0.3 * pasteCount;
  const created: string[] = [];
  store().apply((d) => {
    const copies: { id: string; sourceGroupId?: string }[] = [];
    for (const f of clipboard) {
      const nid = newId('item');
      const { groupId, ...rest } = structuredClone(f);
      d.furniture.push({ ...rest, id: nid, x: roundMm(f.x + off), y: roundMm(f.y + off) });
      created.push(nid);
      copies.push({ id: nid, sourceGroupId: groupId });
    }
    regroupCopies(d, copies, clipboardGroups);
  });
  ui().selectFurniture(created);
}

/** Rotate the selected furniture by `deltaRad` (Q/E, panel buttons) – checked like dragging. */
export function rotateSelection(deltaRad: number) {
  const sel = ui().selection;
  if (sel?.type !== 'furniture') return;
  // a selected group turns as a whole about its centre (#65)
  if (rotateSelectedGroup(deltaRad)) return;
  const f = store().project.furniture.find((x) => x.id === sel.id);
  if (f) setFurnitureRotation(f.id, f.rotation + deltaRad);
}

/** Set an absolute rotation (radians) for furniture `id`: one undo step, collision-checked. */
export function setFurnitureRotation(id: string, rotation: number) {
  const p = store().project;
  const f = p.furniture.find((x) => x.id === id);
  if (!f || f.locked) return;
  const derived = derivePlan(p);
  const obstacles = buildPlacementObstacles(derived);
  const out: { result: ReturnType<typeof rotateFurnitureTo> } = { result: 'ok' };
  store().apply((d) => void (out.result = rotateFurnitureTo(d, derived, obstacles, id, rotation)));
  const result = out.result;
  if (result === 'moved') ui().toast(`„${f.name}“ gedreht und etwas verschoben, damit es nicht in Wand oder Möbel ragt.`, 'info');
  if (result === 'conflict') ui().toast(`„${f.name}“ gedreht – überschneidet sich jetzt (rot markiert). Bitte verschieben oder zurückdrehen (Strg+Z).`, 'error');
}

export function nudgeSelection(dx: number, dy: number) {
  const ids = selectedFurnitureIds(ui());
  if (!ids.length) return;
  const p = store().project;
  const derived = derivePlan(p);
  const obstacles = buildPlacementObstacles(derived);
  // a selected group moves rigidly, its collision check applies to the group as a whole (#65)
  if (selectedGroupId()) {
    store().apply((d) => void moveGroupBy(d, obstacles, ids, { x: dx, y: dy }, { collide: true }));
    return;
  }
  // nudging respects walls but does not snap (fine positioning); all selected items, one undo step
  store().apply((d) => {
    for (const id of ids) {
      const f = p.furniture.find((x) => x.id === id);
      if (f && !f.locked) moveFurnitureTo(d, derived, obstacles, id, { x: roundMm(f.x + dx), y: roundMm(f.y + dy) }, { snap: false, collide: true });
    }
  });
}

/** Place a catalog item: in the selected room, else the center of the 2D view. */
export function addCatalogItem(item: CatalogItem) {
  const p = store().project;
  const view = ui().view2d;
  let at = { x: view.cx, y: view.cy };
  const sel = ui().selection;
  const derived = derivePlan(p);
  if (sel?.type === 'room') {
    const g = derived.rooms.get(sel.id);
    if (g) at = g.centroid;
  } else {
    const inRoom = [...derived.rooms.values()].some((g) => pointInPolygon(at, g.interior));
    if (!inRoom && derived.rooms.size > 0) at = [...derived.rooms.values()][0].centroid;
  }
  const f = createFurnitureFromCatalog(item, { x: roundMm(at.x), y: roundMm(at.y) });
  store().apply((d) => {
    d.furniture.push(f);
  });
  ui().setSelection({ type: 'furniture', id: f.id });
  ui().toast(`„${item.name}“ hinzugefügt – im Plan verschieben oder Maße rechts anpassen.`, 'success');
}

/**
 * Catalog entry dropped into the 2D plan or the 3D view (#131): placed at the dropped point with
 * snapping; a point outside every room is rejected with a hint, nothing changes.
 */
export function dropCatalogItemAt(item: CatalogItem, at: { x: number; y: number }, altKey = false): boolean {
  const derived = derivePlan(store().project);
  // check first, so a rejected drop does not leave an empty undo step
  if (!canDropAt(derived, at)) {
    ui().toast(`„${item.name}“ nicht abgelegt – bitte in einen Raum ziehen.`, 'info');
    return false;
  }
  const f = createFurnitureFromCatalog(item, at);
  let placed = false;
  store().apply((d) => {
    placed = placeDroppedFurniture(d, derived, f, at, altKey);
  });
  if (!placed) return false;
  ui().setSelection({ type: 'furniture', id: f.id });
  ui().toast(`„${item.name}“ platziert.`, 'success');
  return true;
}

export function addLight() {
  const p = store().project;
  const derived = derivePlan(p);
  const sel = ui().selection;
  const room = sel?.type === 'room' ? derived.rooms.get(sel.id) : [...derived.rooms.values()][0];
  const at = room?.centroid ?? { x: ui().view2d.cx, y: ui().view2d.cy };
  const id = newId('light');
  store().apply((d) => {
    d.lights.push({ id, name: `Leuchte ${d.lights.length + 1}`, x: roundMm(at.x), y: roundMm(at.y), elevation: Math.max(1, d.settings.defaultWallHeight - 0.15), temperature: 3000, intensity: 1.2, on: true });
  });
  ui().setSelection({ type: 'light', id });
}

export async function saveNow() {
  try {
    await saveProject(store().project);
    ui().toast('Projekt lokal gespeichert', 'success');
  } catch (e) {
    reportError(e, 'Speichern fehlgeschlagen');
  }
}

export async function newProject(sample = false) {
  const ok = await confirmDialog(
    'Ein neues Projekt anlegen? Das aktuelle Projekt bleibt in der Projektliste gespeichert.',
    { title: 'Neues Projekt', confirmLabel: 'Neu anlegen' },
  );
  if (!ok) return;
  await saveProject(store().project).catch(() => undefined);
  const p = sample ? createSampleProject() : createEmptyProject();
  store().load(p);
  ui().setSelection(null);
  ui().requestFit();
  await saveProject(p).catch(() => undefined);
}

export async function openProject(id: string) {
  try {
    await saveProject(store().project).catch(() => undefined);
    const res = await loadProject(id);
    if (!res) {
      ui().toast('Projekt nicht gefunden', 'error');
      return;
    }
    store().load(res.project);
    ui().setSelection(null);
    ui().requestFit();
    if (res.warnings.length) ui().toast(`Geladen mit Hinweisen: ${res.warnings.slice(0, 2).join('; ')}`, 'info');
  } catch (e) {
    reportError(e, 'Projekt konnte nicht geladen werden');
  }
}

export async function exportPackage() {
  try {
    const p = store().project;
    const { pkg, missing } = await buildPackage(p, db.getAsset, await exportVersions(p.id));
    downloadBlob(JSON.stringify(pkg), `${safeFileName(p.name)}.wohnplan.json`);
    if (missing.length) ui().toast(`Achtung: ${missing.length} referenzierte Datei(en) fehlen lokal und sind nicht im Export enthalten.`, 'error');
    else ui().toast('Projekt exportiert (inkl. Grundriss-Bilder und Modelle)', 'success');
  } catch (e) {
    reportError(e, 'Export fehlgeschlagen');
  }
}

export async function importProjectFile() {
  const file = await pickFile('.json,.wohnplan.json,application/json');
  if (!file) return;
  try {
    if (file.size > 300 * 1024 * 1024) throw new FileFormatError('Die Datei ist zu groß (max. 300 MB).');
    const parsed = parsePackageOrProject(await file.text());
    for (const [id, blob] of Object.entries(parsed.assets)) await db.putAsset(id, blob);
    const existing = await loadProject(parsed.project.id).catch(() => null);
    let project = parsed.project;
    if (existing) {
      const overwrite = await confirmDialog(
        `Ein Projekt mit derselben ID („${existing.project.name}“) ist bereits gespeichert. Überschreiben? (Abbrechen = als Kopie importieren)`,
        { confirmLabel: 'Überschreiben', danger: true },
      );
      if (!overwrite) project = { ...project, id: newId('proj'), name: `${project.name} (Kopie)` };
    }
    await saveProject(store().project).catch(() => undefined);
    store().load(project);
    await saveProject(project);
    if (parsed.versions.length) await replaceVersions(project.id, parsed.versions);
    ui().setSelection(null);
    ui().requestFit();
    ui().toast(parsed.warnings.length ? `Importiert mit Hinweisen: ${parsed.warnings.slice(0, 2).join('; ')}` : 'Projekt importiert', parsed.warnings.length ? 'info' : 'success');
  } catch (e) {
    reportError(e, 'Import fehlgeschlagen');
  }
}

/**
 * Open or close door/window `id` (#21; O key, double-click in 3D, click while walking,
 * panel): one undo step per toggle. Returns the new state, or null if nothing changed
 * (no such opening, a passage, or a drag/carry in progress).
 */
export function toggleOpening(id: string): boolean | null {
  const o = store().project.openings.find((x) => x.id === id);
  if (!o || !hasLeaf(o) || store().txBase) return null;
  let open: boolean | null = null;
  store().apply((d) => void (open = setOpeningOpen(d, id)));
  return open;
}
