import { create } from 'zustand';
import type { FurnishingSuggestion } from '../suggest/furnishing';
import type { AssistantSuggestion } from './answer';

/**
 * State of „Claude fragen“ (#151) for this session; nothing of it is saved in the project.
 * `preview` is the furnishing preview built from one of Claude's suggestions (index
 * `previewIndex`); it lives in the shared furnishing preview store as well, so 2D and 3D
 * draw it like the rule-based suggestion of #137.
 */
interface AssistantStore {
  question: string;
  scope: string;
  asking: boolean;
  /** Claude was declined or is not available in this view: the panel stays hidden. */
  hidden: boolean;
  error: string | null;
  suggestions: AssistantSuggestion[];
  /** The scope the suggestions were asked for (room id or '__all'). */
  answeredScope: string | null;
  previewIndex: number | null;
  preview: FurnishingSuggestion | null;
  set: (patch: Partial<Omit<AssistantStore, 'set'>>) => void;
}

export const useAssistantStore = create<AssistantStore>((set) => ({
  question: '',
  scope: '__all',
  asking: false,
  hidden: false,
  error: null,
  suggestions: [],
  answeredScope: null,
  previewIndex: null,
  preview: null,
  set: (patch) => set(patch),
}));
