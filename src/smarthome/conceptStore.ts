import { create } from 'zustand';
import { useProjectStore } from '../store/projectStore';
import { EMPTY_CONCEPT_WISHES, suggestionOf, type ConceptWishes, type Phase, type SmartHomeConcept } from './concept';
import { useSmartSuggestStore } from './suggestStore';

const KEY = 'wohnungsplaner-smarthome-concept-wishes';

function loadWishes(): ConceptWishes {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY_CONCEPT_WISHES, ...(JSON.parse(raw) as Partial<ConceptWishes>) } : EMPTY_CONCEPT_WISHES;
  } catch {
    return EMPTY_CONCEPT_WISHES;
  }
}

/**
 * State of „Smart-Home-Konzept für die ganze Wohnung“ (#375). The wishes stay in this browser
 * (never in the project file); concept and phase choice live for this session. The preview in the
 * plan is the ordinary smart-home preview of #225, filled with the devices up to the chosen phase.
 */
interface ConceptStore {
  wishes: ConceptWishes;
  asking: boolean;
  error: string | null;
  concept: SmartHomeConcept | null;
  /** Devices up to this phase are previewed and taken over. */
  upTo: Phase;
  setWishes: (patch: Partial<ConceptWishes>) => void;
  set: (patch: Partial<Pick<ConceptStore, 'asking' | 'error' | 'concept' | 'upTo'>>) => void;
  /** Shows the concept's devices up to `upTo` in the plan. */
  show: (upTo?: Phase) => void;
  /** Throws the concept and its preview away; the plan stays as it is. */
  discard: () => void;
}

export const useConceptStore = create<ConceptStore>((set, get) => ({
  wishes: loadWishes(),
  asking: false,
  error: null,
  concept: null,
  upTo: 3,
  setWishes: (patch) => {
    const wishes = { ...get().wishes, ...patch };
    set({ wishes });
    try {
      localStorage.setItem(KEY, JSON.stringify(wishes));
    } catch {
      // storage blocked: the wishes just last for this session
    }
  },
  set: (patch) => set(patch),
  show: (upTo) => {
    const { concept } = get();
    const phase = upTo ?? get().upTo;
    set({ upTo: phase });
    useSmartSuggestStore.getState().setPreview(concept ? suggestionOf(concept, phase) : null);
  },
  discard: () => {
    set({ concept: null, error: null });
    useSmartSuggestStore.getState().setPreview(null);
  },
}));

// any change of the project (edit, undo, load, taking the devices over) makes the concept stale
useProjectStore.subscribe((s, prev) => {
  if (s.revision !== prev.revision && useConceptStore.getState().concept) useConceptStore.setState({ concept: null });
});
