import { useEffect, useState } from 'react';
import { errorText, HIDE_CODES, loadSample, type Sample, type SampleError } from '../assistant/claude';
import { summarizePlan } from '../assistant/planSummary';
import { formatEuro } from '../model/units';
import type { Project } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { applySmartHomeSuggestion } from './suggestStore';
import { suggestSmartHome } from './suggest';
import {
  budgetOf,
  buildConceptPrompt,
  conceptByRules,
  MAX_FIELD,
  parseConceptAnswer,
  PHASES,
  roomTypeLabel,
  suggestionOf,
  type Cost,
  type Phase,
  type SmartHomeConcept,
} from './concept';
import { useConceptStore } from './conceptStore';
import '../assistant/assistant.css';

let controller: AbortController | null = null;

const price = (c: Cost) => (c.min === c.max ? formatEuro(c.min) : `${formatEuro(c.min)} – ${formatEuro(c.max)}`);

/**
 * „Smart-Home-Konzept für die ganze Wohnung“ (#375): Claude plans all rooms together on top of the
 * devices the planner places by datasheet (#225): which to take, in which order, scenes across rooms,
 * network and open questions. The app computes the budget, previews the devices in the plan and takes
 * them over in one undo step. Without Claude (no artifact, no local helper) the same concept is made by rules.
 */
export function ConceptSection({ project }: { project: Project }) {
  const [sample, setSample] = useState<Sample | null>(null);
  const [hidden, setHidden] = useState(false);
  const st = useConceptStore();
  const w = st.wishes;
  const roomTypes = useFurnishStore((s) => s.roomTypes);

  useEffect(() => {
    let live = true;
    void loadSample().then((s) => live && setSample(s));
    return () => {
      live = false;
    };
  }, []);

  const claude = !!sample && !hidden;
  const roomName = (id: string) => project.rooms.find((r) => r.id === id)?.name || 'Raum ohne Namen';

  const finish = (concept: SmartHomeConcept) => {
    const ui = useUiStore.getState();
    if (ui.viewMode === '3d') ui.setViewMode('split');
    const last = Math.max(1, ...concept.items.map((i) => i.phase)) as Phase;
    st.set({ asking: false, error: null, concept });
    useConceptStore.getState().show(last);
    if (!concept.items.length) ui.toast('Nichts zu planen – die Räume sind schon ausgestattet.', 'info');
  };

  const byRules = () => {
    controller?.abort();
    finish(conceptByRules(project, suggestSmartHome(project, undefined, roomTypes), roomTypes));
  };

  const ask = async () => {
    if (!sample || st.asking) return;
    const base = suggestSmartHome(project, undefined, roomTypes);
    if (!base.items.length) return finish(conceptByRules(project, base, roomTypes));
    const plan = summarizePlan(project, { roomTypes });
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    try {
      const raw = await sample.json(buildConceptPrompt(w, plan, base, project), { signal: ctl.signal, modelTier: 'complex' });
      finish(parseConceptAnswer(raw, { plan, project, base, roomTypes }));
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(`${errorText(e)} Das Konzept entsteht regelbasiert.`, 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort war nicht verwertbar – bitte erneut versuchen oder das Konzept ohne Claude erstellen.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const concept = st.concept;
  const upTo = st.upTo;
  const budget = concept ? budgetOf(concept, upTo) : null;
  const shown = concept ? suggestionOf(concept, upTo) : null;
  const used = concept ? PHASES.filter((p) => concept.items.some((i) => i.phase === p)) : [];
  const text = (k: 'habits' | 'wants', v: string) => st.setWishes({ [k]: v.slice(0, MAX_FIELD) });

  const take = () => {
    if (!shown) return;
    applySmartHomeSuggestion(shown);
  };

  return (
    <Section title="Konzept für die ganze Wohnung" actions={<Badge kind="info">alle Räume</Badge>}>
      <p className="muted small">
        {claude
          ? 'Claude plant alle Räume zusammen: welche Geräte, in welcher Reihenfolge, Szenen über mehrere Räume, Netz und Budget. Die Geräte stellt der Planer nach Datenblatt in den Plan, die Preise kommen aus den Datenblattrecherchen. Claude bekommt nur die Raumzusammenfassung und deine Angaben, keine Namen oder Pläne. Die Anfrage läuft über dein Claude-Konto.'
          : 'Der Planer plant alle Räume zusammen nach festen Regeln: Geräte nach Datenblatt, Reihenfolge nach Gerätetyp, Szenen nur mit vorhandenen Geräten, Netz und Budget. (Mit Claude im Artefakt oder lokal mit Claude Code kommen Begründungen und eigene Szenen dazu.)'}
      </p>
      {project.rooms.length === 0 ? (
        <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>
      ) : (
        <>
          {claude && (
            <>
              <label className="field">
                <span className="field-label">Alltag</span>
                <span className="field-input">
                  <input type="text" value={w.habits} placeholder="zwei Personen, Homeoffice, Katze" maxLength={MAX_FIELD} onChange={(e) => text('habits', e.target.value)} />
                </span>
              </label>
              <label className="field">
                <span className="field-label">Wünsche</span>
                <span className="field-input">
                  <input type="text" value={w.wants} placeholder="Licht nachts gedimmt, Fenster-Erinnerung" maxLength={MAX_FIELD} onChange={(e) => text('wants', e.target.value)} />
                </span>
              </label>
            </>
          )}
          <label className="field">
            <span className="field-label">Budget in € (0 = egal)</span>
            <span className="field-input">
              <input type="number" min={0} step={50} value={w.budget || 0} onChange={(e) => st.setWishes({ budget: Math.max(0, Number(e.target.value) || 0) })} />
            </span>
          </label>
          <div className="btn-row">
            {claude ? (
              <>
                <button className="primary" disabled={st.asking} onClick={() => void ask()} data-testid="concept-ask">
                  {st.asking ? 'Claude plant…' : concept ? 'Neu planen lassen' : 'Konzept mit Claude erstellen'}
                </button>
                {st.asking ? <button onClick={() => controller?.abort()}>Stopp</button> : <button onClick={byRules} data-testid="concept-rules">Ohne Claude</button>}
              </>
            ) : (
              <button className="primary" onClick={byRules} data-testid="concept-rules">
                Konzept erstellen
              </button>
            )}
          </div>
        </>
      )}
      {st.error && (
        <p className="warning small" role="alert">
          {st.error}
        </p>
      )}
      {concept && budget && shown && (
        <div className="assistant-card" data-testid="concept">
          <h4>Smart-Home-Konzept</h4>
          <Badge kind="info">{concept.source === 'claude' ? 'Vorschlag von Claude – bitte selbst prüfen' : 'Regelbasierter Vorschlag'}</Badge>
          {concept.summary && <p>{concept.summary}</p>}

          <h5>Umsetzung in Phasen</h5>
          <SelectField
            label="Vorschau und Übernehmen bis"
            value={String(upTo) as '1' | '2' | '3'}
            options={used.map((p) => ({ value: String(p) as '1' | '2' | '3', label: `Phase ${p}: ${concept.phases[p].title} (${concept.items.filter((i) => i.phase === p).length} Geräte)` }))}
            onChange={(v) => useConceptStore.getState().show(Number(v) as Phase)}
          />
          <ul className="assistant-list">
            {used.map((p) => (
              <li key={p} data-testid="concept-phase" data-phase={p}>
                <strong>
                  {p}. {concept.phases[p].title}
                </strong>{' '}
                – {concept.phases[p].why} <span className="muted">({concept.items.filter((i) => i.phase === p).map((i) => i.name).join(', ') || 'keine Geräte'})</span>
              </li>
            ))}
          </ul>

          <h5>Räume und Geräte</h5>
          {concept.rooms.map((r) => (
            <div key={r.roomId} data-testid="concept-room">
              <strong>{roomName(r.roomId)}</strong> <span className="muted">({roomTypeLabel(r.type)})</span>
              <p className="muted">{r.role}</p>
              <ul className="assistant-list">
                {concept.items
                  .filter((i) => i.roomId === r.roomId)
                  .map((i) => (
                    <li key={i.key} data-testid="concept-item" data-kind={i.kind} data-phase={i.phase} className={i.phase > upTo ? 'muted' : undefined}>
                      <strong>{i.name}</strong> <Badge kind="muted">Phase {i.phase}</Badge> – {i.reason}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {concept.left.length > 0 && (
            <p className="muted small" data-testid="concept-left">
              Weggelassen: {concept.left.map((l) => `${l.name} (${l.reason})`).join('; ')}
            </p>
          )}

          <h5>Szenen</h5>
          {concept.scenes.length ? (
            <ul className="assistant-list">
              {concept.scenes.map((s) => (
                <li key={s.name} data-testid="concept-scene">
                  <strong>{s.name}</strong> – {s.trigger ? `${s.trigger}: ` : ''}
                  {s.actions}
                  {s.roomIds.length > 0 && <span className="muted"> ({s.roomIds.map(roomName).join(', ')})</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">Noch keine Szene möglich – dafür fehlen Geräte.</p>
          )}
          <p className="muted small">Szenen sind Vorschläge für Home Assistant; der Planer simuliert nur einfache Regeln (Reiter „Regeln“).</p>

          <h5>Netz und Zentrale</h5>
          <div data-testid="concept-network">
            {concept.network.note && <p>{concept.network.note}</p>}
            <ul className="assistant-list">
              {concept.network.facts.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>

          <h5>Budget</h5>
          <div data-testid="concept-budget">
            <ul className="assistant-list">
              {budget.rooms.map((r) => (
                <li key={r.roomId} data-testid="concept-budget-room">
                  {roomName(r.roomId)}: {price(r.cost)}
                  {r.cost.unknown > 0 && ` + ${r.cost.unknown} Gerät(e) ohne Preis`}
                </li>
              ))}
              <li data-testid="concept-budget-central">
                Zentrale: {formatEuro(budget.central.total)}{' '}
                <span className="muted">
                  (
                  {budget.central.parts.map((p, n) => (
                    <span key={p.id}>
                      {n > 0 && ', '}
                      <a href={p.source} target="_blank" rel="noreferrer noopener" className="design-link">
                        {p.name}
                      </a>{' '}
                      {formatEuro(p.price)}
                    </span>
                  ))}
                  )
                </span>
              </li>
            </ul>
            <p>
              Gesamt bis Phase {upTo}: <strong data-testid="concept-total">{price(budget.total)}</strong>
              {budget.total.unknown > 0 && <span className="muted"> + {budget.total.unknown} Gerät(e) ohne Preisangabe</span>}
              {w.budget > 0 && budget.total.max > w.budget && <span className="warning"> – über dem Budget von {formatEuro(w.budget)}</span>}
            </p>
            <p className="muted small">Preise aus den Datenblatt- und Händlerrecherchen (Stand 16.10.2026, vor dem Kauf prüfen); Claude nennt keine Preise.</p>
          </div>

          {concept.questions.length > 0 && (
            <>
              <h5>Offene Fragen</h5>
              <ul className="assistant-list" data-testid="concept-questions">
                {concept.questions.map((q) => (
                  <li key={q.question}>
                    {q.question} <span className="muted">Vorschlag: {q.proposal}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {concept.later.length > 0 && (
            <p className="muted small">
              Noch nicht im Planer abbildbar: {concept.later.map((l) => `${roomName(l.roomId)}: ${l.text}`).join('; ')}
            </p>
          )}
          {concept.dropped > 0 && <p className="muted small">{concept.dropped === 1 ? 'Ein Eintrag der Antwort passte' : `${concept.dropped} Einträge der Antwort passten`} nicht zum Plan – weggelassen.</p>}

          <div className="assistant-preview" data-testid="concept-preview">
            <Badge kind="info">noch nicht übernommen</Badge>
            <p>
              {shown.items.length ? `${shown.items.length} Geräte im Plan als Vorschau (Phase 1–${upTo}).` : 'Keine Geräte in dieser Auswahl.'}
              {shown.coverage.map((c) => ` ${roomName(c.roomId)}: ${Math.round(c.before * 100)} % → ${Math.round(c.after * 100)} % erfasst.`)}
            </p>
            <div className="btn-row">
              <button className="primary" disabled={!shown.items.length} onClick={take} data-testid="concept-apply">
                Übernehmen
              </button>
              <button onClick={() => st.discard()} data-testid="concept-discard">
                Verwerfen
              </button>
            </div>
            <p className="muted small">Übernehmen setzt die Geräte in einem Schritt in den Plan – Strg+Z macht alles zusammen rückgängig. Verwerfen lässt den Plan unverändert.</p>
          </div>
        </div>
      )}
    </Section>
  );
}

