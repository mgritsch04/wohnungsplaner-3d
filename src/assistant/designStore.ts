import { create } from 'zustand';
import type { FurnishingSuggestion } from '../suggest/furnishing';
import type { FurnishRunResult } from '../design/run';
import { EMPTY_WISHES, type DesignProposal, type DesignWishes } from './design';

const KEY = 'wohnungsplaner-design-wishes';

function loadWishes(): DesignWishes {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY_WISHES, ...(JSON.parse(raw) as Partial<DesignWishes>) } : EMPTY_WISHES;
  } catch {
    return EMPTY_WISHES;
  }
}

/**
 * State of „Einrichtungsvorschlag mit Claude“ (#350). The wishes are kept in this browser only
 * (never in the project file); proposal and preview live for this session. The preview is also
 * put into the shared furnishing preview store, so 2D and 3D draw it like the one of #137.
 */
interface DesignStore {
  wishes: DesignWishes;
  /** Room id, or '__all' for the whole apartment (default). */
  scope: string;
  asking: boolean;
  error: string | null;
  proposal: DesignProposal | null;
  /** The whole run of the new way (#442): concept, programmes, placement and walk-through. */
  result: FurnishRunResult | null;
  /**
   * Claude's plan as it came (#436, „Ideal“): placeholders with the wanted size, look and functions.
   * `result`/`proposal` become „Kaufbar“ as real products replace placeholders and rooms are placed anew.
   */
  ideal: { result: FurnishRunResult; proposal: DesignProposal } | null;
  /** Which of the two the panel shows, previews and applies. */
  variant: 'ideal' | 'kaufbar';
  preview: FurnishingSuggestion | null;
  setWishes: (patch: Partial<DesignWishes>) => void;
  set: (patch: Partial<Omit<DesignStore, 'set' | 'setWishes'>>) => void;
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  wishes: loadWishes(),
  scope: '__all',
  asking: false,
  error: null,
  proposal: null,
  result: null,
  ideal: null,
  variant: 'kaufbar',
  preview: null,
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
}));
