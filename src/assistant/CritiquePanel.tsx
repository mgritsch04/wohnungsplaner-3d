import { useEffect, useMemo, useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { guessRoomType } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { errorText, HIDE_CODES, loadSample, missingClaude, type Sample, type SampleError } from './claude';
import { applyMoves, buildCritiqueInput, buildCritiquePrompt, moveProblem, parseCritique, previewGhosts, type CritiqueSuggestion } from './critique';
import { useCritiqueStore } from './critiqueStore';
import './assistant.css';

const ALL = '__all';
let controller: AbortController | null = null;

const cm = (v: number) => Math.round(v * 100);

/**
 * „Raumkritik mit Claude“ (#365): Claude gets the results of the Wohnungs-Check plus a summary of
 * the room and suggests 3–5 rearrangements. Each one can be previewed in 2D/3D, taken over in
 * one undo step or discarded. Hidden where Claude is not available.
 */
export function CritiquePanel() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [checked, setChecked] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [missing, setMissing] = useState<'helper' | 'claude'>('helper');
  const st = useCritiqueStore();
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const furnishPreview = useFurnishStore((s) => s.preview);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const critique = st.critique;
  const problems = useMemo(() => new Map((critique?.suggestions ?? []).map((s) => [s.id, moveProblem(project, s.moves)])), [critique, project]);

  useEffect(() => {
    let live = true;
    void loadSample().then(async (s) => {
      const why = s ? null : await missingClaude();
      if (!live) return;
      if (why) setMissing(why);
      setSample(s);
      setChecked(true);
    });
    return () => {
      live = false;
    };
  }, []);

  if (hidden || !checked) return null;
  if (!sample) {
    return (
      <div className="assistant-panel" data-testid="critique-panel-unavailable">
        <Section title="Raumkritik mit Claude">
          <p className="muted small">Claude bewertet deinen Plan anhand des Wohnungs-Checks und schlägt Umstellungen vor. Dafür braucht der Planer eine Verbindung zu Claude – die fehlt gerade:</p>
          {missing === 'helper' ? (
            <p className="warning small">
              Der lokale Helfer läuft nicht. Starte ihn in einem zweiten Terminal im Projektordner mit <code>npm run ikea-helper</code> und lade diese Seite neu (oder im Claude-Artefakt öffnen).
            </p>
          ) : (
            <p className="warning small">Der Helfer läuft, findet aber Claude Code nicht. Installiere Claude Code und melde dich an (<code>claude</code> im Terminal), dann den Helfer neu starten und diese Seite neu laden.</p>
          )}
        </Section>
      </div>
    );
  }

  const rooms = project.rooms;
  const scope = st.scope === ALL || rooms.some((r) => r.id === st.scope) ? st.scope : ALL;
  const previewActive = st.previewId !== null && st.ghosts !== null && st.ghosts === furnishPreview;

  const clearPreview = () => {
    const old = useCritiqueStore.getState().ghosts;
    if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
    useCritiqueStore.getState().set({ previewId: null, ghosts: null });
  };

  const ask = async () => {
    if (!rooms.length || st.asking) return;
    const types = Object.fromEntries(rooms.map((r) => [r.id, roomTypes[r.id] ?? guessRoomType(r.name)]));
    const input = buildCritiqueInput(project, scope === ALL ? null : scope, types);
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    clearPreview();
    st.set({ asking: true, error: null });
    try {
      const raw = await sample.json(buildCritiquePrompt(input), { signal: ctl.signal, modelTier: 'complex' });
      st.set({ asking: false, critique: parseCritique(raw, input, project) });
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort enthielt keine verwertbaren Vorschläge – bitte erneut versuchen.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const show = (s: CritiqueSuggestion) => {
    clearPreview();
    const ghosts = { rooms: [], items: previewGhosts(project, s.moves) };
    useFurnishStore.getState().setPreview(ghosts);
    st.set({ previewId: s.id, ghosts });
  };

  const drop = (s: CritiqueSuggestion) => {
    if (!critique) return;
    if (st.previewId === s.id) clearPreview();
    st.set({ critique: { ...critique, suggestions: critique.suggestions.filter((x) => x.id !== s.id) } });
  };

  const take = (s: CritiqueSuggestion) => {
    const problem = moveProblem(project, s.moves);
    if (problem) {
      useUiStore.getState().toast(`Vorschlag nicht mehr möglich: ${problem}`, 'info');
      return;
    }
    clearPreview();
    let ids: string[] = [];
    apply((d) => {
      ids = applyMoves(d, s.moves);
    });
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast(`„${s.title}“ übernommen – mit Strg+Z in einem Schritt rückgängig.`, 'success');
    const latest = useCritiqueStore.getState().critique;
    if (latest) st.set({ critique: { ...latest, suggestions: latest.suggestions.filter((x) => x.id !== s.id) } });
  };

  return (
    <div className="assistant-panel" data-testid="critique-panel">
      <Section title="Raumkritik mit Claude" actions={<Badge kind="info">nutzt Claude-Kontingent</Badge>}>
        <p className="muted small">
          Claude bekommt die Ergebnisse des Wohnungs-Checks, eine Zusammenfassung der Räume und die Möbel (Name, Größe, Lage) – keine Links, Preise oder Projektnamen – und schlägt 3–5 Umstellungen vor. Der
          Planer prüft jeden Vorschlag auf Kollisionen; du siehst ihn erst als Vorschau. Die Anfrage läuft über dein Claude-Konto.
        </p>
        {rooms.length === 0 ? (
          <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>
        ) : (
          <>
            <SelectField label="Umfang" value={scope} options={[{ value: ALL, label: 'Ganze Wohnung' }, ...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' }))]} onChange={(v) => st.set({ scope: v })} />
            <div className="btn-row">
              <button className="primary" data-testid="critique-ask" disabled={st.asking || project.furniture.length === 0} onClick={() => void ask()}>
                {st.asking ? 'Claude schaut sich den Plan an…' : critique ? 'Raumkritik erneut anfordern' : 'Raumkritik anfordern'}
              </button>
              {st.asking && <button onClick={() => controller?.abort()}>Stopp</button>}
            </div>
            {project.furniture.length === 0 && <p className="muted small">Noch keine Möbel im Plan – es gibt nichts umzustellen.</p>}
          </>
        )}
        {st.error && (
          <p className="warning small" role="alert">
            {st.error}
          </p>
        )}
        {critique && (
          <div className="assistant-card" data-testid="critique-result">
            <h4>Raumkritik</h4>
            <Badge kind="info">Vorschlag von Claude – bitte selbst prüfen</Badge>
            {critique.summary && <p>{critique.summary}</p>}
            {critique.suggestions.length === 0 && <p className="muted">Keine Vorschläge mehr offen.</p>}
            <ul className="assistant-list">
              {critique.suggestions.map((s) => {
                const problem = problems.get(s.id) ?? null;
                return (
                  <li key={s.id} data-testid="critique-suggestion">
                    <strong>{s.title}</strong>
                    {s.reason && <p>{s.reason}</p>}
                    <ul className="design-alternatives">
                      {s.moves.map((mv) => (
                        <li key={mv.furnitureId} className="muted small">
                          {mv.name}: von ({cm(mv.from.x)}, {cm(mv.from.y)}) cm nach ({cm(mv.to.x)}, {cm(mv.to.y)}) cm
                          {Math.abs(mv.to.rotation - mv.from.rotation) > 0.02 && ', gedreht'}
                        </li>
                      ))}
                    </ul>
                    {problem && <p className="warning small">Nicht mehr möglich: {problem}</p>}
                    <div className="btn-row">
                      {st.previewId === s.id && previewActive ? (
                        <button onClick={clearPreview}>Vorschau ausblenden</button>
                      ) : (
                        <button disabled={!!problem} onClick={() => show(s)}>
                          Vorschau im Plan
                        </button>
                      )}
                      <button className="primary" disabled={!!problem} onClick={() => take(s)}>
                        Übernehmen
                      </button>
                      <button onClick={() => drop(s)}>Verwerfen</button>
                    </div>
                    {st.previewId === s.id && previewActive && <p className="muted small">Gezeigt als Vorschau am neuen Platz – noch nicht übernommen.</p>}
                  </li>
                );
              })}
            </ul>
            {critique.dropped > 0 && <p className="muted">{critique.dropped === 1 ? 'Ein Vorschlag war' : `${critique.dropped} Vorschläge waren`} nicht umsetzbar (Kollision oder unbekanntes Möbel) – weggelassen.</p>}
          </div>
        )}
      </Section>
    </div>
  );
}
