/*
 * Merkt sich, wann die 2D|3D-Trennlinie zuletzt bewegt wurde (#368): Ändert sich die Breite der
 * 2D-Ansicht kurz danach, zoomt sie heraus statt den Plan wegzuschieben (Fenstergrößen bleiben unberührt).
 */
const WINDOW_MS = 300;
let lastChange = -Infinity;

export function markSplitChange(now = performance.now()): void {
  lastChange = now;
}

export function isSplitChangeRecent(now = performance.now()): boolean {
  return now - lastChange <= WINDOW_MS;
}

/** Zoom, der die sichtbare Weltbreite bei neuer Pixelbreite gleich hält (Mittelpunkt bleibt). */
export function zoomForWidth(zoom: number, oldWidth: number, newWidth: number, min: number, max: number): number {
  if (oldWidth < 10 || newWidth < 10) return zoom;
  return Math.max(min, Math.min(max, (zoom * newWidth) / oldWidth));
}
