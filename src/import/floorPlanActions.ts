import { applyDraft, floorPlanToDraft, parseFloorPlanJson, projectToFloorPlan } from '../formats/floorplan/convert';
import { FileFormatError } from '../formats/zodErrors';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob, pickFile, safeFileName } from '../ui/fileUtils';
import { reportError } from '../ui/actions';
import { confirmDialog } from '../ui/dialogStore';
import { useImportStore } from './importStore';
import { findDraftConflicts } from './review';

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
  const uncertain = [...draft.walls, ...draft.openings].filter((x) => x.accepted && x.status === 'uncertain').length;
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
  let result: ReturnType<typeof applyDraft> | null = null;
  useProjectStore.getState().apply((d) => {
    result = applyDraft(d, draft);
    if (draft.name && d.walls.length === result.wallsAdded) d.name = draft.name;
  });
  useImportStore.getState().setDraft(null);
  const r = result as ReturnType<typeof applyDraft> | null;
  const ui = useUiStore.getState();
  ui.requestFit();
  ui.setLeftTab('tools');
  if (r) {
    ui.toast(`Übernommen: ${r.wallsAdded} Wandsegmente, ${r.openingsAdded} Öffnungen, ${r.roomsAdded} Räume.`, 'success');
    if (r.warnings.length) ui.toast(r.warnings.slice(0, 3).join(' · '), 'error');
  }
}

export function exportFloorPlanJson(includeFurniture = false) {
  const p = useProjectStore.getState().project;
  const plan = projectToFloorPlan(p, { includeFurniture });
  downloadBlob(JSON.stringify(plan, null, 2), `${safeFileName(p.name)}.apartment-plan.json`);
  useUiStore.getState().toast('Grundriss als apartment-plan.json exportiert', 'success');
}
