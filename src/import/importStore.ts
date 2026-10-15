import { create } from 'zustand';
import type { DraftOpening, DraftRoom, DraftWall, ReconstructionDraft } from './draft';

export type DraftSelection = { type: 'wall' | 'opening' | 'room'; id: string } | null;

interface ImportStore {
  draft: ReconstructionDraft | null;
  selected: DraftSelection;
  /** Progress of a running import/recognition (0..1) and its label. */
  progress: { label: string; value: number } | null;
  setDraft: (d: ReconstructionDraft | null) => void;
  select: (s: DraftSelection) => void;
  updateWall: (id: string, patch: Partial<DraftWall>) => void;
  updateOpening: (id: string, patch: Partial<DraftOpening>) => void;
  updateRoom: (id: string, patch: Partial<DraftRoom>) => void;
  removeElement: (type: 'wall' | 'opening' | 'room', id: string) => void;
  setAllAccepted: (accepted: boolean) => void;
  setProgress: (p: ImportStore['progress']) => void;
  patchDraft: (patch: Partial<ReconstructionDraft>) => void;
}

export const useImportStore = create<ImportStore>((set, get) => ({
  draft: null,
  selected: null,
  progress: null,
  setDraft: (draft) => set({ draft, selected: null }),
  select: (selected) => set({ selected }),
  updateWall: (id, patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, walls: d.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) } });
  },
  updateOpening: (id, patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, openings: d.openings.map((o) => (o.id === id ? { ...o, ...patch } : o)) } });
  },
  updateRoom: (id, patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, rooms: d.rooms.map((r) => (r.id === id ? { ...r, ...patch } : r)) } });
  },
  removeElement: (type, id) => {
    const d = get().draft;
    if (!d) return;
    if (type === 'wall') set({ draft: { ...d, walls: d.walls.filter((w) => w.id !== id), openings: d.openings.map((o) => (o.wallId === id ? { ...o, wallId: undefined } : o)) } });
    if (type === 'opening') set({ draft: { ...d, openings: d.openings.filter((o) => o.id !== id) } });
    if (type === 'room') set({ draft: { ...d, rooms: d.rooms.filter((r) => r.id !== id) } });
    if (get().selected?.id === id) set({ selected: null });
  },
  setAllAccepted: (accepted) => {
    const d = get().draft;
    if (!d) return;
    set({
      draft: {
        ...d,
        walls: d.walls.map((w) => ({ ...w, accepted })),
        openings: d.openings.map((o) => ({ ...o, accepted })),
        rooms: d.rooms.map((r) => ({ ...r, accepted })),
      },
    });
  },
  setProgress: (progress) => set({ progress }),
  patchDraft: (patch) => {
    const d = get().draft;
    if (d) set({ draft: { ...d, ...patch } });
  },
}));

/** In-memory analysis of the current underlay source (not persisted; recomputable). */
export interface SourceAnalysis {
  imageAssetId: string;
  kind: 'vector' | 'raster' | 'mixed' | 'unknown';
  segments: import('./pdf').PdfSegment[];
  texts: { str: string; x: number; y: number }[];
}

export const useSourceAnalysis = create<{ analysis: SourceAnalysis | null; set: (a: SourceAnalysis | null) => void }>((set) => ({
  analysis: null,
  set: (analysis) => set({ analysis }),
}));
