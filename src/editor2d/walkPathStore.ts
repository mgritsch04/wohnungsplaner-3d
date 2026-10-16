import { create } from 'zustand';
import { derivePlan } from '../model/derived';
import type { Vec2 } from '../model/vec';
import { shortestWalkPath, type WalkPathResult } from '../model/walkPath';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

/**
 * Walking-path measurement (#67): display only – never stored in the project,
 * so there is no schema change and no undo step.
 */
interface WalkPathStore {
  start: Vec2 | null;
  goal: Vec2 | null;
  result: WalkPathResult | null;
  clear: () => void;
}

export const useWalkPathStore = create<WalkPathStore>((set) => ({
  start: null,
  goal: null,
  result: null,
  clear: () => set({ start: null, goal: null, result: null }),
}));

/** First click: start (a new path). Second click: goal → compute once. */
export function walkPathClick(p: Vec2) {
  const s = useWalkPathStore.getState();
  if (!s.start || s.goal) {
    useWalkPathStore.setState({ start: p, goal: null, result: null });
    return;
  }
  const project = useProjectStore.getState().project;
  const result = shortestWalkPath(project, derivePlan(project), s.start, p);
  useWalkPathStore.setState({ goal: p, result });
  if (!result.ok) useUiStore.getState().toast(result.reason, 'info');
}

// leaving the tool (also Esc, which switches to "Auswählen") removes the path
useUiStore.subscribe((st, prev) => {
  if (prev.tool === 'walkpath' && st.tool !== 'walkpath') useWalkPathStore.getState().clear();
});
