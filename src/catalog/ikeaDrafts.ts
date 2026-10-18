import { create } from 'zustand';
import { readDraft } from './providers/ikeaHelper';
import type { DraftEntry } from './providers/ikeaList';

/**
 * Products whose page lacks dimensions (#269), waiting under „Maße fehlen“ in Katalog › IKEA
 * until the user enters them. Kept in localStorage on this device (like the bookmarklet inbox,
 * they are not part of the project).
 */
export interface PendingDraft {
  article: string;
  draft: DraftEntry;
  /** 3D model file cached by the helper, if any */
  model: string | null;
  receivedAt: string;
}

export const IKEA_DRAFTS_STORAGE_KEY = 'wohnungsplaner-ikea-masse-fehlen';
const MAX_DRAFTS = 30;

function load(): PendingDraft[] {
  try {
    const raw = JSON.parse(localStorage.getItem(IKEA_DRAFTS_STORAGE_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((p: Record<string, unknown>) => {
      const draft = readDraft(p?.draft);
      if (!draft || typeof p.article !== 'string') return [];
      const model = typeof p.model === 'string' && /^s?\d{8}\.glb$/i.test(p.model) ? p.model : null;
      return [{ article: p.article, draft, model, receivedAt: typeof p.receivedAt === 'string' ? p.receivedAt : '' }];
    });
  } catch {
    return [];
  }
}

function save(drafts: PendingDraft[]) {
  try {
    localStorage.setItem(IKEA_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
  } catch {
    /* storage blocked – the list lives until the page is closed */
  }
}

interface DraftState {
  drafts: PendingDraft[];
  add: (d: PendingDraft) => void;
  remove: (article: string) => void;
}

export const useIkeaDrafts = create<DraftState>((set, get) => ({
  drafts: load(),
  add: (d) => {
    // the same product sent again replaces the older entry
    const drafts = [...get().drafts.filter((x) => x.article !== d.article), d].slice(-MAX_DRAFTS);
    save(drafts);
    set({ drafts });
  },
  remove: (article) => {
    const drafts = get().drafts.filter((x) => x.article !== article);
    save(drafts);
    set({ drafts });
  },
}));
