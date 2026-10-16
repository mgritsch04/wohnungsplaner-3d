import { create } from 'zustand';

/**
 * Zoom control at the bottom of a viewport (#6): −/+ buttons, a logarithmic slider
 * and "fit". It shows and changes the same zoom as the mouse wheel / pinch, so both
 * stay in sync. `invert` is for the 3D view, where a smaller camera distance = zoom in.
 */
export function ZoomSlider({
  value,
  min,
  max,
  invert = false,
  label,
  onChange,
  onFit,
  testId,
}: {
  value: number;
  min: number;
  max: number;
  invert?: boolean;
  label: string;
  onChange: (v: number) => void;
  onFit: () => void;
  testId: string;
}) {
  const span = Math.log(max / min);
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const toT = (v: number) => {
    const t = Math.log(clamp(v) / min) / span;
    return invert ? 1 - t : t;
  };
  const fromT = (t: number) => min * Math.exp((invert ? 1 - t : t) * span);
  const t = toT(value);
  const step = (dir: 1 | -1) => onChange(fromT(Math.max(0, Math.min(1, t + dir * 0.06))));
  return (
    <div className="zoom-slider" data-testid={testId} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => step(-1)} title="Herauszoomen" aria-label={`${label}: herauszoomen`}>
        −
      </button>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(t * 1000)}
        aria-label={label}
        onChange={(e) => onChange(fromT(Number(e.target.value) / 1000))}
      />
      <button type="button" onClick={() => step(1)} title="Hineinzoomen" aria-label={`${label}: hineinzoomen`}>
        +
      </button>
      <button type="button" onClick={onFit} title="Alles zeigen" aria-label={`${label}: alles zeigen`}>
        ⤢
      </button>
    </div>
  );
}

/**
 * Bridge between the 3D orbit camera (inside the canvas) and the zoom slider (outside):
 * the camera reports its distance, the slider asks it to move. Kept out of React state
 * of the scene so orbiting does not re-render the 3D view.
 */
export const useOrbitZoom = create<{
  distance: number | null;
  setDistance: (d: number) => void;
  apply: ((d: number) => void) | null;
  setApply: (fn: ((d: number) => void) | null) => void;
}>((set, get) => ({
  distance: null,
  setDistance: (d) => {
    const cur = get().distance;
    if (cur === null || Math.abs(d - cur) / cur > 0.005) set({ distance: d });
  },
  apply: null,
  setApply: (apply) => set({ apply }),
}));
