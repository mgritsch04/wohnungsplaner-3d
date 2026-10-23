import { CritiquePanel } from '../../assistant/CritiquePanel';
import { CHECK_CATEGORY_LABEL, TRAFFIC_LABEL, type CheckSeverity } from '../../model/planCheck';
import { useProjectStore } from '../../store/projectStore';
import { jumpToCheckItem, startPlanCheck } from '../checkActions';
import { useCheckStore } from '../checkStore';
import { Badge, Section } from '../fields';

const SEVERITY_LABEL: Record<CheckSeverity, string> = { error: 'Problem', warn: 'Prüfen', info: 'Hinweis' };
const SEVERITY_BADGE: Record<CheckSeverity, 'error' | 'warn' | 'info'> = { error: 'error', warn: 'warn', info: 'info' };
const TRAFFIC_COLOR = { green: '#15803d', yellow: '#d97706', red: '#dc2626' } as const;

/** Wohnungs-Check (#357): all plan checks as one sorted list with a traffic light; click = jump to the place. */
export function CheckPanel() {
  const result = useCheckStore((s) => s.result);
  const focus = useCheckStore((s) => s.focus);
  const project = useProjectStore((s) => s.project);
  // the result is a snapshot: tell the user when the plan changed since the run
  const stale = result !== null && result.planRef !== project;

  return (
    <div className="panel-scroll">
      <Section title="Wohnungs-Check">
        <p className="muted small">Prüft den ganzen Plan auf einmal: Kollisionen, Türaufschlag, Engstellen, Laufwege, Küchendreieck, Tageslicht, WLAN, Stromkreise und Melder-Abdeckung.</p>
        <button className="primary" data-testid="check-run" onClick={startPlanCheck}>
          {result ? 'Wohnungs-Check erneut starten' : 'Wohnungs-Check starten'}
        </button>
        {result && (
          <div data-testid="check-result">
            <p data-testid="check-traffic" data-traffic={result.traffic} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, margin: '12px 0 4px' }}>
              <span aria-hidden style={{ width: 16, height: 16, borderRadius: '50%', background: TRAFFIC_COLOR[result.traffic], display: 'inline-block' }} />
              {TRAFFIC_LABEL[result.traffic]}
            </p>
            <p className="muted small">
              {result.counts.error} Probleme · {result.counts.warn} zu prüfen · {result.counts.info} Hinweise
              {stale && ' – der Plan wurde seitdem geändert, bitte erneut starten.'}
            </p>
            {result.items.length === 0 ? (
              <p className="small" data-testid="check-empty">Keine Auffälligkeiten gefunden.</p>
            ) : (
              <ul className="issues" data-testid="check-list">
                {result.items.map((it) => (
                  <li key={it.id} data-severity={it.severity} data-category={it.category}>
                    <button
                      type="button"
                      className="check-item"
                      data-testid="check-item"
                      aria-pressed={focus?.id === it.id}
                      disabled={!it.at}
                      title={it.at ? 'Zur Stelle im Plan springen' : 'Dieser Punkt hat keine Stelle im Plan'}
                      onClick={() => jumpToCheckItem(it)}
                    >
                      <Badge kind={SEVERITY_BADGE[it.severity]}>{SEVERITY_LABEL[it.severity]}</Badge> <strong>{CHECK_CATEGORY_LABEL[it.category]}:</strong> {it.title}
                      {it.detail && <span className="muted small"> {it.detail}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="muted small" data-testid="check-categories">
              {result.perCategory.map((c) => `${c.label}: ${c.checked ? (c.count ? `${c.count}` : 'in Ordnung') : 'nicht geprüft (nichts vorhanden)'}`).join(' · ')}
            </p>
          </div>
        )}
      </Section>
      <CritiquePanel />
    </div>
  );
}
