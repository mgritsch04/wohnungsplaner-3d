import { create } from 'zustand';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import type { Segment } from '../model/visibility';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useWalkPose } from '../store/walkPoseStore';
import { initialState, lightOverrides, occludersOf, step, type SimState } from './simulation';

/** Runtime state of the smart-home simulation (#170); nothing here is saved in the project. */
interface SimStore {
  running: boolean;
  /** simulated seconds per real second */
  speed: number;
  state: SimState | null;
  /** simulated person in the 2D plan (the walkthrough camera wins while walking) */
  person: Vec2 | null;
  selectedDeviceId: string | null;
  start: () => void;
  stop: () => void;
  setSpeed: (s: number) => void;
  setPerson: (p: Vec2 | null) => void;
  select: (id: string | null) => void;
}

export const SPEEDS = [1, 10, 60, 600] as const;
/** a person counts as moving this long after the last movement (real seconds) */
const MOVING_FOR_MS = 1500;
const PUBLISH_MS = 100;

let raf = 0;
let lastFrame = 0;
let lastPublish = 0;
let lastPos: Vec2 | null = null;
let lastMoveAt = -Infinity;
let cache: { project: Project; occluders: Segment[] } | null = null;
let live: SimState | null = null;

function occluders(project: Project): Segment[] {
  if (cache?.project !== project) cache = { project, occluders: occludersOf(project, derivePlan(project)) };
  return cache.occluders;
}

/** Position used as "the person": walkthrough camera if walking, else the 2D marker. */
export function personPosition(): Vec2 | null {
  const walking = useUiStore.getState().cameraMode === 'walk';
  const pose = useWalkPose.getState().pose;
  if (walking && pose) return { x: pose.x, y: pose.y };
  return useSimStore.getState().person;
}

export const useSimStore = create<SimStore>((set, get) => ({
  running: false,
  speed: 1,
  state: null,
  person: null,
  selectedDeviceId: null,
  start: () => {
    if (get().running) return;
    const project = useProjectStore.getState().project;
    live = get().state ?? initialState(project);
    set({ running: true, state: live });
    lastFrame = performance.now();
    const frame = (now: number) => {
      const s = get();
      if (!s.running || !live) return;
      const realDt = Math.min(0.25, (now - lastFrame) / 1000);
      lastFrame = now;
      const p = personPosition();
      if (p && (!lastPos || Math.hypot(p.x - lastPos.x, p.y - lastPos.y) > 0.02)) {
        lastMoveAt = now;
        lastPos = p;
      }
      if (!p) lastPos = null;
      const proj = useProjectStore.getState().project;
      const occ = occluders(proj);
      let simDt = realDt * s.speed;
      const input = { person: p, moving: now - lastMoveAt < MOVING_FOR_MS };
      // sub-steps of ≤ 1 simulated second keep hold times and off-delays exact
      while (simDt > 0) {
        const d = Math.min(1, simDt);
        live = step(proj, occ, live, d, input);
        simDt -= d;
      }
      if (now - lastPublish >= PUBLISH_MS) {
        lastPublish = now;
        set({ state: live });
        useUiStore.getState().setTimePreview(live.hour);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  },
  stop: () => {
    cancelAnimationFrame(raf);
    live = null;
    set({ running: false, state: null });
    useUiStore.getState().setTimePreview(null);
  },
  setSpeed: (speed) => set({ speed }),
  setPerson: (person) => set({ person }),
  select: (selectedDeviceId) => set({ selectedDeviceId }),
}));

/** Light switch states imposed by the running simulation (empty while stopped). */
export function useSimLightOverrides(project: Project) {
  const state = useSimStore((s) => s.state);
  return state ? lightOverrides(project, state) : null;
}
