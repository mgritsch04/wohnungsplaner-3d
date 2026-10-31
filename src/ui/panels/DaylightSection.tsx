import { useMemo, useState } from 'react';
import { COMPASS, DAYLIGHT_LABEL, compassName, compassOf, computeDaylight, sunSpanLabel } from '../../model/daylight';
import { derivePlan } from '../../model/derived';
import { useProjectStore } from '../../store/projectStore';
import { NumberField, Section } from '../fields';
import { SEASONS, SEASON_LABEL, formatClock, roomSun, roomSunLabel, sunPosition, type Season } from '../../model/sunPath';
import { CompassRose, northSideLabel } from '../CompassRose';

/** Compass direction of the plan's upper edge (#69, #93) plus the rough daylight estimate per room and sun hint per balcony. */
export function DaylightSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const north = project.settings.northDirection;
  const daylight = useMemo(() => computeDaylight(project, derivePlan(project)), [project]);
  const [season, setSeason] = useState<Season>('equinox');
  const hour = project.settings.timeOfDay;
  const sun = sunPosition(season, hour);
  const hasRooms = daylight.rooms.length + daylight.outdoor.length > 0;

  return (
    <Section title="Tageslicht & Himmelsrichtung">
      <div className="compass-row">
        <CompassRose north={north} testId="compass-panel" />
        <p className="small" data-testid="north-summary">
          <strong>Obere Plankante zeigt nach {compassName(compassOf(north))}</strong> ({north}°).
          <br />
          Norden liegt im Plan {northSideLabel(north)}.
        </p>
      </div>
      <div className="button-row" role="group" aria-label="Obere Plankante zeigt nach">
        {COMPASS.map((c, i) => (
          <button key={c} className={north === i * 45 ? 'active' : undefined} title={compassName(c)} onClick={() => apply((d) => void (d.settings.northDirection = i * 45))}>
            {c}
          </button>
        ))}
      </div>
      <NumberField
        label="Oder genau (Grad)"
        value={north}
        digits={0}
        unit="°"
        min={0}
        max={359}
        step={5}
        title="Kompassrichtung der oberen Plankante in Grad: 0 = Norden, 90 = Osten, 180 = Süden, 270 = Westen"
        onChange={(v) => apply((d) => void (d.settings.northDirection = Math.round(v) % 360))}
      />
      {hasRooms && (
        <div data-testid="sun-controls">
          <div className="button-row" role="group" aria-label="Jahreszeit für den Sonnenstand">
            {SEASONS.map((x) => (
              <button key={x} className={season === x ? 'active' : undefined} onClick={() => setSeason(x)} data-testid={`season-${x}`}>
                {SEASON_LABEL[x]}
              </button>
            ))}
          </div>
          <label className="small">
            Uhrzeit {formatClock(hour)}
            <input
              type="range"
              min={5}
              max={21}
              step={0.25}
              value={Math.min(21, Math.max(5, hour))}
              aria-label="Uhrzeit für den Sonnenstand"
              data-testid="sun-hour"
              onChange={(e) => apply((d) => void (d.settings.timeOfDay = Number(e.target.value)))}
            />
          </label>
          <p className="small muted" data-testid="sun-position">
            {sun.elevation < 0 ? 'Sonne unter dem Horizont.' : `Sonne steht im ${compassName(compassOf(sun.azimuth))}, ${Math.round(sun.elevation)}° hoch.`}
          </p>
        </div>
      )}
      {!hasRooms ? (
        <p className="muted small">Noch keine Räume.</p>
      ) : (
        <ul className="issues" data-testid="daylight-list">
          {daylight.rooms.map((r) => (
            <li key={r.roomId}>
              <strong>{r.name || 'Raum'}</strong>: {DAYLIGHT_LABEL[r.level]}
              {r.directions.length > 0 && <> · Fenster nach {r.directions.map((d) => compassName(d)).join(', ')}</>}
              {r.glassArea > 0 && (() => {
                const rs = roomSun(r.windowBearings, season);
                return (
                  <>
                    <br />
                    <span data-testid={`sun-room-${r.roomId}`}>
                      {roomSunLabel(rs)} · um {formatClock(hour)}: {rs.at(hour) ? '☀ Sonne im Raum' : 'im Schatten'}
                    </span>
                  </>
                );
              })()}
            </li>
          ))}
          {daylight.outdoor.map((o) => (
            <li key={o.roomId}>
              <strong>{o.name || 'Außenbereich'}</strong>: {o.facing ? `zeigt nach ${compassName(o.facing)} · Sonne ${sunSpanLabel(o.sunHours)}` : 'Ausrichtung nicht erkennbar'}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Grobe Schätzung nach Himmelsrichtung, Fensterfläche und Sonnenbahn (Wien). Keine Lichtberechnung, keine Verschattung durch Nachbarhäuser oder Balkone.</p>
    </Section>
  );
}
