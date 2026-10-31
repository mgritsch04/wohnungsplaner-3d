import { useProjectStore } from '../../store/projectStore';
import { useUiStore, selectedFurnitureIds, type LeftTab, type RightTab, type Tool } from '../../store/uiStore';
import { usePerformanceStore } from '../../view3d/performanceStore';
import { useTapeStore } from '../../view3d/tapeStore';
import { useDialogStore } from '../dialogStore';
import {
  deleteSelection,
  duplicateSelection,
  exportPackage,
  importProjectFile,
  newProject,
  rotateSelection,
  saveNow,
  toggleUnderlayVisible,
} from '../actions';
import { groupSelection, ungroupSelection } from '../groupActions';
import { exportFloorPlanJson, importFloorPlanJsonFile } from '../../import/floorPlanActions';
import { importPlanFile } from '../../import/underlayImport';
import { exportShoppingCsv } from '../../budget/budgetActions';
import { openPrintView } from '../../export/PrintView';
import { openHandoverView } from '../../export/HandoverView';
import { exportGlbFile } from '../../export/exportGlbFile';
import { isProjectEmpty, reopenStartCard } from '../StartCard';

export interface Command {
  id: string;
  label: string;
  group: string;
  /** Extra search words (synonyms), not shown. */
  keywords?: string;
  /** Key or short hint shown on the right, e.g. "Strg+Z". */
  shortcut?: string;
  /** Short explanation shown under the name. */
  hint?: string;
  /** False = shown greyed out (with `why`) and cannot be run. */
  enabled?: () => boolean;
  /** Why the command is not available right now. */
  why?: string;
  run: () => void | Promise<unknown>;
}

const ui = () => useUiStore.getState();
const ps = () => useProjectStore.getState();
const perf = () => usePerformanceStore.getState();
const hasSelection = () => ui().selection !== null;
const hasFurniture = () => selectedFurnitureIds(ui()).length > 0;
const needs3d = () => ui().viewMode !== '2d';

/** Make the 2D plan visible (tools only work there). */
function show2d() {
  if (ui().viewMode === '3d') ui().setViewMode('split');
}

/** Opens a side panel; on the phone the panel is a sheet, which App opens on this event. */
export const OPEN_PANEL_EVENT = 'wohnplan:open-panel';
function openPanel(side: 'left' | 'right') {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: side }));
}

const TOOLS: [Tool, string, string, string][] = [
  ['select', 'Auswählen / Verschieben', 'V', 'cursor zeiger'],
  ['wall', 'Wand zeichnen', 'W', 'mauer'],
  ['room', 'Raum zeichnen', 'R', 'zimmer fläche'],
  ['door', 'Tür setzen', 'T', ''],
  ['window', 'Fenster setzen', 'F', ''],
  ['passage', 'Durchgang setzen', 'G', 'öffnung türlos'],
  ['measure', 'Messen (Abstand)', 'M', 'maßband lineal entfernung länge'],
  ['walkpath', 'Laufweg messen', 'L', 'weg wegstrecke'],
  ['zone', 'Bereich markieren', '', 'zone einrichtungsvorschlag'],
  ['mark', 'Markierung setzen (Mieter-Paket)', '', 'zustand bohrloch klebestelle'],
];

const LEFT_TABS: [LeftTab, string, string][] = [
  ['tools', 'Werkzeuge', 'zeichnen'],
  ['catalog', 'Katalog', 'möbel produkte suchen ikea'],
  ['kitchen', 'Küche', 'küchenplaner'],
  ['furnish', 'Einrichten', 'einrichtungsvorschlag vorschlag claude'],
  ['smarthome', 'Smart Home', 'geräte sensoren'],
  ['check', 'Check', 'prüfen kollision fluchtweg'],
  ['import', 'Import', 'grundriss pdf bild'],
];

const RIGHT_TABS: [RightTab, string, string][] = [
  ['properties', 'Eigenschaften', 'details maße name auswahl'],
  ['budget', 'Budget', 'kosten preis einkaufsliste'],
  ['project', 'Projekt-Einstellungen', 'etagen deckenhöhe wandstärke einstellungen'],
];

/** Builds the list of commands (functions run on demand, so the list itself is static). */
export function buildCommands(): Command[] {
  const list: Command[] = [];
  const add = (c: Command) => list.push(c);

  for (const [tool, label, key, kw] of TOOLS) {
    add({
      id: `tool-${tool}`,
      group: 'Werkzeuge',
      label,
      keywords: `werkzeug ${kw}`,
      shortcut: key || undefined,
      run: () => {
        show2d();
        ui().setLeftTab('tools');
        ui().setTool(tool);
      },
    });
  }

  add({ id: 'view-2d', group: 'Ansicht', label: 'Nur 2D-Plan', keywords: 'grundriss plan', shortcut: '1', run: () => ui().setViewMode('2d') });
  add({ id: 'view-split', group: 'Ansicht', label: '2D und 3D nebeneinander', keywords: 'geteilt split', shortcut: '2', run: () => ui().setViewMode('split') });
  add({ id: 'view-3d', group: 'Ansicht', label: 'Nur 3D-Ansicht', keywords: 'raum modell', shortcut: '3', run: () => ui().setViewMode('3d') });
  add({ id: 'view-fit', group: 'Ansicht', label: 'Plan einpassen', keywords: 'zoom alles zeigen zentrieren', shortcut: 'H', run: () => ui().requestFit() });
  add({
    id: 'cam-orbit',
    group: 'Ansicht',
    label: 'Übersicht (Kamera umkreisen)',
    keywords: 'orbit kamera von oben',
    enabled: needs3d,
    why: 'Nur in der 3D-Ansicht',
    run: () => ui().setCameraMode('orbit'),
  });
  add({
    id: 'cam-walk',
    group: 'Ansicht',
    label: 'Begehen (Ich-Perspektive)',
    keywords: 'rundgang gehen first person wasd laufen',
    enabled: needs3d,
    why: 'Nur in der 3D-Ansicht',
    run: () => ui().setCameraMode('walk'),
  });
  add({
    id: 'cam-cutaway',
    group: 'Ansicht',
    label: 'Schnitt in 1,20 m Höhe ein/aus',
    keywords: 'querschnitt decke wände ausblenden',
    enabled: needs3d,
    why: 'Nur in der 3D-Ansicht',
    run: () => perf().setCutaway(!perf().cutaway),
  });
  add({
    id: 'cam-exterior',
    group: 'Ansicht',
    label: 'Außenansicht ein/aus',
    keywords: 'fassade gebäude von außen',
    enabled: needs3d,
    why: 'Nur in der 3D-Ansicht',
    run: () => perf().setExterior(!perf().exterior),
  });
  add({ id: 'cam-reset', group: 'Ansicht', label: 'Kamera zurücksetzen', keywords: 'blick', enabled: needs3d, why: 'Nur in der 3D-Ansicht', run: () => perf().resetCamera() });
  add({
    id: 'tape',
    group: 'Ansicht',
    label: '3D-Maßband ein/aus',
    keywords: 'messen abstand entfernung',
    shortcut: 'K',
    enabled: needs3d,
    why: 'Nur in der 3D-Ansicht',
    run: () => useTapeStore.getState().toggle(),
  });
  add({ id: 'quality-planning', group: 'Ansicht', label: 'Planungsmodus (schnell)', keywords: 'qualität darstellung einfach', run: () => ps().apply((d) => void (d.settings.quality = 'planning')) });
  add({ id: 'quality-realism', group: 'Ansicht', label: 'Realismus-Modus (Texturen, Schatten)', keywords: 'qualität darstellung licht schön', run: () => ps().apply((d) => void (d.settings.quality = 'realism')) });
  add({ id: 'underlay', group: 'Ansicht', label: 'Plan-Hintergrund ein/aus', keywords: 'importierter grundriss unterlage', shortcut: 'P', run: () => void toggleUnderlayVisible() });

  add({ id: 'undo', group: 'Bearbeiten', label: 'Rückgängig', keywords: 'undo zurück', shortcut: 'Strg+Z', enabled: () => ps().past.length > 0, why: 'Nichts zum Rückgängigmachen', run: () => ps().undo() });
  add({ id: 'redo', group: 'Bearbeiten', label: 'Wiederholen', keywords: 'redo', shortcut: 'Strg+Y', enabled: () => ps().future.length > 0, why: 'Nichts zum Wiederholen', run: () => ps().redo() });
  add({ id: 'duplicate', group: 'Bearbeiten', label: 'Auswahl duplizieren', keywords: 'kopieren kopie', shortcut: 'Strg+D', enabled: hasFurniture, why: 'Erst ein Möbel auswählen', run: () => duplicateSelection() });
  add({ id: 'delete', group: 'Bearbeiten', label: 'Auswahl löschen', keywords: 'entfernen weg', shortcut: 'Entf', enabled: hasSelection, why: 'Erst etwas auswählen', run: () => deleteSelection() });
  add({ id: 'rotate-left', group: 'Bearbeiten', label: 'Auswahl nach links drehen (15°)', keywords: 'drehen rotieren', shortcut: 'Q', enabled: hasFurniture, why: 'Erst ein Möbel auswählen', run: () => rotateSelection(-Math.PI / 12) });
  add({ id: 'rotate-right', group: 'Bearbeiten', label: 'Auswahl nach rechts drehen (15°)', keywords: 'drehen rotieren', shortcut: 'E', enabled: hasFurniture, why: 'Erst ein Möbel auswählen', run: () => rotateSelection(Math.PI / 12) });
  add({
    id: 'select-all',
    group: 'Bearbeiten',
    label: 'Alle Möbel auswählen',
    shortcut: 'Strg+A',
    enabled: () => ps().project.furniture.length > 0,
    why: 'Noch keine Möbel im Projekt',
    run: () => ui().selectFurniture(ps().project.furniture.map((f) => f.id)),
  });
  add({ id: 'group', group: 'Bearbeiten', label: 'Möbel gruppieren', keywords: 'zusammenfassen küchenzeile essgruppe', shortcut: 'Strg+G', enabled: () => selectedFurnitureIds(ui()).length > 1, why: 'Erst mehrere Möbel auswählen', run: () => void groupSelection() });
  add({ id: 'ungroup', group: 'Bearbeiten', label: 'Gruppe auflösen', keywords: 'trennen', shortcut: 'Strg+Umschalt+G', enabled: hasFurniture, why: 'Erst eine Gruppe auswählen', run: () => void ungroupSelection() });

  for (const [id, label, kw] of LEFT_TABS) {
    add({ id: `left-${id}`, group: 'Bereiche', label: `${label} öffnen`, keywords: `seitenleiste links ${kw}`, run: () => { ui().setLeftTab(id); openPanel('left'); } });
  }
  for (const [id, label, kw] of RIGHT_TABS) {
    add({ id: `right-${id}`, group: 'Bereiche', label: `${label} öffnen`, keywords: `seitenleiste rechts ${kw}`, run: () => { ui().setRightTab(id); openPanel('right'); } });
  }

  add({ id: 'p-new', group: 'Projekt', label: 'Neues leeres Projekt', keywords: 'anlegen neu', run: () => newProject(false) });
  add({ id: 'p-sample', group: 'Projekt', label: 'Neues Beispielprojekt', keywords: 'demo muster', run: () => newProject(true) });
  add({ id: 'p-open', group: 'Projekt', label: 'Projekte öffnen…', keywords: 'laden wechseln liste', run: () => useDialogStore.getState().openModal('projects') });
  add({ id: 'p-save', group: 'Projekt', label: 'Jetzt speichern', keywords: 'sichern', shortcut: 'Strg+S', run: () => saveNow() });
  add({ id: 'p-versions', group: 'Projekt', label: 'Versionen (Stände speichern und vergleichen)…', keywords: 'vorher nachher vergleich verlauf snapshot', run: () => useDialogStore.getState().openModal('versions') });
  add({
    id: 'p-start',
    group: 'Projekt',
    label: 'Erste Schritte anzeigen',
    keywords: 'startkarte anleitung einstieg',
    enabled: () => isProjectEmpty(ps().project),
    why: 'Nur bei leerem Projekt',
    run: () => reopenStartCard(ps().project.id),
  });
  add({ id: 'p-import', group: 'Importieren', label: 'Projekt importieren (.wohnplan.json)…', keywords: 'öffnen datei laden', run: () => importProjectFile() });
  add({ id: 'p-import-fp', group: 'Importieren', label: 'Grundriss-JSON importieren…', keywords: 'apartment-plan', run: () => importFloorPlanJsonFile() });
  add({ id: 'p-import-plan', group: 'Importieren', label: 'Plan als PDF oder Bild importieren…', keywords: 'grundriss unterlage vorlage abzeichnen foto', run: () => importPlanFile() });
  add({ id: 'p-import-product', group: 'Importieren', label: 'Produkt von einer Händlerseite importieren…', keywords: 'ikea möbel url link shop', run: () => useDialogStore.getState().openModal('product') });
  add({ id: 'p-import-glb', group: 'Importieren', label: '3D-Modell (GLB) für ein Möbel hinterlegen…', keywords: 'eigenes modell gltf', run: () => useDialogStore.getState().openModal('model') });

  add({ id: 'x-package', group: 'Exportieren', label: 'Projektpaket speichern (.wohnplan.json)', keywords: 'sichern backup datei herunterladen', run: () => exportPackage() });
  add({ id: 'x-floorplan', group: 'Exportieren', label: 'Grundriss exportieren (apartment-plan.json)', run: () => exportFloorPlanJson() });
  add({ id: 'x-csv', group: 'Exportieren', label: 'Einkaufsliste (CSV)', keywords: 'budget möbel liste tabelle excel', run: () => exportShoppingCsv() });
  add({ id: 'x-print', group: 'Exportieren', label: 'Plan drucken, als PDF oder PNG', keywords: 'ausdrucken bild pdf', run: () => openPrintView() });
  add({ id: 'x-handover', group: 'Exportieren', label: 'Übergabeprotokoll (Mieter-Paket)…', keywords: 'wohnungsübergabe protokoll mängel', run: () => openHandoverView() });
  add({ id: 'x-glb', group: 'Exportieren', label: '3D-Modell als GLB exportieren', keywords: 'gltf blender', run: () => exportGlbFile() });

  add({ id: 'h-help', group: 'Hilfe', label: 'Hilfe und Tastenkürzel', keywords: 'tasten shortcuts anleitung', shortcut: '?', run: () => useDialogStore.getState().openModal('help') });
  add({ id: 'h-bug', group: 'Hilfe', label: 'Fehler melden…', keywords: 'bug problem feedback', run: () => useDialogStore.getState().openModal('bugReport') });

  return list;
}
