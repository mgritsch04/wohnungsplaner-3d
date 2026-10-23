import { Section } from '../ui/fields';
import { useDayStore } from './dayReplay';
import { summarizeDay, type FindingKind } from './dayRoutine';
import { formatSimHour } from './simulation';
import css from './SmartHomePanel.module.css';

const KIND_LABEL: Record<FindingKind, string> = {
  never: 'Licht nie',
  late: 'Licht zu spät',
  cutoff: 'Licht zu früh aus',
  bright: 'Nachts hell',
};

/**
 * Day routine (#359): a virtual person walks a typical day through the flat; the result lists
 * where lights come on too late or never and where it stays needlessly bright at night.
 */
export function DayRoutineSection({ hasDevices }: { hasDevices: boolean }) {
  const { result, playing, t, run, play, stop, clear } = useDayStore();
  const start = () => {
    if (run().ok) play();
  };
  return (
    <Section title="Tagesablauf prüfen">
      <p className="muted small">
        Eine virtuelle Person läuft einen typischen Tag durch die Wohnung (Aufstehen, Bad, Küche, Arbeiten, Abend, Nacht) und löst deine Melder aus. Annahmen: Gehtempo 1,2 m/s, im Schlaf bewegt sich niemand, sonst kurze Bewegung alle 90 s. Die Räume erkennt der Plan an ihrem Namen (Schlafzimmer, Bad, Küche, Wohnzimmer, Arbeitszimmer).
      </p>
      <div className="btn-row">
        <button className="primary" onClick={start} disabled={!hasDevices} data-testid="day-run">
          Tagesablauf starten
        </button>
        {result?.ok && (
          <button onClick={playing ? stop : () => play()} data-testid="day-play">
            {playing ? 'Wiedergabe stoppen' : 'Noch einmal abspielen'}
          </button>
        )}
        {result && (
          <button onClick={clear} data-testid="day-clear">
            Zurücksetzen
          </button>
        )}
      </div>
      {result && !result.ok && (
        <p className="small" role="alert" data-testid="day-error">
          {result.reason}
        </p>
      )}
      {result?.ok && (
        <>
          {(playing || t > 0) && (
            <p className="small" data-testid="day-clock">
              {formatSimHour((t / 3600) % 24)} · {result.stations[positionStation(result, t)]?.label}
            </p>
          )}
          <p className="small" data-testid="day-summary">
            <strong>Auswertung:</strong> {summarizeDay(result)}
          </p>
          {result.findings.length > 0 && (
            <ol className={css.log} data-testid="day-findings">
              {result.findings.map((f, i) => (
                <li key={`${f.kind}-${f.roomId}-${i}`}>
                  <button className={css.timeLink} onClick={() => play(Math.max(0, f.hour - 0.1))} title="Ab hier abspielen">
                    {formatSimHour(f.hour)}
                  </button>{' '}
                  <strong>{KIND_LABEL[f.kind]}:</strong> {f.text}
                </li>
              ))}
            </ol>
          )}
          {result.unrated.length > 0 && <p className="muted small">Nicht bewertet (keine smarte Lampe): {result.unrated.join(', ')}.</p>}
        </>
      )}
    </Section>
  );
}

function positionStation(r: { segments: { t0: number; t1: number; station: number }[] }, t: number) {
  return (r.segments.find((s) => t < s.t1) ?? r.segments[r.segments.length - 1]).station;
}
