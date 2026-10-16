import { useSyncExternalStore } from 'react';

/**
 * Handy-Ansicht (#129, Backlog-Zeile 89 in docs/IDEAS.md): schmale Bildschirme (hochkant) und niedrige im Querformat.
 * Die einzige Stelle für die Schwelle – das CSS hängt an der Klasse `.app.phone`, nicht an
 * einer eigenen Media-Query. Ein PC-Fenster mit normaler Größe ist nie betroffen.
 */
export const PHONE_QUERY = '(max-width: 700px), (max-height: 500px) and (max-width: 1000px)';

export type PhoneSheet = 'left' | 'right' | null;

function mediaQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY) : null;
}

export function isPhoneLayout(): boolean {
  return mediaQuery()?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  const mq = mediaQuery();
  mq?.addEventListener('change', onChange);
  return () => mq?.removeEventListener('change', onChange);
}

export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhoneLayout, () => false);
}
