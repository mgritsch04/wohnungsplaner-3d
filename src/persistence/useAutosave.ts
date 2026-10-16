import { useCallback, useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { saveProject } from './projects';

export type SaveState = 'saved' | 'pending' | 'saving' | 'error';

export interface AutosaveStatus {
  state: SaveState;
  /** German, user-facing reason of the last failed save (null when saving works) */
  error: string | null;
  /** Try to save the current project again right now. */
  retry: () => void;
}

/** Plain-language reason for a failed IndexedDB write. */
export function describeSaveError(e: unknown): string {
  const name = (e as { name?: string } | null)?.name ?? '';
  if (name === 'QuotaExceededError') return 'Der Speicherplatz des Browsers für diese Seite ist voll.';
  if (name === 'InvalidStateError' || name === 'SecurityError' || name === 'UnknownError')
    return 'Der Browser erlaubt hier kein Speichern (z. B. privates Fenster oder blockierte Website-Daten).';
  const msg = e instanceof Error ? e.message : String(e);
  return `Unbekannter Fehler (${msg.slice(0, 120)}).`;
}

/**
 * Debounced autosave of the current project to IndexedDB after each committed
 * change. Transient drag updates are not saved until the drag is committed.
 */
export function useAutosave(enabled: boolean, delayMs = 800): AutosaveStatus {
  const revision = useProjectStore((s) => s.revision);
  const [state, setState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const save = useCallback(() => {
    const { project, txBase } = useProjectStore.getState();
    setState('saving');
    saveProject(txBase ?? project)
      .then(() => {
        setState('saved');
        setError(null);
      })
      .catch((e) => {
        console.error('Autosave fehlgeschlagen', e);
        setState('error');
        setError(describeSaveError(e));
      });
  }, []);
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
    timer.current = setTimeout(save, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [revision, enabled, delayMs, save]);

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

  return { state, error, retry: save };
}
