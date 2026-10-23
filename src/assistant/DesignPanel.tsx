import { useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import type { CatalogItem } from '../catalog/types';
import { formatEuro } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { applyFurnishing, guessRoomType, suggestFurnishing, type FurnishingSuggestion } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { errorText, HIDE_CODES, loadSample, type Sample, type SampleError } from './claude';
import {
  buildDesignPrompt,
  MAX_FIELD,
  parseDesignAnswer,
  PLACEHOLDERS,
  preselect,
  proposalTotal,
  realProducts,
  RETAILER_CHOICES,
  retailerOf,
  searchLinks,
  STYLES,
  swapPick,
  type DesignOption,
  type DesignProposal,
  type DesignWishes,
  type RetailerChoice,
} from './design';
import { useDesignStore } from './designStore';
import { summarizePlan } from './planSummary';
import './assistant.css';

const ALL = '__all';
let controller: AbortController | null = null;

const FIELDS: { key: 'interests' | 'needs' | 'wants' | 'colors'; label: string; placeholder: string }[] = [
  { key: 'interests', label: 'Interessen / Hobbys', placeholder: 'Gaming, Lesen, Yoga' },
  { key: 'needs', label: 'Was du brauchst', placeholder: 'Schlafplatz, Arbeitsplatz, Stauraum' },
  { key: 'wants', label: 'Was du dir wünschst', placeholder: 'großes Sofa, Pflanzenecke' },
  { key: 'colors', label: 'Farben (optional)', placeholder: 'Holz hell, Grün' },
];

const cm = (v: number) => Math.round(v * 100);

/** Placeholders get Claude's description as name; real products keep their product data. */
function labelPreview(preview: FurnishingSuggestion, proposal: DesignProposal) {
  for (const r of preview.rooms) {
    const picks = proposal.rooms.find((x) => x.roomId === r.roomId)?.picks ?? [];
    for (const f of r.placed) {
      const pick = picks.find((p) => p.catalogId === f.catalogId);
      if (pick?.placeholder) f.name = `${pick.label} (Platzhalter)`.slice(0, 200);
    }
  }
  const missing = preview.rooms.flatMap((r) => r.missing);
  return { preview, missing };
}

/**
 * „Einrichtungsvorschlag mit Claude“ (#350): the user only gives interests, needs, wishes, style
 * and budget; Claude furnishes the whole apartment (or one room) itself – own IKEA/Möbelix
 * products where they fit, placeholders with a shop search link for everything else – with a
 * reason per item and alternatives for the bigger pieces. The app checks the answer, shows
 * prices from the catalogue data, previews everything placed collision-free in 2D/3D and takes
 * it over in one undo step. Hidden where the Claude artifact runtime is not available.
 */
export function DesignPanel() {
  const [sample, setSample] = useState<Sample | null>(null);
  const [hidden, setHidden] = useState(false);
  const [openAlt, setOpenAlt] = useState<string | null>(null);
  const st = useDesignStore();
  const w = st.wishes;
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const roomTypes = useFurnishStore((s) => s.roomTypes);
  const furnishPreview = useFurnishStore((s) => s.preview);
  const items = useCatalogStore((s) => s.items);
  const own = useMemo(() => realProducts(items), [items]);
  const products = useMemo(() => realProducts(items, w.retailer), [items, w.retailer]);
  const catalog = useMemo(() => [...own, ...PLACEHOLDERS], [own]);

  useEffect(() => {
    let live = true;
    void loadSample().then((s) => live && setSample(s));
    return () => {
      live = false;
    };
  }, []);

  if (!sample || hidden) return null;

  const rooms = project.rooms;
  const scope = st.scope === ALL || rooms.some((r) => r.id === st.scope) ? st.scope : ALL;
  const targets = scope === ALL ? rooms : rooms.filter((r) => r.id === scope);
  const previewActive = st.preview !== null && st.preview === furnishPreview;
  const byId = (id: string) => catalog.find((c) => c.id === id);
  const text = (k: keyof DesignWishes, v: string) => st.setWishes({ [k]: v.slice(0, MAX_FIELD) });
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || 'Raum ohne Namen';

  const clearPreview = () => {
    const old = useDesignStore.getState().preview;
    if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
  };

  const ask = async () => {
    if (!targets.length || st.asking) return;
    const types = targets.map((r) => roomTypes[r.id] ?? guessRoomType(r.name));
    const offer = preselect(products, types, w.budget);
    const plan = summarizePlan(project, { roomTypes, focusRoomId: scope === ALL ? null : scope });
    controller?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    try {
      const raw = await sample.json(buildDesignPrompt(w, plan, offer), { signal: ctl.signal, modelTier: 'complex' });
      const proposal = parseDesignAnswer(
        raw,
        plan,
        targets.map((r) => r.id),
        offer,
      );
      clearPreview();
      st.set({ asking: false, proposal, preview: null });
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort enthielt keine verwertbaren Möbel – bitte erneut versuchen.' });
    } finally {
      if (controller === ctl) controller = null;
    }
  };

  const proposal = st.proposal;
  const total = proposal ? proposalTotal(proposal, catalog) : null;

  const showPreview = () => {
    if (!proposal) return;
    const preview = suggestFurnishing(
      project,
      proposal.rooms
        .filter((r) => rooms.some((x) => x.id === r.roomId))
        .map((r) => ({
          roomId: r.roomId,
          type: r.type ?? roomTypes[r.roomId] ?? guessRoomType(roomName(r.roomId)),
          wishes: r.picks.map((p) => ({ catalogId: p.catalogId, quantity: p.quantity })),
        })),
      own,
    );
    labelPreview(preview, proposal);
    useFurnishStore.getState().setPreview(preview);
    st.set({ preview });
    if (!preview.items.length) useUiStore.getState().toast('Für diese Möbel wurde kein freier Platz gefunden.', 'info');
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

  const swap = (roomId: string, index: number, alt: number) => {
    if (!proposal) return;
    clearPreview();
    st.set({ proposal: swapPick(proposal, roomId, index, alt), preview: null });
    setOpenAlt(null);
  };

  return (
    <div className="assistant-panel" data-testid="design-panel">
      <Section title="Einrichtungsvorschlag mit Claude" actions={<Badge kind="info">ganze Wohnung</Badge>}>
        <p className="muted small">
          Du sagst, was dir wichtig ist – Claude richtet die ganze Wohnung (oder einen Raum) stimmig ein und sucht die Möbel selbst aus: deine IKEA- und Möbelix-Produkte, wo sie passen, sonst Platzhalter
          in passender Größe mit Suchlink zum Shop. Der Planer stellt alles kollisionsfrei auf. Claude bekommt nur die Raumzusammenfassung, deine Angaben und die Produktliste (Name, Maße, Preis) – keine
          Links, keinen Projektnamen. Die Anfrage läuft über dein Claude-Konto.
        </p>
        {rooms.length === 0 ? (
          <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>
        ) : (
          <>
            <SelectField label="Umfang" value={scope} options={[{ value: ALL, label: 'Ganze Wohnung' }, ...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' }))]} onChange={(v) => st.set({ scope: v })} />
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
                <input type="number" min={0} step={100} value={w.budget || 0} onChange={(e) => st.setWishes({ budget: Math.max(0, Number(e.target.value) || 0) })} />
              </span>
            </label>
            <SelectField label="Händler" value={w.retailer} options={RETAILER_CHOICES} onChange={(v) => st.setWishes({ retailer: v })} />
            <p className="muted small" data-testid="design-own-count">
              {products.length ? `${products.length === 1 ? '1 eigenes Produkt' : `${products.length} eigene Produkte`} aus deiner Auswahl kommen in Frage, der Rest wird als Platzhalter geplant.` : 'Noch keine eigenen IKEA-/Möbelix-Produkte: Claude plant mit Platzhaltern und Suchlinks (Produkte übernimmst du unter Katalog › IKEA bzw. Möbelix).'}
            </p>
            <div className="btn-row">
              <button className="primary" disabled={st.asking} onClick={() => void ask()}>
                {st.asking ? 'Claude richtet ein…' : proposal ? 'Neu einrichten lassen' : 'Einrichten lassen'}
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
        {proposal && total && (
          <div className="assistant-card" data-testid="design-proposal">
            <h4>Einrichtungsvorschlag</h4>
            <Badge kind="info">Vorschlag von Claude – bitte selbst prüfen</Badge>
            {proposal.summary && <p>{proposal.summary}</p>}
            {proposal.rooms.map((r) => (
              <div key={r.roomId} className="design-room" data-testid="design-room">
                <h5>{roomName(r.roomId)}</h5>
                {r.concept && <p className="muted">{r.concept}</p>}
                <ul className="assistant-list">
                  {r.picks.map((p, i) => {
                    const key = `${r.roomId}:${i}`;
                    return (
                      <li key={key} data-testid="design-pick" data-placeholder={p.placeholder ? 'yes' : 'no'}>
                        <PickLine option={p} quantity={p.quantity} item={byId(p.catalogId)} retailer={w.retailer} />
                        {p.alternatives.length > 0 && (
                          <>
                            <button className="small" aria-expanded={openAlt === key} onClick={() => setOpenAlt(openAlt === key ? null : key)}>
                              {openAlt === key ? 'Alternativen ausblenden' : `Alternativen (${p.alternatives.length})`}
                            </button>
                            {openAlt === key && (
                              <ul className="design-alternatives" data-testid="design-alternatives">
                                {p.alternatives.map((a, k) => (
                                  <li key={a.catalogId}>
                                    <PickLine option={a} quantity={p.quantity} item={byId(a.catalogId)} retailer={w.retailer} />
                                    <button className="small" onClick={() => swap(r.roomId, i, k)}>
                                      Stattdessen nehmen
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
            <p>
              Eigene Produkte laut Produktseiten: <strong data-testid="design-total">{formatEuro(total.real)}</strong>
              {total.placeholder > 0 && (
                <>
                  {' '}
                  · Platzhalter ca. <strong data-testid="design-total-placeholder">{formatEuro(total.placeholder)}</strong> <span className="muted">(Richtwerte, keine Angebote)</span>
                </>
              )}
              {total.unpriced > 0 && <span className="muted"> · {total.unpriced === 1 ? '1 Stück' : `${total.unpriced} Stück`} ohne Preis</span>}
              {w.budget > 0 && total.real + total.placeholder > w.budget && <span className="warning"> – über dem Budget von {formatEuro(w.budget)}</span>}
            </p>
            {proposal.dropped > 0 && <p className="muted">{proposal.dropped === 1 ? 'Ein genannter Eintrag war' : `${proposal.dropped} genannte Einträge waren`} nicht in den Listen – weggelassen.</p>}
            {!previewActive ? (
              <div className="btn-row">
                <button onClick={showPreview}>Vorschau im Plan</button>
              </div>
            ) : (
              st.preview && (
                <div className="assistant-preview" data-testid="design-preview">
                  <Badge kind="info">noch nicht übernommen</Badge>
                  <p>{st.preview.items.length ? `${st.preview.items.length} Möbel kollisionsfrei aufgestellt.` : 'Kein freier Platz gefunden.'}</p>
                  {st.preview.rooms
                    .filter((x) => x.missing.length)
                    .map((x) => (
                      <p key={x.roomId} className="warning">
                        {x.roomName || 'Raum'}: kein freier Platz für {x.missing.join(', ')}
                      </p>
                    ))}
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

function PickLine({ option, quantity, item, retailer }: { option: DesignOption; quantity: number; item?: CatalogItem; retailer: RetailerChoice }) {
  if (!item) return null;
  const size = `${cm(item.width)}×${cm(item.depth)}×${cm(item.height)} cm`;
  const count = quantity > 1 ? `${quantity}× ` : '';
  return (
    <div className="design-pick">
      {option.placeholder ? (
        <>
          <strong>
            {count}
            {option.label}
          </strong>{' '}
          <Badge kind="muted">Platzhalter</Badge>{' '}
          <span className="muted">
            ({item.name}, {size}
            {item.price ? `, Richtwert ${formatEuro(item.price.amount)}` : ''})
          </span>{' '}
          {searchLinks(option.search, retailer).map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer noopener" className="design-link">
              {l.label}
            </a>
          ))}
        </>
      ) : (
        <>
          <strong>
            {count}
            {item.name}
          </strong>{' '}
          <span className="muted">
            ({retailerOf(item)}, {size}, {item.price ? formatEuro(item.price.amount) : 'Preis unbekannt'})
          </span>{' '}
          {item.productUrl && (
            <a href={item.productUrl} target="_blank" rel="noreferrer noopener" className="design-link">
              Produktseite
            </a>
          )}
        </>
      )}
      {option.reason && <p>{option.reason}</p>}
    </div>
  );
}
