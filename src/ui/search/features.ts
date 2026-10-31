import { useProjectStore } from '../../store/projectStore';
import { useUiStore, type LeftTab, type RightTab, type Tool } from '../../store/uiStore';
import { usePerformanceStore } from '../../view3d/performanceStore';
import { useDialogStore } from '../dialogStore';
import { exportPackage, importProjectFile, newProject, saveNow } from '../actions';
import { exportFloorPlanJson, importFloorPlanJsonFile } from '../../import/floorPlanActions';
import { importPlanFile } from '../../import/underlayImport';
import { exportShoppingCsv } from '../../budget/budgetActions';
import { openPrintView } from '../../export/PrintView';
import { openHandoverView } from '../../export/HandoverView';
import { exportGlbFile } from '../../export/exportGlbFile';
import { usePaletteStore } from './paletteStore';
import type { Searchable } from './match';

/** One entry of the feature search (#461): what it is called, where it lives and what choosing it does. */
export interface Feature extends Searchable {
  id: string;
  /** Short note under the title (where it is / what happens). */
  hint?: string;
  /** Key shown on the right, e.g. „W“ or „Strg+Z“. */
  keys?: string;
  run: () => void;
}

const LEFT_TABS: { id: LeftTab; title: string; keywords: string }[] = [
  { id: 'tools', title: 'Werkzeuge', keywords: 'zeichnen wand raum tür fenster messen' },
  { id: 'catalog', title: 'Katalog', keywords: 'möbel produkte ikea möbelix einfügen sofa bett tisch' },
  { id: 'kitchen', title: 'Küche', keywords: 'küchenzeile arbeitsplatte' },
  { id: 'furnish', title: 'Einrichten', keywords: 'einrichtungsvorschlag claude ki vorschlag' },
  { id: 'smarthome', title: 'Smart Home', keywords: 'geräte automation sensor licht home assistant' },
  { id: 'check', title: 'Check', keywords: 'prüfen wohnungs-check kritik' },
  { id: 'import', title: 'Import', keywords: 'grundriss plan pdf bild einlesen' },
];
const RIGHT_TABS: { id: RightTab; title: string; keywords: string }[] = [
  { id: 'properties', title: 'Eigenschaften', keywords: 'maße details ausgewählt' },
  { id: 'budget', title: 'Budget', keywords: 'kosten preis einkaufsliste' },
  { id: 'project', title: 'Projekt', keywords: 'einstellungen oberfläche dunkelmodus' },
];
const TAB_TITLE: Record<LeftTab | RightTab, string> = Object.fromEntries([...LEFT_TABS, ...RIGHT_TABS].map((t) => [t.id, t.title])) as Record<LeftTab | RightTab, string>;
const isLeft = (tab: LeftTab | RightTab): tab is LeftTab => LEFT_TABS.some((t) => t.id === tab);

/** Opens a side panel tab (on the phone also its sheet). */
export function showTab(tab: LeftTab | RightTab) {
  const ui = useUiStore.getState();
  if (isLeft(tab)) ui.setLeftTab(tab);
  else ui.setRightTab(tab);
  usePaletteStore.getState().onShowPanel?.(isLeft(tab) ? 'left' : 'right');
}

/**
 * Opens the tab, then scrolls to the section with this heading (opens it if it is a collapsed
 * group) and lets it light up briefly. Sections that are not shown right now (e.g. only with a
 * selection) are skipped quietly – the tab is open anyway.
 */
export function revealSection(tab: LeftTab | RightTab, title: string) {
  showTab(tab);
  let tries = 0;
  const look = () => {
    const side = isLeft(tab) ? '.panel.left' : '.panel.right';
    const sections = [...document.querySelectorAll<HTMLElement>(`${side} .panel-section`)];
    const hit = sections.find((s) => s.querySelector('h3')?.textContent?.trim() === title);
    if (!hit) {
      if (++tries < 30) requestAnimationFrame(look);
      return;
    }
    const toggle = hit.querySelector<HTMLButtonElement>('.panel-group-toggle[aria-expanded="false"]');
    toggle?.click();
    // scroll only the panel itself (scrollIntoView would also shift the page on the phone)
    const box = scrollParent(hit);
    if (box) {
      const top = box.scrollTop + hit.getBoundingClientRect().top - box.getBoundingClientRect().top;
      box.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    hit.classList.remove('search-flash');
    void hit.offsetWidth; // restart the animation
    hit.classList.add('search-flash');
    window.setTimeout(() => hit.classList.remove('search-flash'), 1600);
  };
  requestAnimationFrame(look);
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p;
    if (p.classList.contains('panel')) break;
  }
  return null;
}

/** Sections of the side panels, by tab. Titles must match the `title` of `<Section>`/`<PanelGroup>` (checked by a test). */
export const SECTIONS: { tab: LeftTab | RightTab; title: string; keywords?: string }[] = [
  { tab: 'tools', title: 'Raum mit Maßen anlegen', keywords: 'neuer raum rechteck breite tiefe' },
  { tab: 'tools', title: 'Neue Wände', keywords: 'wandstärke wandhöhe' },
  { tab: 'tools', title: 'Raster & Einrasten', keywords: 'snap fangen gitter' },
  { tab: 'tools', title: 'Beleuchtung', keywords: 'lampe licht hinzufügen' },
  { tab: 'tools', title: 'Steckdosen & Anschlüsse', keywords: 'installation schalter heizkörper wasser strom' },
  { tab: 'tools', title: 'Engstellen', keywords: 'durchgang abstand platz' },
  { tab: 'tools', title: 'Bereiche für Claude', keywords: 'zone markieren essbereich arbeitsecke' },
  { tab: 'tools', title: 'Mieter-Paket', keywords: 'übergabeprotokoll bohrloch zustand klebestelle einzug' },
  { tab: 'kitchen', title: 'Küchenzeile planen', keywords: 'küche schränke unterschrank' },
  { tab: 'kitchen', title: 'Arbeitsdreieck', keywords: 'herd spüle kühlschrank' },
  { tab: 'furnish', title: 'Einrichtungsvorschlag mit Claude', keywords: 'ki automatisch einrichten möbel vorschlagen' },
  { tab: 'furnish', title: 'Claude fragen', keywords: 'ki frage tipps' },
  { tab: 'furnish', title: 'Claude ändern lassen', keywords: 'ki plan ändern umstellen' },
  { tab: 'furnish', title: 'Einrichtungsvorschlag', keywords: 'regelbasiert wunschliste raumtyp' },
  { tab: 'smarthome', title: 'Smart Home vorschlagen', keywords: 'geräte automatisch' },
  { tab: 'smarthome', title: 'Gerät hinzufügen', keywords: 'sensor lampe thermostat' },
  { tab: 'smarthome', title: 'Neue Regel', keywords: 'automation wenn dann' },
  { tab: 'smarthome', title: 'Simulation', keywords: 'testen ablauf' },
  { tab: 'smarthome', title: 'Audio-Setup vorschlagen', keywords: 'lautsprecher musik sonos' },
  { tab: 'smarthome', title: 'Tagesablauf prüfen', keywords: 'routine morgen abend' },
  { tab: 'check', title: 'Wohnungs-Check', keywords: 'prüfen probleme fehler' },
  { tab: 'check', title: 'Raumkritik mit Claude', keywords: 'ki bewertung feedback' },
  { tab: 'import', title: 'Grundriss importieren', keywords: 'pdf bild plan einlesen' },
  { tab: 'budget', title: 'Budget', keywords: 'kosten summe preis' },
  { tab: 'budget', title: 'Kaufplan in Phasen', keywords: 'einkauf reihenfolge später' },
  { tab: 'project', title: 'Projekt', keywords: 'name einheiten' },
  { tab: 'project', title: 'Oberfläche', keywords: 'dunkelmodus hell dunkel animationen theme' },
  { tab: 'project', title: 'Steuerung (3D)', keywords: 'maus empfindlichkeit sichtfeld controller gamepad' },
  { tab: 'project', title: 'Licht & Darstellung (3D)', keywords: 'tageszeit sonne schatten' },
  { tab: 'project', title: 'Materialien', keywords: 'boden wand farbe textur' },
  { tab: 'project', title: 'Sichtlinien (2D)', keywords: 'blick sicht' },
  { tab: 'project', title: 'Leistung', keywords: 'performance fps grafik schnell' },
  { tab: 'project', title: 'Plan exportieren', keywords: 'export pdf png' },
  { tab: 'project', title: 'Tageslicht & Himmelsrichtung', keywords: 'norden sonne kompass ausrichtung' },
  { tab: 'project', title: 'Lichtplanung (Lux)', keywords: 'helligkeit lampen lux' },
  { tab: 'project', title: 'Heizkosten (grobe Schätzung)', keywords: 'heizung energie kosten' },
  { tab: 'project', title: 'Stromkreise & Leistung', keywords: 'sicherung watt steckdosen strom' },
];

const TOOLS: { id: Tool; title: string; keys?: string; keywords?: string }[] = [
  { id: 'select', title: 'Auswählen', keys: 'V', keywords: 'verschieben markieren' },
  { id: 'wall', title: 'Wand zeichnen', keys: 'W', keywords: 'mauer' },
  { id: 'room', title: 'Raum zeichnen', keys: 'R', keywords: 'zimmer rechteck' },
  { id: 'door', title: 'Tür setzen', keys: 'T' },
  { id: 'window', title: 'Fenster setzen', keys: 'F' },
  { id: 'passage', title: 'Durchgang setzen', keys: 'G', keywords: 'öffnung' },
  { id: 'measure', title: 'Messen', keys: 'M', keywords: 'abstand maßband lineal' },
  { id: 'walkpath', title: 'Laufweg messen', keys: 'L', keywords: 'weg strecke' },
  { id: 'zone', title: 'Bereich aufziehen', keywords: 'zone claude' },
  { id: 'mark', title: 'Markierung setzen', keywords: 'mieter-paket bohrloch zustand' },
];

const ensure3d = () => {
  const ui = useUiStore.getState();
  if (ui.viewMode === '2d') ui.setViewMode('split');
};
const perf = () => usePerformanceStore.getState();
const openModal = (m: Parameters<ReturnType<typeof useDialogStore.getState>['openModal']>[0]) => useDialogStore.getState().openModal(m);
const setQuality = (q: 'planning' | 'realism') =>
  useProjectStore.getState().apply((d) => {
    d.settings.quality = q;
  });

/** All entries of the feature search, in the order shown for an empty query. */
export function buildFeatures(): Feature[] {
  const list: Feature[] = [];
  for (const t of TOOLS)
    list.push({
      id: `tool:${t.id}`,
      title: t.title,
      group: 'Werkzeug',
      keys: t.keys,
      keywords: t.keywords,
      run: () => {
        const ui = useUiStore.getState();
        ui.setTool(t.id);
        if (ui.viewMode === '3d') ui.setViewMode('split');
        showTab('tools');
      },
    });
  list.push(
    { id: 'view:2d', title: 'Nur 2D-Plan', group: 'Ansicht', keys: '1', keywords: 'grundriss draufsicht', run: () => useUiStore.getState().setViewMode('2d') },
    { id: 'view:split', title: '2D und 3D nebeneinander', group: 'Ansicht', keys: '2', keywords: 'geteilt split', run: () => useUiStore.getState().setViewMode('split') },
    { id: 'view:3d', title: 'Nur 3D', group: 'Ansicht', keys: '3', keywords: 'dreidimensional', run: () => useUiStore.getState().setViewMode('3d') },
    { id: 'cam:orbit', title: 'Übersicht (3D umkreisen)', group: 'Ansicht', keywords: 'kamera drehen orbit', run: () => (ensure3d(), useUiStore.getState().setCameraMode('orbit')) },
    { id: 'cam:walk', title: 'Begehen (Ich-Perspektive)', group: 'Ansicht', keywords: 'rundgang laufen gehen wasd first person', run: () => (ensure3d(), useUiStore.getState().setCameraMode('walk')) },
    { id: 'cam:cut', title: 'Schnitt ein/aus', group: 'Ansicht', keywords: 'wände abschneiden draufsicht', run: () => (ensure3d(), useUiStore.getState().setCameraMode('orbit'), perf().setCutaway(!perf().cutaway)) },
    { id: 'cam:exterior', title: 'Blick von außen ein/aus', group: 'Ansicht', keywords: 'fassade gebäude außen', run: () => (ensure3d(), useUiStore.getState().setCameraMode('orbit'), perf().setExterior(!perf().exterior)) },
    { id: 'cam:reset', title: 'Kamera zurücksetzen', group: 'Ansicht', keywords: 'ansicht zentrieren', run: () => (ensure3d(), perf().resetCamera()) },
    { id: 'q:planning', title: 'Planungsmodus', group: 'Darstellung', keywords: 'schnell einfach qualität', run: () => setQuality('planning') },
    { id: 'q:realism', title: 'Realismus', group: 'Darstellung', keywords: 'schatten texturen schön qualität licht', run: () => (ensure3d(), setQuality('realism')) },
    { id: 'p:new', title: 'Neues leeres Projekt', group: 'Projekt', run: () => void newProject(false) },
    { id: 'p:sample', title: 'Neues Beispielprojekt', group: 'Projekt', run: () => void newProject(true) },
    { id: 'p:open', title: 'Projekte öffnen', group: 'Projekt', keywords: 'laden wechseln liste', run: () => openModal('projects') },
    { id: 'p:save', title: 'Jetzt speichern', group: 'Projekt', keys: 'Strg+S', run: () => void saveNow() },
    { id: 'p:versions', title: 'Versionen', group: 'Projekt', keywords: 'stand speichern vergleichen vorher nachher', run: () => openModal('versions') },
    { id: 'p:undo', title: 'Rückgängig', group: 'Bearbeiten', keys: 'Strg+Z', run: () => useProjectStore.getState().undo() },
    { id: 'p:redo', title: 'Wiederholen', group: 'Bearbeiten', keys: 'Strg+Y', run: () => useProjectStore.getState().redo() },
    { id: 'i:project', title: 'Projekt importieren (.wohnplan.json)', group: 'Importieren', keywords: 'datei öffnen', run: () => void importProjectFile() },
    { id: 'i:floorplan', title: 'Grundriss-JSON importieren', group: 'Importieren', run: () => void importFloorPlanJsonFile() },
    { id: 'i:plan', title: 'Plan als PDF/Bild importieren', group: 'Importieren', keywords: 'grundriss scan foto', run: () => void importPlanFile() },
    { id: 'e:package', title: 'Projektpaket exportieren', group: 'Exportieren', keywords: 'sichern backup datei', run: () => void exportPackage() },
    { id: 'e:floorplan', title: 'Grundriss exportieren (JSON)', group: 'Exportieren', run: () => void exportFloorPlanJson() },
    { id: 'e:csv', title: 'Einkaufsliste als CSV', group: 'Exportieren', keywords: 'excel tabelle kaufen', run: () => void exportShoppingCsv() },
    { id: 'e:print', title: 'Plan drucken / PDF / PNG', group: 'Exportieren', keywords: 'drucken ausdruck bild', run: () => void openPrintView() },
    { id: 'e:handover', title: 'Übergabeprotokoll (Mieter-Paket)', group: 'Exportieren', keywords: 'einzug auszug vermieter', run: () => void openHandoverView() },
    { id: 'e:glb', title: '3D-Modell als GLB', group: 'Exportieren', keywords: 'blender modell', run: () => void exportGlbFile() },
    { id: 'h:help', title: 'Hilfe & Tastenkürzel', group: 'Hilfe', keys: '?', keywords: 'tasten anleitung shortcuts', run: () => openModal('help') },
    { id: 'h:bug', title: 'Problem melden', group: 'Hilfe', keywords: 'fehler bug', run: () => openModal('bugReport') },
  );
  for (const t of [...LEFT_TABS, ...RIGHT_TABS]) list.push({ id: `tab:${t.id}`, title: t.title, group: 'Bereich', keywords: t.keywords, hint: isLeft(t.id) ? 'Linke Leiste' : 'Rechte Leiste', run: () => showTab(t.id) });
  for (const s of SECTIONS)
    list.push({ id: `sec:${s.tab}:${s.title}`, title: s.title, group: TAB_TITLE[s.tab], keywords: s.keywords, hint: `${TAB_TITLE[s.tab]} › ${s.title}`, run: () => revealSection(s.tab, s.title) });
  return list;
}
