import { useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { applyFurnishing, guessRoomType, roomIdAt, suggestFurnishing, WISH_CATALOG } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { buildPrompt, MAX_QUESTION, parseAnswer, type AssistantSuggestion } from './answer';
import { useAssistantStore } from './assistantStore';
import { errorText, HIDE_CODES, loadSample, type Sample, type SampleError } from './claude';
import { summarizePlan } from './planSummary';
import './assistant.css';

const ALL = '__all';
let controller: AbortController | null = null;

/**
 * „Claude fragen“ (#151): a question about the whole plan or one room goes to Claude together
 * with a plan summary; the answer is shown as a list of suggestions. Furniture suggestions can
 * be previewed in 2D/3D (placed collision-free by the rule-based placement of #137) and taken
 * over in one undo step. Only shown where the Claude artifact runtime offers Claude (no key in
 * the browser); elsewhere the panel renders nothing.
 */
export function AssistantPanel() {
  const [sample, setSample] = useState<Sample | null>(null);
  const st = useAssistantStore();
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const furnishPreview = useFurnishStore((s) => s.preview);
  const extraCatalog = useCatalogStore((s) => s.items);
  const offer = useMemo(() => [...WISH_CATALOG, ...extraCatalog.filter((c) => !c.kitchen)], [extraCatalog]);

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

  if (!sample || st.hidden) return null;

  const rooms = project.rooms;
  const scope = st.scope === ALL || rooms.some((r) => r.id === st.scope) ? st.scope : ALL;
  const previewActive = st.preview !== null && st.preview === furnishPreview;
  const roomName = (id: string | null) => (id ? rooms.find((r) => r.id === id)?.name || 'Raum ohne Namen' : 'Ganze Wohnung');

  const ask = async () => {
    const question = st.question.trim();
    if (!question || st.asking) return;
    const focus = scope === ALL ? null : scope;
    const plan = summarizePlan(project, { roomTypes, focusRoomId: focus });
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    try {
      const raw = await sample.json(buildPrompt(question, plan, offer), { signal: ctl.signal });
      const suggestions = parseAnswer(raw, plan, offer, focus);
      const old = useAssistantStore.getState().preview;
      if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
      st.set({ asking: false, suggestions, answeredScope: scope, previewIndex: null, preview: null });
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false, hidden: true });
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort enthielt keine verwertbaren Vorschläge – bitte anders fragen.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const showPreview = (s: AssistantSuggestion, index: number) => {
    if (!s.roomId) return;
    const room = rooms.find((r) => r.id === s.roomId);
    if (!room) return;
    const preview = suggestFurnishing(project, [{ roomId: room.id, type: roomTypes[room.id] ?? guessRoomType(room.name), wishes: s.furniture }], extraCatalog);
    useFurnishStore.getState().setPreview(preview);
    st.set({ preview, previewIndex: index });
    if (!preview.items.length) useUiStore.getState().toast('Für diese Möbel wurde im Raum kein freier Platz gefunden.', 'info');
  };

  const take = () => {
    const preview = st.preview;
    if (!preview || !previewActive) return;
    let ids: string[] = [];
    apply((d) => {
      ids = applyFurnishing(d, preview);
    });
    st.set({ preview: null, previewIndex: null });
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast(`${ids.length} Möbel aus dem Claude-Vorschlag übernommen – mit Strg+Z in einem Schritt rückgängig.`, 'success');
  };

  const discard = () => {
    if (previewActive) useFurnishStore.getState().setPreview(null);
    st.set({ preview: null, previewIndex: null });
  };

  return (
    <div className="assistant-panel" data-testid="assistant-panel">
      <Section title="Claude fragen" actions={<Badge kind="info">Vorschläge</Badge>}>
        <p className="muted small">
          Frage zum ganzen Plan oder zu einem Raum, z. B. „Wie wirkt das Wohnzimmer gemütlicher?“. Claude bekommt dazu nur eine Zusammenfassung des Plans (Räume, Maße, Möbel, Türen und Fenster), keinen
          Projektnamen und keine persönlichen Daten. Die Anfrage läuft über dein Claude-Konto.
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
          aria-label="Frage an Claude"
          placeholder="Was fehlt im Schlafzimmer?"
          maxLength={MAX_QUESTION}
          value={st.question}
          onChange={(e) => st.set({ question: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void ask();
          }}
        />
        <div className="btn-row">
          <button className="primary" disabled={!st.question.trim() || st.asking} onClick={() => void ask()}>
            {st.asking ? 'Claude denkt nach…' : 'Fragen'}
          </button>
          {st.asking && <button onClick={() => controller?.abort()}>Stopp</button>}
        </div>
        {st.error && (
          <p className="warning small" role="alert">
            {st.error}
          </p>
        )}
        {st.suggestions.length > 0 && (
          <>
            <p className="muted small">Vorschläge von Claude für „{roomName(st.answeredScope === ALL ? null : st.answeredScope)}“ – bitte selbst prüfen. Möbel nur aus dem Katalog, Preise sind Richtwerte des Katalogs.</p>
            <ul className="assistant-list" data-testid="assistant-suggestions">
              {st.suggestions.map((s, i) => {
                const active = previewActive && st.previewIndex === i;
                return (
                  <li key={i} className="assistant-card" data-testid="assistant-suggestion">
                    <h4>{s.title}</h4>
                    {s.detail && <p>{s.detail}</p>}
                    <p className="muted">{roomName(s.roomId)}</p>
                    {s.furniture.length > 0 && (
                      <p>
                        Möbel: {s.furniture.map((w) => `${w.quantity > 1 ? `${w.quantity}× ` : ''}${offer.find((c) => c.id === w.catalogId)?.name ?? w.catalogId}`).join(', ')}
                      </p>
                    )}
                    {s.dropped > 0 && <p className="muted">{s.dropped === 1 ? 'Ein genanntes Möbel' : `${s.dropped} genannte Möbel`} nicht im Katalog – weggelassen.</p>}
                    {s.furniture.length > 0 && !active && (
                      <div className="btn-row">
                        <button onClick={() => showPreview(s, i)}>Vorschau</button>
                      </div>
                    )}
                    {active && st.preview && (
                      <div className="assistant-preview" data-testid="assistant-preview">
                        <Badge kind="info">noch nicht übernommen</Badge>
                        <p>{st.preview.items.length ? `${st.preview.items.length} Möbel kollisionsfrei aufgestellt.` : 'Kein freier Platz gefunden.'}</p>
                        {st.preview.rooms[0]?.missing.length ? <p className="warning">Kein freier Platz für: {st.preview.rooms[0].missing.join(', ')}</p> : null}
                        <div className="btn-row">
                          <button className="primary" disabled={!st.preview.items.length} onClick={take}>
                            Übernehmen
                          </button>
                          <button onClick={discard}>Verwerfen</button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Section>
    </div>
  );
}
