import { create } from 'zustand';
import type { FurnishingSuggestion } from '../suggest/furnishing';
import type { Critique } from './critique';

/** State of „Raumkritik mit Claude“ (#365); lives for this session, nothing goes into the project file. */
interface CritiqueStore {
  /** Room id, or '__all' for the whole apartment (default). */
  scope: string;
  asking: boolean;
  error: string | null;
  critique: Critique | null;
  /** Suggestion shown as a ghost preview, and the ghosts put into the shared preview store. */
  previewId: string | null;
  ghosts: FurnishingSuggestion | null;
  set: (patch: Partial<Omit<CritiqueStore, 'set'>>) => void;
}

export const useCritiqueStore = create<CritiqueStore>((set) => ({
  scope: '__all',
  asking: false,
  error: null,
  critique: null,
  previewId: null,
  ghosts: null,
  set: (patch) => set(patch),
}));
