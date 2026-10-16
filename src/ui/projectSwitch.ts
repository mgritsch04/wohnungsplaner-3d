import { useSightStore } from '../editor2d/sightStore';
import { useWalkPathStore } from '../editor2d/walkPathStore';
import type { Vec2 } from '../model/vec';
import type { WalkPathResult } from '../model/walkPath';
import { useProjectStore } from '../store/projectStore';
import { useUiStore, type Measurement } from '../store/uiStore';
import { useTapeStore } from '../view3d/tapeStore';
import type { V3 } from '../view3d/tapeMeasure';

/**
 * Temporary tool results belong to the project they were made in (#133): 2D measuring
 * lines, 3D tape measurements (#88), the walking path (#67) and the sight-line viewpoint
 * (#89). They are never saved in the project, so on a project switch (new, opened or
 * imported project – a different project id) they are put aside and the tools start
 * empty. Going back to a project in the same session brings its results back. Tool modes
 * and display toggles (active tool, tape on/off, sight lines on/off) stay as they are.
 */
interface ToolResults {
  measurements: Measurement[];
  tape: { pending: V3 | null; items: { id: number; a: V3; b: V3 }[] };
  walkPath: { start: Vec2 | null; goal: Vec2 | null; result: WalkPathResult | null };
  sightPoint: Vec2 | null;
}

/** Projects whose results are kept for this session (oldest dropped first). */
const KEEP = 20;
const saved = new Map<string, ToolResults>();

function take(): ToolResults {
  const tape = useTapeStore.getState();
  const walk = useWalkPathStore.getState();
  return {
    measurements: useUiStore.getState().measurements,
    tape: { pending: tape.pending, items: tape.items },
    walkPath: { start: walk.start, goal: walk.goal, result: walk.result },
    sightPoint: useSightStore.getState().point,
  };
}

const isEmpty = (r: ToolResults) => !r.measurements.length && !r.tape.items.length && !r.tape.pending && !r.walkPath.start && !r.sightPoint;

function put(r: ToolResults | undefined) {
  useUiStore.setState({ measurements: r?.measurements ?? [] });
  useTapeStore.setState({ pending: r?.tape.pending ?? null, items: r?.tape.items ?? [] });
  useWalkPathStore.setState(r?.walkPath ?? { start: null, goal: null, result: null });
  useSightStore.setState({ point: r?.sightPoint ?? null, share: null });
}

/** Put the tool results of project `fromId` aside and show those of `toId` (none for a new project). */
export function switchToolResults(fromId: string, toId: string) {
  if (fromId === toId) return;
  const current = take();
  saved.delete(fromId);
  if (!isEmpty(current)) saved.set(fromId, current);
  while (saved.size > KEEP) saved.delete(saved.keys().next().value!);
  put(saved.get(toId));
  saved.delete(toId);
}

useProjectStore.subscribe((st, prev) => {
  if (st.project.id !== prev.project.id) switchToolResults(prev.project.id, st.project.id);
});
