/**
 * Filters mouse-look deltas in the walkthrough (#142).
 *
 * Browsers occasionally report a single, huge `movementX`/`movementY` under pointer lock
 * (Chromium: right after the lock is (re)gained, when the hidden cursor crosses a window or
 * monitor edge, or on high-DPI/acceleration glitches). At the default look speed a 1400 px
 * spike turns the view by ~180°. Real mouse motion arrives in many small events, so a single
 * event that is both large in absolute terms and far above the recent motion is dropped.
 */

/** Events below this size (px) are always accepted, whatever came before. */
export const LOOK_SPIKE_MIN = 200;
/** An event larger than this multiple of the recent average motion is treated as a spike. */
export const LOOK_SPIKE_FACTOR = 6;
/** Floor for the recent average (px), so a fast move after a pause is not mistaken for a spike. */
const AVERAGE_FLOOR = 25;
/** The first event after the lock is gained is dropped when larger than this (px). */
export const LOOK_AFTER_LOCK_MAX = 60;
/** Hard limit per event (px); nothing a hand does in one event comes close. */
export const LOOK_MAX_STEP = 600;

export interface LookFilter {
  /** Delta to apply for one mouse event, or null when the event is dropped. */
  next(dx: number, dy: number): [number, number] | null;
  /** Called when pointer lock is gained: a large first event afterwards is ignored. */
  reset(): void;
}

export function createLookFilter(): LookFilter {
  let average = 0;
  let skipNext = false;
  // a spike is a single event; two large events in a row are a real fast move
  let droppedLast = false;
  return {
    next(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
      const size = Math.hypot(dx, dy);
      if (size === 0) return [0, 0];
      if (skipNext) {
        // the first event after locking can carry the jump from the old cursor position
        skipNext = false;
        if (size > LOOK_AFTER_LOCK_MAX) return null;
      }
      if (size > LOOK_MAX_STEP) return null;
      const recent = Math.max(average, AVERAGE_FLOOR);
      if (size > LOOK_SPIKE_MIN && size > recent * LOOK_SPIKE_FACTOR && !droppedLast) {
        droppedLast = true;
        return null;
      }
      droppedLast = false;
      average = average * 0.8 + size * 0.2;
      return [dx, dy];
    },
    reset() {
      average = 0;
      skipNext = true;
      droppedLast = false;
    },
  };
}
