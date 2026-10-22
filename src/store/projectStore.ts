import { create } from 'zustand';
import type { Project } from '../model/schema';
import { createSampleProject } from '../model/sample';
import { shareUnchanged } from './structuralShare';

const HISTORY_LIMIT = 100;

export interface ProjectStore {
  project: Project;
  past: Project[];
  future: Project[];
  /** Snapshot taken when a transient (drag) transaction started. */
  txBase: Project | null;
  /** Increments on every committed change (used by autosave). */
  revision: number;
  /** Apply an undoable change. The callback mutates a fresh draft. */
  apply: (fn: (draft: Project) => void) => void;
  /**
   * Apply a change that is no undo step of its own (switching the storey, #54): undo and redo
   * still restore whole states, including the storey that was active then.
   */
  applyWithoutHistory: (fn: (draft: Project) => void) => void;
  /** Start a drag-like interaction: subsequent transient updates collapse into one undo step. */
  beginTransaction: () => void;
  updateTransient: (fn: (draft: Project) => void) => void;
  commitTransaction: () => void;
  cancelTransaction: () => void;
  undo: () => void;
  redo: () => void;
  /** Replace the whole project (load/import). */
  load: (project: Project, keepHistory?: boolean) => void;
}

function produce(base: Project, fn: (draft: Project) => void): Project {
  const draft = structuredClone(base);
  fn(draft);
  draft.updatedAt = new Date().toISOString();
  // untouched walls, rooms, furniture … stay the same objects, so the views skip them (#231)
  return shareUnchanged(base, draft);
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: createSampleProject(),
  past: [],
  future: [],
  txBase: null,
  revision: 0,
  apply: (fn) => {
    const { project, past, txBase, revision } = get();
    if (txBase) {
      // inside a transaction, behave like a transient update
      set({ project: produce(project, fn) });
      return;
    }
    set({
      project: produce(project, fn),
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      revision: revision + 1,
    });
  },
  applyWithoutHistory: (fn) => {
    const { project, txBase, revision } = get();
    if (txBase) return;
    set({ project: produce(project, fn), revision: revision + 1 });
  },
  beginTransaction: () => {
    if (!get().txBase) set({ txBase: get().project });
  },
  updateTransient: (fn) => {
    set({ project: produce(get().project, fn) });
  },
  commitTransaction: () => {
    const { txBase, project, past, revision } = get();
    if (!txBase) return;
    if (txBase === project) {
      set({ txBase: null });
      return;
    }
    set({ txBase: null, past: [...past, txBase].slice(-HISTORY_LIMIT), future: [], revision: revision + 1 });
  },
  cancelTransaction: () => {
    const { txBase } = get();
    if (txBase) set({ project: txBase, txBase: null });
  },
  undo: () => {
    const { past, project, future, revision, txBase } = get();
    if (txBase || past.length === 0) return;
    set({ project: past[past.length - 1], past: past.slice(0, -1), future: [project, ...future], revision: revision + 1 });
  },
  redo: () => {
    const { past, project, future, revision, txBase } = get();
    if (txBase || future.length === 0) return;
    set({ project: future[0], future: future.slice(1), past: [...past, project], revision: revision + 1 });
  },
  load: (project, keepHistory = false) => {
    const { past, revision } = get();
    set({
      project,
      past: keepHistory ? [...past, get().project].slice(-HISTORY_LIMIT) : [],
      future: [],
      txBase: null,
      revision: revision + 1,
    });
  },
}));

/** Convenience accessor for non-React code. */
export const projectActions = () => useProjectStore.getState();
