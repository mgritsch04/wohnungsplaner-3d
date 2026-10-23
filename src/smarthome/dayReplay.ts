import { create } from 'zustand';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useSimStore } from './simStore';
import { dayInitialState, positionAt, runDayRoutine, type DayRun } from './dayRoutine';
import type { EntityState, SimEvent } from './simulation';

/**
 * Playback of the day routine (#359): the result of `runDayRoutine` is replayed in the plan
 * (figure, clock, lamps, sensors) at a tempo that slows down while the person walks.
 * Nothing here is saved in the project.
 */
interface DayStore {
  result: DayRun | null;
  playing: boolean;
  /** seconds since 00:00 of the replay */
  t: number;
  run: () => DayRun;
  play: (fromHour?: number) => void;
  stop: () => void;
  clear: () => void;
}

const TICK_MS = 100;
/** simulated seconds per real second: fast while standing, slower while walking */
export const REPLAY_SPEED = { still: 1200, walking: 40 } as const;

let timer: ReturnType<typeof setInterval> | null = null;

export const useDayStore = create<DayStore>((set, get) => ({
  result: null,
  playing: false,
  t: 0,
  run: () => {
    get().stop();
    const project = useProjectStore.getState().project;
    const result = runDayRoutine(project, derivePlan(project));
    set({ result, t: 0 });
    return result;
  },
  play: (fromHour = 0) => {
    const { result } = get();
    if (!result?.ok) return;
    get().stop();
    const project = useProjectStore.getState().project;
    const sim = useSimStore.getState();
    if (sim.running) sim.stop();
    let t = Math.max(0, Math.min(result.durationS - 1, fromHour * 3600));
    const base = dayInitialState(project);
    let idx = 0;
    let entities: Record<string, EntityState> = Object.fromEntries(Object.entries(base.entities).map(([k, v]) => [k, { ...v }]));
    const frame = (t0: number) => {
      // changes are replayed in order; seeking backwards restarts from midnight
      if (idx > 0 && result.changes[idx - 1].t > t0) {
        idx = 0;
        entities = Object.fromEntries(Object.entries(base.entities).map(([k, v]) => [k, { ...v }]));
      }
      while (idx < result.changes.length && result.changes[idx].t <= t0) {
        const c = result.changes[idx++];
        entities[c.id] = { ...entities[c.id], on: c.on, ...(c.brightness !== undefined ? { brightness: c.brightness } : {}) };
      }
      const cur = positionAt(result.segments, t0);
      const log: SimEvent[] = result.log.filter((e) => e.t <= t0).slice(-50);
      useSimStore.setState({
        state: { t: t0, hour: (t0 / 3600) % 24, entities: { ...entities }, pendingOff: {}, events: log },
        person: cur.pos,
      });
      useUiStore.getState().setTimePreview((t0 / 3600) % 24);
      set({ t: t0 });
      return cur.walking;
    };
    frame(t);
    set({ playing: true });
    timer = setInterval(() => {
      const walking = positionAt(result.segments, t).walking;
      t += (TICK_MS / 1000) * (walking ? REPLAY_SPEED.walking : REPLAY_SPEED.still);
      if (t >= result.durationS) {
        frame(result.durationS - 1);
        if (timer) clearInterval(timer);
        timer = null;
        set({ playing: false });
        return;
      }
      frame(t);
    }, TICK_MS);
  },
  stop: () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (get().playing || get().t > 0) {
      useSimStore.setState({ state: null, person: null });
      useUiStore.getState().setTimePreview(null);
    }
    set({ playing: false, t: 0 });
  },
  clear: () => {
    get().stop();
    set({ result: null, t: 0 });
  },
}));
