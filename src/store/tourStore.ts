import { create } from 'zustand';
import { planTour, type TourPlan } from '../model/tour';
import { derivePlan } from '../model/derived';
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

/**
 * State of the automatic tour (Rundgang). `startTour` plans the route for the current storey and
 * switches to the walkthrough; `TourDriver` (inside the 3D canvas) moves the camera along it.
 */
interface TourState {
  plan: TourPlan | null;
  /** Seconds into the tour; advanced by the driver. */
  time: number;
  playing: boolean;
  /** Index of the room being visited. */
  stop: number;
  /** Set when the plan could not be built. */
  error: string | null;
  start: () => void;
  end: () => void;
  setProgress: (time: number, stop: number) => void;
}

export const useTourStore = create<TourState>((set) => ({
  plan: null,
  time: 0,
  playing: false,
  stop: 0,
  error: null,
  start: () => {
    const project = useProjectStore.getState().project;
    const derived = derivePlan(project);
    const plan = planTour(project, derived);
    if (plan.stops.length === 0) {
      set({ plan: null, playing: false, error: 'Kein Rundgang möglich: im Plan sind keine begehbaren Räume.' });
      return;
    }
    useUiStore.getState().setCameraMode('walk');
    set({ plan, time: 0, stop: 0, playing: true, error: null });
  },
  end: () => set({ playing: false, plan: null, time: 0, stop: 0 }),
  setProgress: (time, stop) => set({ time, stop }),
}));
