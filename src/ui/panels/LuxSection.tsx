import { useMemo } from 'react';
import { derivePlan } from '../../model/derived';
import {
  DARK_SHARE,
  DEFAULT_LUMEN,
  INDIRECT_SHARE,
  LUMEN_METHOD_FACTOR,
  LUX_STEPS,
  MODE_LABEL,
  OVERCAST_LUX,
  SURFACE_KIND_LABEL,
  SURFACE_STATUS_LABEL,
  computeLux,
  roomAdvice,
  surfaceAdvice,
  type LuxMode,
} from '../../model/lux';
import { useProjectStore } from '../../store/projectStore';
import { Badge, CheckField, Section, SelectField } from '../fields';
import { useLuxStore } from '../luxStore';

const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Rough light map in lux per room with guide values and warnings for dark work surfaces (#360). */
export function LuxSection() {
  const project = useProjectStore((s) => s.project);
  const { on, mode, setOn, setMode } = useLuxStore();
  const result = useMemo(() => (on ? computeLux(project, derivePlan(project), mode) : null), [on, mode, project]);
  const roomName = (id: string) => project.rooms.find((r) => r.id === id)?.name || 'Raum';
  return (
    <Section title="Lichtplanung (Lux)">
      <CheckField label="Lichtkarte (Lux) im Plan anzeigen" checked={on} onChange={setOn} />
      <SelectField<LuxMode> label="Situation" value={mode} options={(Object.keys(MODE_LABEL) as LuxMode[]).map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={setMode} />
      {on && result && (
        <>
          <ul className="legend" data-testid="lux-legend" style={{ listStyle: 'none', padding: 0, margin: '4px 0', display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {LUX_STEPS.map((s) => (
              <li key={s.min} style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                <span aria-hidden style={{ width: 14, height: 14, background: s.color, opacity: 0.7, display: 'inline-block', borderRadius: 2 }} /> {s.label}
              </li>
            ))}
          </ul>
          {result.rooms.length === 0 && <p className="muted small">Noch keine Räume.</p>}
          <ul className="issues" data-testid="lux-rooms">
            {result.rooms.map((r) => {
              const advice = roomAdvice(r);
              return (
                <li key={r.roomId} data-testid="lux-room" data-room={r.name} data-lux={Math.round(r.lux)} data-lamps={r.lampCount}>
                  <strong>{r.name || 'Raum'}</strong>: typisch ca. {fmt(r.lux)} lx
                  <span className="muted"> (Richtwert {r.targetLabel} ca. {r.target} lx · {r.lampCount} {r.lampCount === 1 ? 'Lampe' : 'Lampen'}, {fmt(r.lumen)} lm{r.assumed && r.lampCount > 0 ? ', Lumen geschätzt' : ''})</span>
                  {advice && (
                    <>
                      <br />
                      <span className="small" data-testid="lux-advice">{advice}</span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {result.surfaces.length > 0 && (
            <>
              <h4 className="small">Arbeitsflächen und Leseplätze</h4>
              <ul className="issues" data-testid="lux-surfaces">
                {result.surfaces.map((s) => {
                  const advice = surfaceAdvice(s);
                  return (
                    <li key={s.id} data-testid="lux-surface" data-kind={s.kind} data-status={s.status} data-lux={Math.round(s.lux)}>
                      <Badge kind={s.status === 'ok' ? 'ok' : s.status === 'tight' ? 'warn' : 'error'}>{SURFACE_KIND_LABEL[s.kind]} {SURFACE_STATUS_LABEL[s.status]}</Badge> <strong>{s.label}</strong> in {roomName(s.roomId)}: ca. {fmt(s.lux)} lx (Richtwert {s.target} lx)
                      {advice && (
                        <>
                          <br />
                          <span className="small">{advice}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}
      <p className="small warning" data-testid="lux-hint">
        Schätzung, keine Messung. Lampenwerte ohne eigene Angabe sind typische Annahmen.
      </p>
      <details className="small">
        <summary>Wie wird gerechnet?</summary>
        <p className="muted">
          Direktes Licht jeder Lampe nach dem Abstandsgesetz (E = I·cos θ / d²), Pendel- und Tischlampen strahlen nach unten, Stehlampen und Leuchten aus dem Smart-Home-Bereich in alle Richtungen. Dazu kommt ein pauschaler Anteil reflektiertes Licht ({Math.round(INDIRECT_SHARE * 100)} % des Lichtstroms
          je m²). Eine Lampe beleuchtet nur ihren eigenen Raum, Möbel werfen keinen Schatten. Tageslicht nach dem Tageslichtquotienten-Verfahren bei bedecktem Himmel (ca. {fmt(OVERCAST_LUX)} lx draußen), nach hinten abnehmend; ohne Sonne, ohne Verschattung durch Gebäude.
        </p>
        <p className="muted">
          Lichtstrom ohne eigene Angabe: Tischlampe {DEFAULT_LUMEN['table-lamp']} lm, Stehlampe {DEFAULT_LUMEN['floor-lamp']} lm, Pendelleuchte {DEFAULT_LUMEN.pendant} lm (etwa eine 40-W- bzw. 60-W-Glühlampe in LED-Äquivalenz). Den echten Wert der Lampe im Tab „Objekt“ eintragen. Empfohlener Lichtstrom: Lumen-Verfahren, Lux · m² / {LUMEN_METHOD_FACTOR}. „Zu dunkel“ unter {Math.round(DARK_SHARE * 100)} % des
          Richtwerts, „knapp“ darüber bis zum Richtwert.
        </p>
        <p className="muted">Richtwerte sind übliche Planungswerte (z. B. Schreibtisch, Küchenarbeitsfläche und Lesen ca. 500 lx, Wohnraum ca. 100–200 lx), je nach Quelle verschieden, nur zur Orientierung.</p>
      </details>
    </Section>
  );
}
