import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { clampSplit, SPLIT_DEFAULT, SPLIT_KEY_STEP, SPLIT_MIN_PX } from './splitPreference';

/**
 * Trennlinie zwischen 2D und 3D (#368): ziehen (Maus/Touch), Pfeiltasten, Doppelklick = 50/50.
 * `ratio` ist der Anteil der 2D-Ansicht an der Breite des Arbeitsbereichs.
 */
export function SplitDivider({ ratio, onRatio }: { ratio: number; onRatio: (r: number) => void }) {
  const drag = useRef<{ id: number; left: number; width: number } | null>(null);
  const totalOf = (el: HTMLElement) => el.parentElement?.getBoundingClientRect().width ?? 0;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const parent = e.currentTarget.parentElement;
    if (!parent || e.button > 0) return;
    const r = parent.getBoundingClientRect();
    drag.current = { id: e.pointerId, left: r.left, width: r.width };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    onRatio(clampSplit((e.clientX - d.left) / d.width, d.width));
  };
  const end = () => (drag.current = null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const total = totalOf(e.currentTarget);
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = ratio - SPLIT_KEY_STEP;
    else if (e.key === 'ArrowRight') next = ratio + SPLIT_KEY_STEP;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 1;
    else if (e.key === 'Enter') next = SPLIT_DEFAULT;
    if (next === null) return;
    e.preventDefault();
    onRatio(clampSplit(next, total));
  };

  return (
    <div
      className="split-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Trennlinie zwischen 2D- und 3D-Ansicht"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuetext={`2D ${Math.round(ratio * 100)} %, 3D ${100 - Math.round(ratio * 100)} %`}
      title={`Ziehen verändert die Breiten (mindestens ${SPLIT_MIN_PX} px), Doppelklick: 50/50`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onRatio(SPLIT_DEFAULT)}
      onKeyDown={onKeyDown}
    />
  );
}
