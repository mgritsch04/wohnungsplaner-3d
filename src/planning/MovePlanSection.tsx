import { useEffect, useState } from 'react';
import { buildMovePlan, type FitStatus, type MovePlan } from '../model/movePlan';
import type { Project } from '../model/schema';
import { NumberField, Section } from '../ui/fields';
import { setMoveAccess, setMoveDone } from './planning';

const STATUS_LABEL: Record<FitStatus, string> = { ok: 'passt', tight: 'knapp', no: 'passt nicht', unknown: 'nicht geprüft' };
const STATUS_MARK: Record<FitStatus, string> = { ok: '✓', tight: '⚠', no: '✕', unknown: '?' };

/** Moving day: building access sizes, order of carrying in/setting up and fit warnings per piece (#487). */
export function MovePlanSection({ project }: { project: Project }) {
  const [plan, setPlan] = useState<MovePlan | null>(null);
  const a = project.moveAccess ?? {};
  const done = new Set(project.moveDone ?? []);

  // a changed plan or changed measurements make the calculated list stale
  useEffect(() => {
    setPlan(null);
  }, [project.furniture, project.openings, project.walls, project.moveAccess, project.levels, project.activeLevelId]);

  const num = (label: string, key: keyof typeof a, title: string) => (
    <NumberField label={label} value={a[key] ?? 0} factor={100} unit="cm" digits={0} min={0} max={1000} title={title} onChange={(v) => setMoveAccess(key, v)} />
  );
  let lastGroup = '';
  return (
    <Section
      title="Umzug: Aufbauplan"
      actions={
        <button type="button" data-testid="moveplan-calc" onClick={() => setPlan(buildMovePlan(project))} title="Berechnet Reihenfolge und Maßprüfung für alle Möbel">
          Berechnen
        </button>
      }
    >
      <details>
        <summary className="small">Maße des Hauses (Treppenhaus, Aufzug)</summary>
        <p className="muted small">0 = nicht gemessen. Gemessen wird die lichte Weite an der engsten Stelle.</p>
        {num('Treppenhaus Breite', 'stairWidth', 'Lichte Breite der Treppenläufe an der engsten Stelle')}
        {num('Treppenhaus Höhe', 'stairHeadroom', 'Lichte Durchgangshöhe, z. B. unter Podesten')}
        {num('Kurvenlänge', 'turnLength', 'Längstes Teil, das um die Podeste passt – im Zweifel die Podestdiagonale abzüglich 20 cm')}
        {num('Aufzug Breite', 'liftWidth', 'Innenmaß der Kabine')}
        {num('Aufzug Tiefe', 'liftDepth', 'Innenmaß der Kabine')}
        {num('Aufzug Höhe', 'liftHeight', 'Innenhöhe der Kabine')}
      </details>
      {!plan && <p className="muted small">„Berechnen“ legt fest, welche Möbel in welcher Reihenfolge hineingetragen und aufgebaut werden, und prüft, ob sie durch Treppenhaus und Türen passen.</p>}
      {plan && (
        <div data-testid="moveplan">
          <p className="small" data-testid="moveplan-summary" role="status">
            {plan.steps.length === 0
              ? 'Keine Möbel zum Einziehen im Plan.'
              : `${plan.steps.length} Möbel, ${plan.warnings === 0 ? 'keine Warnungen' : `${plan.warnings} Warnung${plan.warnings === 1 ? '' : 'en'}`}, ${plan.steps.filter((s) => done.has(s.furnitureId)).length} aufgebaut.`}
          </p>
          {plan.accessMissing && <p className="warn-text small">Treppenhaus- oder Aufzugmaße fehlen: das Haus wurde nicht geprüft, nur Türen und Gänge der Wohnung.</p>}
          {plan.noEntrance && <p className="warn-text small">Keine Eingangstür im Plan (Tür, die von einem Raum nach außen führt): Türen wurden nicht geprüft.</p>}
          <ol className="plain-list">
            {plan.steps.map((s) => {
              const group = `${s.levelId}|${s.roomName}`;
              const head = group !== lastGroup && (plan.steps.some((x) => x.levelId !== plan.steps[0].levelId) ? `${s.levelName} · ${s.roomName}` : s.roomName);
              lastGroup = group;
              return (
                <li key={s.furnitureId} data-testid="moveplan-step" data-status={s.status} style={{ listStyle: 'none' }}>
                  {head && <h4 style={{ margin: '8px 0 2px' }}>{head}</h4>}
                  <label className="check">
                    <input type="checkbox" aria-label={`${s.name} aufgebaut`} checked={done.has(s.furnitureId)} onChange={(e) => setMoveDone(s.furnitureId, e.target.checked)} />
                    <span style={done.has(s.furnitureId) ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>
                      {s.order}. {s.name}
                      {s.quantity > 1 ? ` ×${s.quantity}` : ''}
                    </span>
                  </label>{' '}
                  <span className={s.status === 'ok' ? 'muted small' : 'warn-text small'} title={STATUS_LABEL[s.status]}>
                    {STATUS_MARK[s.status]} {STATUS_LABEL[s.status]}
                    {s.assembly ? ' · Aufbau nötig' : ''}
                    {s.phase !== 'movein' ? ` · ${s.phase === 'month2' ? 'Monat 2' : 'später'}` : ''}
                  </span>
                  {s.pieces.map((pc, i) => (
                    <div key={i} className="muted small" style={{ marginLeft: 24 }}>
                      {s.pieces.length > 1 && <strong>{pc.label}: </strong>}
                      {pc.messages.length ? pc.messages.join(' ') : s.pieces.length > 1 ? STATUS_LABEL[pc.status] : null}
                    </div>
                  ))}
                </li>
              );
            })}
          </ol>
          <p className="muted small">Schätzung: Reihenfolge nach Entfernung vom Eingang und Größe; Drehen um Ecken wird nicht simuliert. Pakete erfasst du am Möbel unter „Pakete“.</p>
        </div>
      )}
    </Section>
  );
}
