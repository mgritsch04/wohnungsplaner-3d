import { useProjectStore } from '../store/projectStore';
import { TIME_PRESETS } from '../view3d/lighting';

const fmt = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

/** Time-of-day slider with presets. Dragging collapses into one undo step. */
export function TimeOfDayControl({ compact = false }: { compact?: boolean }) {
  const hour = useProjectStore((s) => s.project.settings.timeOfDay);
  const st = useProjectStore.getState;
  const set = (h: number, transient: boolean) => {
    const fn = (d: { settings: { timeOfDay: number } }) => void (d.settings.timeOfDay = Math.max(0, Math.min(24, h)));
    if (transient) st().updateTransient(fn);
    else st().apply(fn);
  };
  return (
    <div className={`time-control ${compact ? 'compact' : ''}`} title="Tageszeit für Licht und Schatten (Realismusmodus)">
      <span className="time-label" aria-hidden>
        {hour >= 6 && hour < 20 ? '☀' : '☾'} {fmt(hour)}
      </span>
      <input
        type="range"
        min={0}
        max={24}
        step={0.25}
        value={hour}
        aria-label="Tageszeit"
        onPointerDown={() => st().beginTransaction()}
        onPointerUp={() => st().commitTransaction()}
        onBlur={() => st().commitTransaction()}
        onChange={(e) => set(Number(e.target.value), !!st().txBase)}
      />
      <select
        value=""
        aria-label="Tageszeit-Voreinstellung"
        onChange={(e) => {
          if (e.target.value) set(Number(e.target.value), false);
        }}
      >
        <option value="">Zeit…</option>
        {TIME_PRESETS.map((p) => (
          <option key={p.label} value={p.hour}>
            {p.label} ({fmt(p.hour)})
          </option>
        ))}
      </select>
    </div>
  );
}
