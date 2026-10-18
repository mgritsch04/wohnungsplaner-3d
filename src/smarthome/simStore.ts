import { create } from 'zustand';
import { derivePlan } from '../model/derived';
import type { Project, SmartDeviceKind } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useWalkPose } from '../store/walkPoseStore';
import { initialState, lightOverrides, occludersOf, step, type Occluder, type SimState } from './simulation';

/** Device waiting to be placed by a click into the 2D plan (#233). */
export interface Placing {
  kind: SmartDeviceKind;
  productId?: string;
}

export type PanelStep = 'devices' | 'rules' | 'test';

/** Runtime state of the smart-home simulation (#170); nothing here is saved in the project. */
interface SimStore {
  running: boolean;
  /** simulated seconds per real second */
  speed: number;
  state: SimState | null;
  /** simulated person in the 2D plan (the walkthrough camera wins while walking) */
  person: Vec2 | null;
  /** click-to-place mode of the 2D plan */
  placing: Placing | null;
  /** device to highlight briefly (just placed); `at` restarts the animation */
  flash: { id: string; at: number } | null;
  /** open step of the Smart Home tab */
  step: PanelStep;
  setStep: (s: PanelStep) => void;
  start: () => void;
  stop: () => void;
  setSpeed: (s: number) => void;
  setPerson: (p: Vec2 | null) => void;
  setPlacing: (p: Placing | null) => void;
  setFlash: (id: string | null) => void;
  /** switch a lamp/plug by hand (starts the simulation if needed) */
  setEntity: (id: string, on: boolean) => void;
  /** let a sensor report as if it detected something (starts the simulation if needed) */
  trigger: (id: string) => void;
}

export const SPEEDS = [1, 10, 60, 600] as const;
/** a person counts as moving this long after the last movement (real seconds) */
const MOVING_FOR_MS = 1500;
const PUBLISH_MS = 100;
/** a hand trigger counts as detection for this long (real seconds) */
const TRIGGER_MS = 1000;
/** how long a just placed device pulses */
const FLASH_MS = 2400;

let raf = 0;
let lastFrame = 0;
let lastPublish = 0;
let lastPos: Vec2 | null = null;
let lastMoveAt = -Infinity;
let cache: { project: Project; occluders: Occluder[] } | null = null;
let live: SimState | null = null;
const triggeredUntil = new Map<string, number>();

function occluders(project: Project): Occluder[] {
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
  placing: null,
  flash: null,
  step: 'devices',
  setStep: (step) => set({ step }),
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
      for (const [id, until] of triggeredUntil) if (until < now) triggeredUntil.delete(id);
      const proj = useProjectStore.getState().project;
      const occ = occluders(proj);
      let simDt = realDt * s.speed;
      const input = { person: p, moving: now - lastMoveAt < MOVING_FOR_MS, triggered: new Set(triggeredUntil.keys()) };
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
    triggeredUntil.clear();
    set({ running: false, state: null });
    useUiStore.getState().setTimePreview(null);
  },
  setSpeed: (speed) => set({ speed }),
  setPerson: (person) => set({ person }),
  setPlacing: (placing) => set({ placing }),
  setFlash: (id) => {
    const flash = id ? { id, at: Date.now() } : null;
    set({ flash });
    if (flash) setTimeout(() => get().flash === flash && set({ flash: null }), FLASH_MS);
  },
  setEntity: (id, on) => {
    get().start();
    if (!live) return;
    const prev = live.entities[id];
    const name = useProjectStore.getState().project.devices.find((d) => d.id === id)?.name ?? id;
    live = {
      ...live,
      entities: { ...live.entities, [id]: { ...prev, on, brightness: on ? (prev?.brightness ?? 100) : prev?.brightness } },
      events: [...live.events, { t: live.t, hour: live.hour, text: `${name} von Hand ${on ? 'an' : 'aus'}` }].slice(-50),
    };
    set({ state: live });
  },
  trigger: (id) => {
    get().start();
    triggeredUntil.set(id, performance.now() + TRIGGER_MS);
  },
}));

/** Light switch states imposed by the running simulation (empty while stopped). */
export function useSimLightOverrides(project: Project) {
  const state = useSimStore((s) => s.state);
  return state ? lightOverrides(project, state) : null;
}

/** Id of the device selected in the plan (normal selection of the planner, type `device`). */
export const useSelectedDeviceId = () => useUiStore((s) => (s.selection?.type === 'device' ? s.selection.id : null));
