import { useMemo } from 'react';
import { COMPASS, DAYLIGHT_LABEL, compassName, compassOf, computeDaylight, sunSpanLabel } from '../../model/daylight';
import { derivePlan } from '../../model/derived';
import { useProjectStore } from '../../store/projectStore';
import { NumberField, Section } from '../fields';

/** Compass direction of the plan's upper edge (#69, #93) plus the rough daylight estimate per room and sun hint per balcony. */
export function DaylightSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const north = project.settings.northDirection;
  const daylight = useMemo(() => computeDaylight(project, derivePlan(project)), [project]);
  const hasRooms = daylight.rooms.length + daylight.outdoor.length > 0;

  return (
    <Section title="Tageslicht & Himmelsrichtung">
      <NumberField
        label="Oben im Plan ist"
        value={north}
        digits={0}
        unit="°"
        min={0}
        max={359}
        step={5}
        title="Kompassrichtung der oberen Plankante in Grad: 0 = Norden, 90 = Osten, 180 = Süden, 270 = Westen"
        onChange={(v) => apply((d) => void (d.settings.northDirection = Math.round(v) % 360))}
      />
      <div className="button-row" role="group" aria-label="Himmelsrichtung oben im Plan">
        {[0, 90, 180, 270].map((deg) => (
          <button key={deg} className={north === deg ? 'active' : undefined} onClick={() => apply((d) => void (d.settings.northDirection = deg))}>
            {compassName(COMPASS[deg / 45])}
          </button>
        ))}
      </div>
      <p className="muted small">Oben im Plan liegt {compassName(compassOf(north))} ({north}°).</p>
      {!hasRooms ? (
        <p className="muted small">Noch keine Räume.</p>
      ) : (
        <ul className="issues" data-testid="daylight-list">
          {daylight.rooms.map((r) => (
            <li key={r.roomId}>
              <strong>{r.name || 'Raum'}</strong>: {DAYLIGHT_LABEL[r.level]}
              {r.directions.length > 0 && <> · Fenster nach {r.directions.map((d) => compassName(d)).join(', ')}</>}
              {r.glassArea > 0 && <> · Sonne {sunSpanLabel(r.sunHours)}</>}
            </li>
          ))}
          {daylight.outdoor.map((o) => (
            <li key={o.roomId}>
              <strong>{o.name || 'Außenbereich'}</strong>: {o.facing ? `zeigt nach ${compassName(o.facing)} · Sonne ${sunSpanLabel(o.sunHours)}` : 'Ausrichtung nicht erkennbar'}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Grobe Schätzung nach Himmelsrichtung und Fensterfläche (Sommerhalbjahr). Keine Lichtberechnung, keine Verschattung.</p>
    </Section>
  );
}
