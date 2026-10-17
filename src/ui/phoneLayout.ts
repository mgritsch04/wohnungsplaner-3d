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

/**
 * Touch screen without a fine pointer (phone, tablet) – #164. Decides about touch-only helpers
 * (stick for walking, no text selection); a PC with mouse is never affected.
 */
export const TOUCH_QUERY = '(pointer: coarse) and (hover: none)';

function touchQuery(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(TOUCH_QUERY) : null;
}

export function isTouchUi(): boolean {
  return isPhoneLayout() || (touchQuery()?.matches ?? false);
}

function subscribeTouch(onChange: () => void): () => void {
  const a = mediaQuery();
  const b = touchQuery();
  a?.addEventListener('change', onChange);
  b?.addEventListener('change', onChange);
  return () => {
    a?.removeEventListener('change', onChange);
    b?.removeEventListener('change', onChange);
  };
}

export function useTouchUi(): boolean {
  return useSyncExternalStore(subscribeTouch, isTouchUi, () => false);
}

/** Fields where text may still be selected and edited on a touch screen. */
export function isEditableTarget(t: EventTarget | null): boolean {
  const el = t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
  return !!el?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
}
