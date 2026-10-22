import { applyDraft, floorPlanToDraft, parseFloorPlanJson, projectToFloorPlan } from '../formats/floorplan/convert';
import { FileFormatError } from '../formats/zodErrors';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob, pickFile, safeFileName } from '../ui/fileUtils';
import { reportError } from '../ui/actions';
import { confirmDialog } from '../ui/dialogStore';
import { useImportStore } from './importStore';
import { findDraftConflicts } from './review';
import { roomsInsideExistingRooms } from './rooms';

export async function importFloorPlanJsonFile() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  try {
    if (file.size > 20 * 1024 * 1024) throw new FileFormatError('Die Grundriss-Datei ist zu groß (max. 20 MB).');
    const plan = parseFloorPlanJson(await file.text());
    const draft = floorPlanToDraft(plan, file.name);
    const conflicts = findDraftConflicts(draft);
    draft.warnings.push(...conflicts.map((c) => c.message));
    const hasArchitecture = useProjectStore.getState().project.walls.length > 0;
    draft.mode = hasArchitecture ? 'merge' : 'replace';
    useImportStore.getState().setDraft(draft);
    useUiStore.getState().setLeftTab('import');
    useUiStore.getState().requestFit();
    useUiStore.getState().toast(`${draft.walls.length} Wände, ${draft.openings.length} Öffnungen, ${draft.rooms.length} Räume erkannt – bitte prüfen und übernehmen.`, 'info');
  } catch (e) {
    reportError(e, 'Grundriss-Import fehlgeschlagen');
  }
}

export async function acceptDraft() {
  const draft = useImportStore.getState().draft;
  if (!draft) return;
  const uncertain = [...draft.walls, ...draft.openings, ...(draft.fixtures ?? []), ...(draft.installations ?? [])].filter((x) => x.accepted && x.status === 'uncertain').length;
  if (!draft.scaleConfirmed) {
    const ok = await confirmDialog('Der Maßstab ist nicht bestätigt. Die übernommenen Maße können falsch sein. Trotzdem übernehmen?', { confirmLabel: 'Trotzdem übernehmen', danger: true });
    if (!ok) return;
  }
  if (uncertain > 0) {
    const ok = await confirmDialog(`${uncertain} Element(e) sind als „unsicher“ markiert. Trotzdem übernehmen? Du kannst sie danach normal bearbeiten.`, { confirmLabel: 'Übernehmen' });
    if (!ok) return;
  }
  if (draft.mode === 'replace' && useProjectStore.getState().project.walls.length > 0) {
    const ok = await confirmDialog('Der bestehende Grundriss (Wände, Öffnungen, Räume) wird ersetzt. Möbel bleiben erhalten.', { confirmLabel: 'Ersetzen', danger: true });
    if (!ok) return;
  }
  // recognised room proposals must not rename rooms that already exist (merge mode)
  const skipped = draft.source === 'json' ? [] : roomsInsideExistingRooms(draft, useProjectStore.getState().project);
  const toApply = skipped.length ? { ...draft, rooms: draft.rooms.map((r) => (skipped.includes(r.id) ? { ...r, accepted: false } : r)) } : draft;
  let result: ReturnType<typeof applyDraft> | null = null;
  useProjectStore.getState().apply((d) => {
    result = applyDraft(d, toApply);
    if (draft.name && d.walls.length === result.wallsAdded) d.name = draft.name;
  });
  useImportStore.getState().setDraft(null);
  const r = result as ReturnType<typeof applyDraft> | null;
  const ui = useUiStore.getState();
  ui.requestFit();
  ui.setLeftTab('tools');
  if (r) {
    ui.toast(`Übernommen: ${r.wallsAdded} Wandsegmente, ${r.openingsAdded} Öffnungen, ${r.roomsAdded} Räume${r.fixturesAdded ? `, ${r.fixturesAdded} Sanitärobjekte (Bestand)` : ''}${r.installationsAdded ? `, ${r.installationsAdded} Anschlüsse` : ''}.`, 'success');
    const skippedNote =
      skipped.length === 1
        ? ['Ein vorgeschlagener Raum liegt in einem bestehenden Raum und wurde nicht übernommen.']
        : skipped.length > 1
          ? [`${skipped.length} vorgeschlagene Räume liegen in bestehenden Räumen und wurden nicht übernommen.`]
          : [];
    const warnings = [...skippedNote, ...r.warnings];
    if (warnings.length) ui.toast(warnings.slice(0, 3).join(' · '), 'error');
  }
}

export function exportFloorPlanJson(includeFurniture = false) {
  const p = useProjectStore.getState().project;
  const plan = projectToFloorPlan(p, { includeFurniture });
  downloadBlob(JSON.stringify(plan, null, 2), `${safeFileName(p.name)}.apartment-plan.json`);
  useUiStore.getState().toast('Grundriss als apartment-plan.json exportiert', 'success');
}
