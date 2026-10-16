import { createFurnitureFromCatalog } from '../catalog/instantiate';
import type { CatalogItem } from '../catalog/types';
import { createEmptyProject } from '../model/factory';
import { derivePlan } from '../model/derived';
import { deleteFurniture, deleteNode, deleteRoom, deleteWalls, duplicateFurniture } from '../model/operations';
import { createSampleProject } from '../model/sample';
import { normalizeAngle, roundMm } from '../model/units';
import { pointInPolygon } from '../model/vec';
import { buildPlacementObstacles, moveFurnitureTo } from '../model/placement';
import { buildPackage, parsePackageOrProject } from '../formats/project/packageFile';
import { FileFormatError } from '../formats/zodErrors';
import { db } from '../persistence/db';
import { loadProject, saveProject } from '../persistence/projects';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
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
    store().apply((d) => deleteFurniture(d, [sel.id]));
  } else if (sel.type === 'light') {
    store().apply((d) => {
      d.lights = d.lights.filter((l) => l.id !== sel.id);
    });
  }
  ui().setSelection(null);
}

export function duplicateSelection() {
  const sel = ui().selection;
  if (sel?.type !== 'furniture') return;
  let nid: string | null = null;
  store().apply((d) => {
    nid = duplicateFurniture(d, sel.id);
  });
  if (nid) ui().setSelection({ type: 'furniture', id: nid });
}

export function rotateSelection(deltaRad: number) {
  const sel = ui().selection;
  if (sel?.type !== 'furniture') return;
  store().apply((d) => {
    const f = d.furniture.find((x) => x.id === sel.id);
    if (f && !f.locked) f.rotation = normalizeAngle(f.rotation + deltaRad);
  });
}

export function nudgeSelection(dx: number, dy: number) {
  const sel = ui().selection;
  if (sel?.type !== 'furniture') return;
  const p = store().project;
  const f = p.furniture.find((x) => x.id === sel.id);
  if (!f || f.locked) return;
  const derived = derivePlan(p);
  const obstacles = buildPlacementObstacles(derived);
  // nudging respects walls but does not snap (fine positioning)
  store().apply((d) => {
    moveFurnitureTo(d, derived, obstacles, sel.id, { x: roundMm(f.x + dx), y: roundMm(f.y + dy) }, { snap: false, collide: true });
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
    const { pkg, missing } = await buildPackage(p, db.getAsset);
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
    ui().setSelection(null);
    ui().requestFit();
    ui().toast(parsed.warnings.length ? `Importiert mit Hinweisen: ${parsed.warnings.slice(0, 2).join('; ')}` : 'Projekt importiert', parsed.warnings.length ? 'info' : 'success');
  } catch (e) {
    reportError(e, 'Import fehlgeschlagen');
  }
}
