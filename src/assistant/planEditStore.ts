import { create } from 'zustand';
import type { DesignQuality } from './design';
import type { EditInput, EditPlan } from './planEdit';

/**
 * State of „Claude ändern lassen“ (#415) for this session; nothing of it is saved in the project.
 * `plan.preview` also lives in the shared furnishing preview store, so 2D and 3D draw it.
 */
interface PlanEditStore {
  instruction: string;
  scope: string;
  quality: DesignQuality;
  asking: boolean;
  error: string | null;
  summary: string;
  notPossible: string[];
  dropped: number;
  input: EditInput | null;
  plan: EditPlan | null;
  set: (patch: Partial<Omit<PlanEditStore, 'set'>>) => void;
}

export const usePlanEditStore = create<PlanEditStore>((set) => ({
  instruction: '',
  scope: '__all',
  quality: 'thorough',
  asking: false,
  error: null,
  summary: '',
  notPossible: [],
  dropped: 0,
  input: null,
  plan: null,
  set: (patch) => set(patch),
}));
