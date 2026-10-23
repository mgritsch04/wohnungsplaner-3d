import { create } from 'zustand';
import type { FurnishingSuggestion } from '../suggest/furnishing';
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
  roomId: string | null;
  asking: boolean;
  error: string | null;
  proposal: DesignProposal | null;
  /** Room the proposal was made for. */
  proposalRoomId: string | null;
  preview: FurnishingSuggestion | null;
  setWishes: (patch: Partial<DesignWishes>) => void;
  set: (patch: Partial<Omit<DesignStore, 'set' | 'setWishes'>>) => void;
}

export const useDesignStore = create<DesignStore>((set, get) => ({
  wishes: loadWishes(),
  roomId: null,
  asking: false,
  error: null,
  proposal: null,
  proposalRoomId: null,
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
