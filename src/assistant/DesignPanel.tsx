import { useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import { derivePlan } from '../model/derived';
import { formatEuro } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { applyFurnishing, guessRoomType, roomIdAt, suggestFurnishing } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { errorText, HIDE_CODES, loadSample, type Sample, type SampleError } from './claude';
import { buildDesignPrompt, MAX_FIELD, parseDesignAnswer, preselect, proposalTotal, realProducts, RETAILER_CHOICES, retailerOf, STYLES, type DesignWishes } from './design';
import { useDesignStore } from './designStore';
import { summarizePlan } from './planSummary';
import './assistant.css';

let controller: AbortController | null = null;

const FIELDS: { key: 'interests' | 'needs' | 'wants' | 'colors'; label: string; placeholder: string }[] = [
  { key: 'interests', label: 'Interessen / Hobbys', placeholder: 'Gaming, Lesen, Yoga' },
  { key: 'needs', label: 'Was du brauchst', placeholder: 'Schlafplatz, Arbeitsplatz, Stauraum' },
  { key: 'wants', label: 'Was du dir wünschst', placeholder: 'großes Sofa, Pflanzenecke' },
  { key: 'colors', label: 'Farben (optional)', placeholder: 'Holz hell, Grün' },
];

/**
 * „Einrichtungsvorschlag mit Claude“ (#350): interests, needs, wishes, style and budget for one
 * room go to Claude together with a plan summary and a preselection of the user's own IKEA and
 * Möbelix products. Claude picks products with a reason; the app checks them against the
 * offered list, shows name, retailer, dimensions, price and link plus the total, previews them
 * placed collision-free in 2D/3D and takes them over in one undo step. Hidden where the Claude
 * artifact runtime is not available (no key in the browser).
 */
export function DesignPanel() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [hidden, setHidden] = useState(false);
  const st = useDesignStore();
  const w = st.wishes;
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const furnishPreview = useFurnishStore((s) => s.preview);
  const items = useCatalogStore((s) => s.items);
  const all = useMemo(() => realProducts(items), [items]);
  const products = useMemo(() => realProducts(items, w.retailer), [items, w.retailer]);

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
  const roomId = st.roomId && rooms.some((r) => r.id === st.roomId) ? st.roomId : (selectedRoom ?? rooms[0]?.id ?? null);
  const room = rooms.find((r) => r.id === roomId);
  const previewActive = st.preview !== null && st.preview === furnishPreview;
  const byId = (id: string) => all.find((c) => c.id === id);
  const text = (k: keyof DesignWishes, v: string) => st.setWishes({ [k]: v.slice(0, MAX_FIELD) });
  const typeOf = (id: string, name: string) => roomTypes[id] ?? guessRoomType(name);

  const ask = async () => {
    if (!room || st.asking) return;
    const offer = preselect(products, typeOf(room.id, room.name), w.budget);
    if (!offer.length) {
      st.set({ error: 'Keine passenden IKEA- oder Möbelix-Produkte in deiner Auswahl (Händler oder Budget prüfen).' });
      return;
    }
    const plan = summarizePlan(project, { roomTypes, focusRoomId: room.id });
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    try {
      const raw = await sample.json(buildDesignPrompt(w, plan, offer), { signal: ctl.signal });
      const proposal = parseDesignAnswer(raw, offer);
      const old = useDesignStore.getState().preview;
      if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
      st.set({ asking: false, proposal, proposalRoomId: room.id, preview: null });
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort enthielt keine Produkte aus deiner Auswahl – bitte erneut versuchen.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const proposal = st.proposal;
  const proposalRoom = rooms.find((r) => r.id === st.proposalRoomId);
  const total = proposal ? proposalTotal(proposal.picks, all) : null;

  const showPreview = () => {
    if (!proposal || !proposalRoom) return;
    const preview = suggestFurnishing(project, [{ roomId: proposalRoom.id, type: typeOf(proposalRoom.id, proposalRoom.name), wishes: proposal.picks.map((p) => ({ catalogId: p.catalogId, quantity: p.quantity })) }], all);
    useFurnishStore.getState().setPreview(preview);
    st.set({ preview });
    if (!preview.items.length) useUiStore.getState().toast('Für diese Möbel wurde im Raum kein freier Platz gefunden.', 'info');
  };

  const take = () => {
    const preview = st.preview;
    if (!preview || !previewActive) return;
    let ids: string[] = [];
    apply((d) => {
      ids = applyFurnishing(d, preview);
    });
    st.set({ preview: null });
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast(`${ids.length} Möbel aus dem Einrichtungsvorschlag übernommen – mit Strg+Z in einem Schritt rückgängig.`, 'success');
  };

  const discard = () => {
    if (previewActive) useFurnishStore.getState().setPreview(null);
    st.set({ preview: null });
  };

  return (
    <div className="assistant-panel" data-testid="design-panel">
      <Section title="Einrichtungsvorschlag mit Claude" actions={<Badge kind="info">echte Produkte</Badge>}>
        <p className="muted small">
          Claude stellt aus deinen IKEA- und Möbelix-Produkten (Katalog › IKEA bzw. Möbelix) eine Einrichtung für einen Raum zusammen. Claude bekommt nur die Raumzusammenfassung, deine Angaben hier und
          die Produktliste (Name, Maße, Preis) – keine Links, keinen Projektnamen. Die Möbel stellt der Planer selbst kollisionsfrei auf. Die Anfrage läuft über dein Claude-Konto.
        </p>
        {all.length === 0 ? (
          <p className="warning small" data-testid="design-no-products">
            Noch keine IKEA- oder Möbelix-Produkte mit Maßen in deiner Auswahl. Zuerst unter Katalog › IKEA oder Möbelix Produkte übernehmen.
          </p>
        ) : !room ? (
          <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>
        ) : (
          <>
            <SelectField label="Raum" value={room.id} options={rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' }))} onChange={(v) => st.set({ roomId: v })} />
            {FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span className="field-label">{f.label}</span>
                <span className="field-input">
                  <input type="text" value={w[f.key]} placeholder={f.placeholder} maxLength={MAX_FIELD} onChange={(e) => text(f.key, e.target.value)} />
                </span>
              </label>
            ))}
            <label className="field">
              <span className="field-label">Stil</span>
              <span className="field-input">
                <input type="text" list="design-styles" value={w.style} maxLength={MAX_FIELD} onChange={(e) => text('style', e.target.value)} />
                <datalist id="design-styles">
                  {STYLES.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </span>
            </label>
            <label className="field">
              <span className="field-label">Budget in € (0 = egal)</span>
              <span className="field-input">
                <input type="number" min={0} step={50} value={w.budget || 0} onChange={(e) => st.setWishes({ budget: Math.max(0, Number(e.target.value) || 0) })} />
              </span>
            </label>
            <SelectField label="Händler" value={w.retailer} options={RETAILER_CHOICES} onChange={(v) => st.setWishes({ retailer: v })} />
            <p className="muted small">{products.length === 1 ? '1 Produkt' : `${products.length} Produkte`} aus deiner Auswahl kommen in Frage.</p>
            <div className="btn-row">
              <button className="primary" disabled={st.asking || !products.length} onClick={() => void ask()}>
                {st.asking ? 'Claude stellt zusammen…' : proposal ? 'Neuen Vorschlag erstellen' : 'Vorschlag erstellen'}
              </button>
              {st.asking && <button onClick={() => controller?.abort()}>Stopp</button>}
            </div>
          </>
        )}
        {st.error && (
          <p className="warning small" role="alert">
            {st.error}
          </p>
        )}
        {proposal && proposalRoom && total && (
          <div className="assistant-card" data-testid="design-proposal">
            <h4>Vorschlag für „{proposalRoom.name || 'Raum ohne Namen'}“</h4>
            <Badge kind="info">Vorschlag von Claude – bitte selbst prüfen</Badge>
            {proposal.summary && <p>{proposal.summary}</p>}
            <ul className="assistant-list">
              {proposal.picks.map((p) => {
                const c = byId(p.catalogId);
                if (!c) return null;
                return (
                  <li key={p.catalogId} data-testid="design-pick">
                    <strong>
                      {p.quantity > 1 ? `${p.quantity}× ` : ''}
                      {c.name}
                    </strong>{' '}
                    <span className="muted">
                      ({retailerOf(c)}, {Math.round(c.width * 100)}×{Math.round(c.depth * 100)}×{Math.round(c.height * 100)} cm, {c.price ? formatEuro(c.price.amount) : 'Preis unbekannt'})
                    </span>
                    {c.productUrl && (
                      <>
                        {' '}
                        <a href={c.productUrl} target="_blank" rel="noreferrer noopener">
                          Produktseite
                        </a>
                      </>
                    )}
                    {p.reason && <p>{p.reason}</p>}
                  </li>
                );
              })}
            </ul>
            <p>
              Gesamt laut Katalog: <strong data-testid="design-total">{formatEuro(total.total)}</strong>
              {total.unpriced > 0 && <span className="muted"> (ohne {total.unpriced === 1 ? '1 Stück' : `${total.unpriced} Stück`} ohne Preis)</span>}
              {w.budget > 0 && total.total > w.budget && <span className="warning"> – über dem Budget von {formatEuro(w.budget)}</span>}
            </p>
            {proposal.dropped > 0 && <p className="muted">{proposal.dropped === 1 ? 'Ein genanntes Produkt war' : `${proposal.dropped} genannte Produkte waren`} nicht in deiner Auswahl – weggelassen.</p>}
            {!previewActive ? (
              <div className="btn-row">
                <button onClick={showPreview}>Vorschau im Raum</button>
              </div>
            ) : (
              st.preview && (
                <div className="assistant-preview" data-testid="design-preview">
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
              )
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
