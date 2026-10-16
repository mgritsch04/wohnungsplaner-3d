import { FileFormatError } from '../formats/zodErrors';
import { deleteVersion, listVersions, loadVersion, saveVersion, type VersionMeta } from '../persistence/versions';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { VersionLimitError, autoVersionName, contentHash, contentKey, restoreVersionContent } from './versions';
import type { Project } from '../model/schema';

const store = () => useProjectStore.getState();
const ui = () => useUiStore.getState();

/** The committed current project (a running drag is not part of a saved state). */
const currentProject = () => store().txBase ?? store().project;

function describe(e: unknown): string {
  if (e instanceof VersionLimitError || e instanceof FileFormatError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Save the current project state under `name`. Returns the new entry or null (with a toast). */
export async function saveCurrentVersion(name: string): Promise<VersionMeta | null> {
  try {
    const meta = await saveVersion(currentProject(), name);
    ui().toast(`Stand „${meta.name}“ gespeichert`, 'success');
    return meta;
  } catch (e) {
    if (!(e instanceof VersionLimitError)) console.error('Stand speichern fehlgeschlagen', e);
    ui().toast(`Stand nicht gespeichert: ${describe(e)}`, 'error');
    return null;
  }
}

/** An existing state with exactly the content of `p` (hash match, verified by full comparison). */
async function findIdenticalVersion(p: Project): Promise<VersionMeta | null> {
  const hash = contentHash(p);
  const candidates = (await listVersions(p.id)).filter((v) => v.hash === hash);
  if (!candidates.length) return null;
  const key = contentKey(p);
  for (const v of candidates) {
    const saved = await loadVersion(v.id).catch(() => null);
    if (saved && contentKey(saved) === key) return v;
  }
  return null;
}

export interface OpenResult {
  /** Automatic state created before switching (null when the current state was already saved). */
  backup: VersionMeta | null;
}

/**
 * Open a saved state. The current state is saved first as
 * „Automatisch vor dem Wechsel zu …“ unless an identical state already exists,
 * so nothing is lost. The switch itself is one undo step.
 */
export async function openVersion(meta: VersionMeta): Promise<OpenResult | null> {
  try {
    const snapshot = await loadVersion(meta.id);
    if (!snapshot) {
      ui().toast(`Stand „${meta.name}“ wurde nicht gefunden.`, 'error');
      return null;
    }
    const current = currentProject();
    const existing = await findIdenticalVersion(current);
    const backup = existing ? null : await saveVersion(current, autoVersionName(meta.name), { auto: true });
    if (store().txBase) store().commitTransaction();
    store().apply((d) => restoreVersionContent(d, snapshot));
    ui().setSelection(null);
    ui().toast(
      backup
        ? `Stand „${meta.name}“ geöffnet. Der vorherige Stand ist als „${backup.name}“ gesichert (Strg+Z macht das Öffnen rückgängig).`
        : `Stand „${meta.name}“ geöffnet. Der vorherige Stand war bereits als „${existing?.name}“ gespeichert.`,
      'success',
    );
    return { backup };
  } catch (e) {
    if (e instanceof VersionLimitError) {
      ui().toast(`Stand nicht geöffnet: Der aktuelle Stand kann nicht automatisch gesichert werden. ${e.message}`, 'error');
    } else {
      console.error('Stand öffnen fehlgeschlagen', e);
      ui().toast(`Stand konnte nicht geöffnet werden: ${describe(e)}`, 'error');
    }
    return null;
  }
}

export async function removeVersion(meta: VersionMeta): Promise<boolean> {
  try {
    await deleteVersion(meta.projectId, meta.id);
    ui().toast(`Stand „${meta.name}“ gelöscht`, 'info');
    return true;
  } catch (e) {
    console.error('Stand löschen fehlgeschlagen', e);
    ui().toast(`Stand konnte nicht gelöscht werden: ${describe(e)}`, 'error');
    return false;
  }
}
