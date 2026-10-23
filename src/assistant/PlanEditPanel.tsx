import { useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { applyFurnishing, roomIdAt, WISH_CATALOG } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { errorText, HIDE_CODES, loadSample, type Sample, type SampleError } from './claude';
import { QUALITY_CHOICES } from './design';
import { buildEditInput, buildEditPrompt, MAX_INSTRUCTION, parseEditAnswer, planEdits } from './planEdit';
import { usePlanEditStore } from './planEditStore';
import './assistant.css';

const ALL = '__all';
let controller: AbortController | null = null;

/**
 * „Claude ändern lassen“ (#415): an instruction in free text for the whole apartment or one room
 * („Sofa ans Fenster“, „Küche an die andere Wand“). Claude answers with targeted changes, the app
 * places the pieces itself (collision-free) and shows them as a preview; „Übernehmen“ is one undo
 * step, the rest of the plan stays as it is. Only shown where Claude can be asked.
 */
export function PlanEditPanel() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [hidden, setHidden] = useState(false);
  const st = usePlanEditStore();
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const furnishPreview = useFurnishStore((s) => s.preview);
  const extraCatalog = useCatalogStore((s) => s.items);
  // the user's own products first (the prompt keeps the first 150 entries)
  const offer = useMemo(() => [...extraCatalog.filter((c) => !c.kitchen), ...WISH_CATALOG], [extraCatalog]);

  useEffect(() => {
    let live = true;
    void loadSample().then((s) => live && setSample(s));
    return () => {
      live = false;
    };
  }, []);

  const derived = useMemo(() => derivePlan(project), [project]);
  const selectedRoom = useMemo(() => {
    if (selection?.type === 'room') return selection.id;
    const f = selection?.type === 'furniture' ? project.furniture.find((x) => x.id === selection.id) : undefined;
    return f ? roomIdAt(project, derived, f) : null;
  }, [selection, project, derived]);

  if (!sample || hidden) return null;

  const rooms = project.rooms;
  const scope = st.scope === ALL || rooms.some((r) => r.id === st.scope) ? st.scope : ALL;
  const previewActive = !!st.plan && st.plan.preview === furnishPreview;

  const ask = async () => {
    const instruction = st.instruction.trim();
    if (!instruction || st.asking || !rooms.length) return;
    const input = buildEditInput(project, scope === ALL ? null : scope, roomTypes);
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    try {
      const thorough = st.quality !== 'fast';
      const raw = await sample.json(buildEditPrompt(instruction, input, offer), { signal: ctl.signal, modelTier: thorough ? 'complex' : 'default', label: 'Plan ändern', ...(thorough ? { model: 'opus' as const } : {}) });
      // the plan may have changed while Claude was thinking: check and place against the current one
      const now = useProjectStore.getState().project;
      const answer = parseEditAnswer(raw, input, now, derivePlan(now), offer);
      const plan = planEdits(now, input, answer, { roomTypes, catalog: offer });
      const old = usePlanEditStore.getState().plan;
      if (old && useFurnishStore.getState().preview === old.preview) useFurnishStore.getState().setPreview(null);
      if (plan.preview.items.length || plan.preview.replaces?.length) useFurnishStore.getState().setPreview(plan.preview);
      st.set({ asking: false, input, plan, summary: answer.summary, notPossible: answer.notPossible, dropped: answer.dropped });
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Claude hat keine umsetzbaren Änderungen geliefert – bitte die Anweisung anders formulieren.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const take = () => {
    const plan = st.plan;
    if (!plan || !previewActive) return;
    let ids: string[] = [];
    apply((d) => {
      ids = applyFurnishing(d, plan.preview);
    });
    useFurnishStore.getState().setPreview(null);
    st.set({ plan: null });
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast('Änderungen übernommen – mit Strg+Z in einem Schritt rückgängig.', 'success');
  };

  const discard = () => {
    if (previewActive) useFurnishStore.getState().setPreview(null);
    st.set({ plan: null, summary: '', notPossible: [], dropped: 0 });
  };

  const plan = st.plan;
  const changed = plan ? plan.preview.items.length + (plan.preview.replaces?.length ?? 0) : 0;

  return (
    <div className="assistant-panel" data-testid="plan-edit-panel">
      <Section title="Claude ändern lassen" actions={<Badge kind="info">Anweisung</Badge>}>
        <p className="muted small">
          Sag Claude, was am Plan anders sein soll, z. B. „Sofa ans Fenster“, „Küche an die andere Wand“ oder „Schreibtisch raus, dafür ein Regal“. Claude ändert nur das, der Rest bleibt. Die App stellt
          die Möbel selbst ohne Kollision auf; fixierte Möbel bleiben stehen. Wände, Türen und Fenster ändert Claude nicht.
        </p>
        <SelectField
          label="Bezug"
          value={scope}
          options={[{ value: ALL, label: 'Ganze Wohnung' }, ...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' }))]}
          onChange={(v) => st.set({ scope: v })}
        />
        {selectedRoom && scope !== selectedRoom && (
          <button className="small" onClick={() => st.set({ scope: selectedRoom })}>
            Gewählten Raum nehmen
          </button>
        )}
        <textarea
          className="assistant-question"
          aria-label="Anweisung an Claude"
          placeholder="Stell das Sofa ans Fenster und den Fernseher gegenüber."
          maxLength={MAX_INSTRUCTION}
          value={st.instruction}
          onChange={(e) => st.set({ instruction: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask();
          }}
        />
        <SelectField label="Qualität" value={st.quality} options={QUALITY_CHOICES.map((q) => ({ value: q.value, label: q.value === 'fast' ? 'Schnell – Standardmodell' : 'Gründlich – stärkstes Modell' }))} onChange={(v) => st.set({ quality: v })} />
        <div className="btn-row">
          <button className="primary" disabled={!st.instruction.trim() || st.asking || !rooms.length} onClick={() => void ask()}>
            {st.asking ? 'Claude plant die Änderung…' : 'Ändern lassen'}
          </button>
          {st.asking && <button onClick={() => controller?.abort()}>Stopp</button>}
        </div>
        {!rooms.length && <p className="muted small">Bitte zuerst Räume anlegen oder einen Grundriss importieren.</p>}
        {st.error && (
          <p className="warning small" role="alert">
            {st.error}
          </p>
        )}
        {plan && (
          <div className="assistant-preview" data-testid="plan-edit-result">
            {st.summary && <p>{st.summary}</p>}
            <ul className="plan-edit-list">
              {plan.results.map((r, i) => (
                <li key={i} className={r.ok ? '' : 'warning'} data-testid="plan-edit-change">
                  {r.ok ? '✓' : '✗'} {r.text}
                  {r.note ? ` – ${r.note}` : ''}
                  {r.why && <span className="muted"> ({r.why})</span>}
                </li>
              ))}
            </ul>
            {st.notPossible.length > 0 && (
              <p className="muted small" data-testid="plan-edit-not-possible">
                Geht so nicht: {st.notPossible.join(' · ')}
              </p>
            )}
            {st.dropped > 0 && <p className="muted small">{st.dropped === 1 ? 'Eine Änderung' : `${st.dropped} Änderungen`} von Claude bezog sich auf Unbekanntes oder Fixiertes und wurde weggelassen.</p>}
            {changed > 0 ? (
              <>
                <Badge kind="info">{previewActive ? 'Vorschau, noch nicht übernommen' : 'Vorschau verworfen'}</Badge>
                <div className="btn-row">
                  <button className="primary" disabled={!previewActive} onClick={take}>
                    Übernehmen
                  </button>
                  <button onClick={discard}>Verwerfen</button>
                </div>
              </>
            ) : (
              <p className="muted small">Am Plan ändert sich dadurch nichts.</p>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
