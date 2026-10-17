import { useEffect, useRef, useState } from 'react';
import { useUiStore } from '../store/uiStore';
import { setTouchWalk, stickVector, walkCommands } from './touchWalk';

const RADIUS = 48;

/**
 * Walking on a phone (#164): a stick at the bottom left moves (forward/back/sideways, the
 * further out the faster); dragging anywhere else in the view looks around, a tap selects
 * furniture or opens a door/window (WalkControls). Buttons for crouching and carrying.
 */
export function TouchWalkPad() {
  const [thumb, setThumb] = useState<{ x: number; y: number } | null>(null);
  const active = useRef<{ id: number; cx: number; cy: number } | null>(null);
  const ducking = useUiStore((s) => s.walkDuck);
  const sitting = useUiStore((s) => s.walkSit);
  const carrying = useUiStore((s) => s.walkCarry !== null);
  // leaving the walkthrough (or the view) must not keep walking
  useEffect(() => () => setTouchWalk(0, 0), []);

  const move = (e: React.PointerEvent, a: { cx: number; cy: number }) => {
    const v = stickVector(e.clientX - a.cx, e.clientY - a.cy, RADIUS);
    setTouchWalk(v.x, v.z);
    setThumb({ x: v.x * RADIUS, y: -v.z * RADIUS });
  };
  const end = () => {
    active.current = null;
    setTouchWalk(0, 0);
    setThumb(null);
  };

  return (
    <div className="touch-walk" onPointerDown={(e) => e.stopPropagation()}>
      <div
        className="touch-stick"
        role="application"
        aria-label="Gehen: Stick in die gewünschte Richtung ziehen"
        data-testid="touch-stick"
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          active.current = { id: e.pointerId, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
          e.currentTarget.setPointerCapture?.(e.pointerId);
          move(e, active.current);
        }}
        onPointerMove={(e) => {
          if (active.current?.id === e.pointerId) move(e, active.current);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      >
        <span className="touch-stick-thumb" style={thumb ? { transform: `translate(${thumb.x}px, ${thumb.y}px)` } : undefined} />
      </div>
      <div className="touch-walk-actions">
        {!sitting && (
          <button type="button" className={ducking ? 'active' : ''} aria-pressed={ducking} onClick={() => useUiStore.getState().toggleWalkDuck()}>
            Ducken
          </button>
        )}
        <button type="button" className={carrying ? 'active' : ''} aria-pressed={carrying} onClick={() => walkCommands.toggleCarry?.()}>
          {carrying ? 'Absetzen' : 'Tragen'}
        </button>
      </div>
    </div>
  );
}
