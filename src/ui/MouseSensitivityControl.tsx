import { useProjectStore } from '../store/projectStore';

const MIN = 0.2;
const MAX = 3;

/** Mouse sensitivity for looking around (Begehen) and orbiting (Übersicht). Dragging = one undo step. */
export function MouseSensitivityControl() {
  const value = useProjectStore((s) => s.project.settings.mouseSensitivity);
  const st = useProjectStore.getState;
  const set = (v: number, transient: boolean) => {
    const fn = (d: { settings: { mouseSensitivity: number } }) => void (d.settings.mouseSensitivity = Math.max(MIN, Math.min(MAX, v)));
    if (transient) st().updateTransient(fn);
    else st().apply(fn);
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor="mouse-sensitivity">
        Mausempfindlichkeit {value.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×
      </label>
      <div className="field-row">
        <input
          id="mouse-sensitivity"
          type="range"
          min={MIN}
          max={MAX}
          step={0.05}
          value={value}
          aria-label="Mausempfindlichkeit"
          onPointerDown={() => st().beginTransaction()}
          onPointerUp={() => st().commitTransaction()}
          onBlur={() => st().commitTransaction()}
          onChange={(e) => set(Number(e.target.value), !!st().txBase)}
        />
        <button type="button" onClick={() => set(1, false)} disabled={value === 1} title="Standardwert (1,00×)">
          Standard
        </button>
      </div>
      <p className="muted small">Wirkt beim Umsehen im Begehen-Modus und beim Drehen der Übersicht. 1,00× = bisheriges Verhalten.</p>
    </div>
  );
}
