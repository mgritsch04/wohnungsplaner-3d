import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { saveProject } from './projects';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

/**
 * Debounced autosave of the current project to IndexedDB after each committed
 * change. Transient drag updates are not saved until the drag is committed.
 */
export function useAutosave(enabled: boolean, delayMs = 800): SaveState {
  const revision = useProjectStore((s) => s.revision);
  const [state, setState] = useState<SaveState>('saved');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!enabled) return;
    if (first.current) {
      first.current = false;
      return;
    }
    setState('pending');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { project, txBase } = useProjectStore.getState();
      setState('saving');
      saveProject(txBase ?? project)
        .then(() => setState('saved'))
        .catch((e) => {
          console.error('Autosave fehlgeschlagen', e);
          setState('error');
        });
    }, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [revision, enabled, delayMs]);

  // flush on page hide
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      const { project, txBase } = useProjectStore.getState();
      void saveProject(txBase ?? project);
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [enabled]);

  return state;
}
