import { addLevel, deleteLevel, neighbourLevel, planOfLevel, renameLevel, setLevelElevation, switchLevel, type NewLevelOptions } from '../model/levels';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { confirmDialog } from './dialogStore';

/**
 * Storey actions for the UI (#54). Switching is no undo step of its own; adding, renaming,
 * changing the height and removing a storey are.
 */
const store = () => useProjectStore.getState();

/** Things that belong to one storey (selection, carried furniture, drawn measurements) end with the switch. */
function leaveStorey() {
  const ui = useUiStore.getState();
  ui.setSelection(null);
  ui.setHover(null);
  ui.setWalkCarry(null);
  ui.clearMeasurements();
}

export function goToLevel(levelId: string): boolean {
  if (store().txBase || levelId === store().project.activeLevelId) return false;
  if (!store().project.levels.some((l) => l.id === levelId)) return false;
  leaveStorey();
  store().applyWithoutHistory((d) => void switchLevel(d, levelId));
  return true;
}

/** Bild auf / Bild ab: the storey above or below. */
export function goToNeighbourLevel(dir: 1 | -1): boolean {
  const next = neighbourLevel(store().project, dir);
  return next ? goToLevel(next.id) : false;
}

/** Add a storey and switch to it; returns its id. */
export function createLevel(opts: NewLevelOptions = {}): string | null {
  if (store().txBase) return null;
  let id = '';
  store().apply((d) => void (id = addLevel(d, opts)));
  goToLevel(id);
  const name = store().project.levels.find((l) => l.id === id)?.name ?? 'Etage';
  useUiStore.getState().toast(`Etage „${name}“ angelegt.`, 'success');
  return id;
}

export function renameLevelTo(levelId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) return;
  store().apply((d) => renameLevel(d, levelId, trimmed));
}

export function changeLevelElevation(levelId: string, elevation: number) {
  store().apply((d) => setLevelElevation(d, levelId, elevation));
}

export async function removeLevel(levelId: string): Promise<boolean> {
  const p = store().project;
  const level = p.levels.find((l) => l.id === levelId);
  if (!level || p.levels.length <= 1) return false;
  const plan = planOfLevel(p, levelId);
  const content = plan.walls.length + plan.furniture.length;
  const ok = await confirmDialog(
    content
      ? `Die Etage „${level.name}“ mit ${plan.walls.length} Wänden und ${plan.furniture.length} Objekten wird entfernt. Rückgängig mit Strg+Z.`
      : `Die leere Etage „${level.name}“ wird entfernt.`,
    { title: 'Etage entfernen', confirmLabel: 'Entfernen', danger: true },
  );
  if (!ok) return false;
  if (levelId === p.activeLevelId) leaveStorey();
  store().apply((d) => void deleteLevel(d, levelId));
  return true;
}
