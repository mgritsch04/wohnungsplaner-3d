import { derivePlan } from '../model/derived';
import { runPlanCheck, type CheckItem } from '../model/planCheck';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useCheckStore } from './checkStore';

/** Runs all plan checks on the current plan and stores the result (#357). */
export function startPlanCheck() {
  const project = useProjectStore.getState().project;
  useCheckStore.getState().setResult(runPlanCheck(project, derivePlan(project)));
}

/** Jumps to the place of a finding: selects the object, centres the 2D plan on it and rings it. */
export function jumpToCheckItem(item: CheckItem) {
  if (!item.at) return;
  const at = item.at;
  const ui = useUiStore.getState();
  if (item.select) ui.setSelection(item.select);
  else ui.setSelection(null);
  useCheckStore.getState().setFocus({ id: item.id, at });
  const centre = () => {
    const u = useUiStore.getState();
    u.setView2d({ cx: at.x, cy: at.y, zoom: Math.max(u.view2d.zoom, 90) });
  };
  if (ui.viewMode === '3d') {
    // the plan pane is not mounted in 3D-only; its fit-to-content on mount would undo the jump
    ui.setViewMode('split');
    setTimeout(centre, 500);
  } else centre();
}
