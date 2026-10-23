import { useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import type { CatalogItem } from '../catalog/types';
import { formatEuro } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import type { PlanZone } from '../model/schema';
import { applyFurnishing, guessRoomType, suggestedIn, suggestFurnishing, type FurnishingSuggestion } from '../suggest/furnishing';
import { useFurnishStore } from '../suggest/furnishStore';
import { Badge, Section, SelectField } from '../ui/fields';
import { addIkeaArticles } from '../catalog/ikeaSelection';
import { errorText, HIDE_CODES, loadMcp, loadSample, missingClaude, type McpRuntime, type Sample, type SampleError } from './claude';
import {
  browserAvailable,
  browserTools,
  buildFindPrompt,
  FOUND_SOURCE,
  foundToCatalog,
  ITEM_TIMEOUT_MS,
  MAX_AUTO_SEARCH,
  notFoundReason,
  openPlaceholders,
  searchErrorReason,
  parseFound,
  replaceKitchenWithFound,
  replaceWithFound,
  searchLeft,
  searchTargets,
  TOTAL_TIMEOUT_MS,
  type FoundProduct,
  type SearchTarget,
} from './productSearch';
import { furnishWithKitchens, kitchenShoppingList, resolveWith, runLength, type DesignKitchen, type KitchenPart, type Resolve } from './kitchenDesign';
import {
  MAX_FIELD,
  PLACEHOLDERS,
  proposalTotal,
  QUALITY_CHOICES,
  realProducts,
  RETAILER_CHOICES,
  retailerOf,
  searchLinks,
  STYLES,
  swapPick,
  type DesignBrief,
  type DesignOption,
  type DesignProposal,
  type DesignRoom,
  type DesignWishes,
  type RetailerChoice,
} from './design';
import { implausibleSize } from './designGuide';
import { designWishes, runDesign } from './designRun';
import { useDesignStore } from './designStore';
import { runPool } from './pool';
import './assistant.css';

const ALL = '__all';
/** Pieces searched at the same time with local Claude Code. */
const SEARCH_PARALLEL = 3;
let controller: AbortController | null = null;
let searchCtl: AbortController | null = null;

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
  const [checked, setChecked] = useState(false);
  const [missing, setMissing] = useState<'helper' | 'claude'>('helper');
  const [openAlt, setOpenAlt] = useState<string | null>(null);
  const [mcp, setMcp] = useState<McpRuntime | null>(null);
  const [browser, setBrowser] = useState(false);
  const [search, setSearch] = useState<{ done: number; total: number; current: string } | null>(null);
  const [designProgress, setDesignProgress] = useState<{ done: number; total: number } | null>(null);
  const [notFound, setNotFound] = useState<Map<string, NotFound>>(new Map());
  const [skipped, setSkipped] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  /** „Gefällt mir nicht“ (#350): room whose comment field is open, the comment, the room being redone. */
  const [dislike, setDislike] = useState<{ roomId: string; text: string } | null>(null);
  const [redoing, setRedoing] = useState<string | null>(null);
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
  // kitchen modules: generic modules and products found for them (not part of `own`)
  const resolve = useMemo(() => resolveWith(items), [items]);

  useEffect(() => {
    let live = true;
    void loadSample().then(async (s) => {
      const why = s ? null : await missingClaude();
      if (!live) return;
      if (why) setMissing(why);
      setSample(s);
      setChecked(true);
    });
    void loadMcp().then(async (m) => {
      const ok = await browserAvailable(m);
      if (live) {
        setMcp(m);
        setBrowser(ok);
      }
    });
    return () => {
      live = false;
    };
  }, []);

  if (hidden || !checked) return null;
  if (!sample) {
    return (
      <div className="assistant-panel" data-testid="design-panel-unavailable">
        <Section title="Einrichtungsvorschlag mit Claude" actions={<Badge kind="info">ganze Wohnung</Badge>}>
          <p className="muted small">Claude richtet die ganze Wohnung (oder einen Raum) ein und sucht dafür echte IKEA-/Möbelix-Produkte. Dafür braucht der Planer eine Verbindung zu Claude – die fehlt gerade:</p>
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
  const targets = scope === ALL ? rooms : rooms.filter((r) => r.id === scope);
  const previewActive = st.preview !== null && st.preview === furnishPreview;
  const byId = (id: string) => catalog.find((c) => c.id === id);
  const text = (k: keyof DesignWishes, v: string) => st.setWishes({ [k]: v.slice(0, MAX_FIELD) });
  const roomName = (id: string) => rooms.find((r) => r.id === id)?.name || 'Raum ohne Namen';

  const clearPreview = () => {
    const old = useDesignStore.getState().preview;
    if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
  };

  const ask = async (redo?: { roomId: string; feedback: string }) => {
    if (!targets.length || st.asking) return;
    controller?.abort();
    searchCtl?.abort();
    const ctl = new AbortController();
    controller = ctl;
    st.set({ asking: true, error: null });
    setDesignProgress(null);
    setRedoing(redo?.roomId ?? null);
    let made: DesignProposal | null = null;
    try {
      const { proposal: fresh, failedRooms } = await runDesign({
        sample,
        project,
        roomIds: redo ? [redo.roomId] : targets.map((r) => r.id),
        roomTypes,
        wishes: w,
        products,
        ...(redo?.feedback ? { feedback: redo.feedback } : {}),
        signal: ctl.signal,
        onProgress: (done, total) => setDesignProgress({ done, total }),
      });
      if (failedRooms.length) useUiStore.getState().toast(`Für ${failedRooms.map(roomName).join(', ')} kam keine verwertbare Antwort – dafür bitte den Raum einzeln einrichten lassen.`, 'info');
      // one room redone: it replaces its old version, the other rooms stay as they are
      const old = useDesignStore.getState().proposal;
      const proposal: DesignProposal =
        redo && old ? { ...old, rooms: old.rooms.map((r) => (r.roomId === redo.roomId ? (fresh.rooms.find((x) => x.roomId === r.roomId) ?? r) : r)) } : fresh;
      clearPreview();
      setNotFound(new Map());
      setSkipped(0);
      setNote(null);
      setDislike(null);
      st.set({ asking: false, proposal, preview: null });
      // the automatic product search then only runs for the redone room
      made = redo ? { ...proposal, rooms: proposal.rooms.filter((r) => r.roomId === redo.roomId) } : proposal;
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
      setRedoing(null);
    }
    // one step: plan with real products right away; placeholders stay only for pieces that are not found
    if (made && searchMode && w.searchReal) {
      const { targets: found, skipped: rest } = searchTargets(made, (id) => {
        const c = catalog.find((x) => x.id === id) ?? resolve(id);
        return c ? c.width * c.depth * c.height : 0;
      });
      setSkipped(rest);
      void findReal(found);
    }
  };

  const proposal = st.proposal;
  const total = proposal ? proposalTotal(proposal, catalog) : null;

  const showPreview = () => {
    if (!proposal) return;
    const inPlan = proposal.rooms.filter((r) => rooms.some((x) => x.id === r.roomId));
    const typeOf = (r: (typeof inPlan)[number]) => r.type ?? roomTypes[r.roomId] ?? guessRoomType(roomName(r.roomId));
    // a new preview replaces what an earlier, applied suggestion put into these rooms (#350) – never stacks on it
    const replace = suggestedIn(project, inPlan.map((r) => r.roomId));
    const gone = new Set(replace);
    const base = replace.length ? { ...project, furniture: project.furniture.filter((f) => !gone.has(f.id)) } : project;
    // kitchen runs first (against their wall), the other furniture around them
    const built = furnishWithKitchens(
      base,
      inPlan.flatMap((r) => (r.kitchen ? [{ roomId: r.roomId, roomName: roomName(r.roomId), type: typeOf(r), kitchen: r.kitchen }] : [])),
      resolve,
      (draft) =>
        suggestFurnishing(
          draft,
          inPlan.map((r) => ({ roomId: r.roomId, type: typeOf(r), wishes: designWishes(r) })),
          own,
        ),
    );
    const preview: FurnishingSuggestion = { ...built, replaces: replace };
    labelPreview(preview, proposal);
    useFurnishStore.getState().setPreview(preview);
    st.set({ preview });
    if (!preview.items.length) useUiStore.getState().toast('Für diese Möbel wurde kein freier Platz gefunden – die Gründe stehen beim Vorschlag.', 'info');
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

  // real products instead of placeholders (#350, stage 3): browser of the Claude desktop app, or Claude Code locally
  const searchMode: 'browser' | 'web' | null = sample.kind === 'local' ? 'web' : browser && mcp ? 'browser' : null;

  /** Found products → catalogue ids; locally IKEA pages are read again by the helper (exact data and 3D model). */
  const toCatalog = async (found: FoundProduct[], placeholder: CatalogItem): Promise<{ id: string; why: string }[]> => {
    const out: { id: string; why: string }[] = [];
    const add: CatalogItem[] = [];
    for (const f of found) {
      if (searchMode === 'web' && f.shop === 'IKEA') {
        const { outcomes } = await addIkeaArticles(f.url, { model: true }).catch(() => ({ outcomes: [] }));
        const ok = outcomes.find((o) => o.ok && o.id);
        const imported = ok?.id ? useCatalogStore.getState().items.find((c) => c.id === ok.id) : undefined;
        // a product whose page height is only the seat or the top would stand squashed (#350): skipped
        if (ok?.id && !(imported && implausibleSize(imported))) {
          out.push({ id: ok.id, why: f.why });
          continue;
        }
        if (ok?.id) continue;
      }
      const item = foundToCatalog(f, placeholder);
      if (implausibleSize(item)) continue;
      add.push(item);
      out.push({ id: item.id, why: f.why });
    }
    if (add.length) await useCatalogStore.getState().addItems(add);
    return out;
  };

  const findReal = async (targets: SearchTarget[]) => {
    if (!searchMode || search || !targets.length) return;
    clearPreview();
    st.set({ preview: null });
    const ctl = new AbortController();
    searchCtl = ctl;
    const missed = new Map(notFound);
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const active = new Set<string>();
    let finished = 0;
    let halt = false;
    let late = false;
    setNote(null);
    const show = () => setSearch({ done: finished, total: targets.length, current: [...active].join(', ') });
    const one = async (t: SearchTarget) => {
      const current = useDesignStore.getState().proposal;
      const room = current?.rooms.find((r) => r.roomId === t.roomId);
      const part = t.kitchen && room?.kitchen ? kitchenShoppingList(room.kitchen).find((x) => x.key === t.kitchen)?.part : undefined;
      const pick = t.kitchen ? (part && part.catalogId === part.base ? kitchenOption(part, room!.kitchen!) : undefined) : room?.picks[t.index];
      const placeholder = t.kitchen ? (part ? resolve(part.base) : undefined) : pick?.placeholder ? PLACEHOLDERS.find((c) => c.id === pick.catalogId) : undefined;
      if (!current || !pick || !placeholder) {
        finished++;
        return;
      }
      active.add(pick.label);
      show();
      // one piece may take at most ITEM_TIMEOUT_MS; the user's stop ends the whole search
      const item = new AbortController();
      const onStop = () => item.abort();
      ctl.signal.addEventListener('abort', onStop);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        item.abort();
      }, ITEM_TIMEOUT_MS);
      try {
        const prompt = buildFindPrompt(pick, placeholder, w, w.retailer, searchMode, roomName(t.roomId));
        const label = `Produktsuche: ${pick.label} (${searchLeft({ done: finished, total: targets.length })})`;
        const raw = await sample.json(prompt, searchMode === 'browser' ? { signal: item.signal, tools: browserTools(mcp!) } : { signal: item.signal, web: true, label });
        const parsed = parseFound(raw);
        const found = await toCatalog(parsed, placeholder);
        const latest = useDesignStore.getState().proposal;
        if (found.length && latest) {
          st.set({ proposal: t.kitchen ? replaceKitchenWithFound(latest, t.roomId, t.kitchen, found) : replaceWithFound(latest, t.roomId, t.index, found) });
          missed.delete(targetKey(t));
        } else missed.set(targetKey(t), { name: pick.label, room: roomName(t.roomId), reason: notFoundReason(raw, parsed.length) });
      } catch (e) {
        const code = (e as SampleError | undefined)?.code;
        if (code === 'cancelled' && !timedOut) halt = true;
        else if (code === 'tools_unavailable' || (code && HIDE_CODES.includes(code))) {
          halt = true;
          setBrowser(false);
          setNote('Die Produktsuche ist hier nicht verfügbar (nur in der Claude-Desktop-App bzw. mit Claude Code am PC) – es bleiben Platzhalter mit Suchlink.');
        } else {
          missed.set(targetKey(t), { name: pick.label, room: roomName(t.roomId), reason: timedOut ? `Zeitlimit von ${Math.round(ITEM_TIMEOUT_MS / 60_000)} Minuten überschritten` : searchErrorReason(e) });
          if (code === 'rate_limited' && !halt) {
            halt = true;
            useUiStore.getState().toast(errorText(e), 'info');
            setNote('Claude-Kontingent erreicht – die übrigen Platzhalter bleiben stehen; später mit „Nachsuchen“ fortsetzen.');
          }
        }
      } finally {
        clearTimeout(timer);
        ctl.signal.removeEventListener('abort', onStop);
        active.delete(pick.label);
        finished++;
        show();
      }
    };
    try {
      // browser of the desktop app: one tab, so one piece at a time; local Claude Code: a few at once
      await runPool(targets, searchMode === 'web' ? SEARCH_PARALLEL : 1, one, () => {
        if (!late && Date.now() > deadline) {
          late = true;
          setNote('Die Suche wurde nach 20 Minuten beendet; übrige Platzhalter kannst du mit „Nachsuchen“ erneut versuchen.');
        }
        return halt || late || ctl.signal.aborted;
      });
    } finally {
      if (searchCtl === ctl) searchCtl = null;
      setNotFound(missed);
      setSearch(null);
      const fresh = targets.filter((t) => missed.has(targetKey(t))).length;
      if (fresh) useUiStore.getState().toast(`${fresh === 1 ? '1 Produkt' : `${fresh} Produkte`} nicht gefunden – welche und warum, steht im Vorschlag unter „Nicht gefunden“.`, 'info');
    }
  };

  const placeholders = proposal ? openPlaceholders(proposal) : [];

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
            {searchMode ? (
              <>
                <SelectField
                  label="Ablauf"
                  value={w.searchReal ? 'direct' : 'later'}
                  options={[
                    { value: 'direct', label: 'Direkt mit echten Produkten (Claude sucht gleich im Shop)' },
                    { value: 'later', label: 'Erst Vorschlag, dann suchen (Platzhalter, echte Produkte auf Knopfdruck)' },
                  ]}
                  onChange={(v) => st.setWishes({ searchReal: v === 'direct' })}
                />
                <p className="muted small" data-testid="design-mode-hint">
                  {w.searchReal
                    ? `Claude plant und sucht dann für die Platzhalter echte Produkte (je Möbel etwa eine Minute, höchstens ${MAX_AUTO_SEARCH} Stück je Lauf).`
                    : 'Du bekommst zuerst den Vorschlag mit Platzhaltern und kannst dann für einzelne Möbel oder für alle echte Produkte suchen lassen.'}
                </p>
              </>
            ) : (
              <p className="muted small" data-testid="design-no-search">
                Ohne Helfer bzw. Claude-Desktop-App plant Claude nur mit deinen eigenen Produkten und Platzhaltern. Für echte Produkte: <code>npm run ikea-helper</code> starten oder das Artefakt in der Claude-Desktop-App öffnen.
              </p>
            )}
            <SelectField label="Umfang" value={scope} options={[{ value: ALL, label: 'Ganze Wohnung' }, ...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' }))]} onChange={(v) => st.set({ scope: v })} />
            <p className="muted small" data-testid="design-zones">
              {project.zones.length
                ? `Markierte Bereiche (verbindlich für Claude): ${project.zones.map((z, i) => `${i + 1} ${z.purpose || 'ohne Angabe'}`).join(' · ')}. `
                : 'Tipp: Unter Werkzeuge › „Bereich“ kannst du im Plan Bereiche aufziehen und dazuschreiben, wofür sie sind (z. B. Arbeitsecke) – Claude plant sie verbindlich ein. '}
              <button className="link-btn" onClick={() => useUiStore.getState().setTool('zone')} data-testid="design-zone-tool">
                Bereich markieren
              </button>
            </p>
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
            <SelectField label="Qualität" value={w.quality ?? 'thorough'} options={QUALITY_CHOICES} onChange={(v) => st.setWishes({ quality: v })} />
            <p className="muted small" data-testid="design-quality-hint">
              {w.quality === 'fast'
                ? 'Eine Runde: Claude plant jeden Raum nach Leitfaden und Regeln des Raumtyps, der Planer ergänzt Fehlendes.'
                : `Zwei Runden: Claude plant jeden Raum nach Leitfaden, der Planer stellt auf, dann prüft Claude die Aufstellung mit einer Prüfliste und bessert nach.${sample.kind === 'local' ? ' Im lokalen Planer mit dem Modell Opus.' : ' Im Artefakt mit der höchsten Modellstufe.'}`}
            </p>
            <p className="muted small" data-testid="design-own-count">
              {products.length ? `${products.length === 1 ? '1 eigenes Produkt' : `${products.length} eigene Produkte`} aus deiner Auswahl kommen in Frage, der Rest wird als Platzhalter geplant.` : 'Noch keine eigenen IKEA-/Möbelix-Produkte: Claude plant mit Platzhaltern und Suchlinks (Produkte übernimmst du unter Katalog › IKEA bzw. Möbelix).'}
            </p>
            <div className="btn-row">
              <button className="primary" disabled={st.asking || !!search} onClick={() => void ask()}>
                {st.asking ? `Claude richtet ein…${designProgress && designProgress.total > 1 ? ` (${designProgress.done}/${designProgress.total} Schritte)` : ''}` : search ? 'Suche läuft…' : proposal ? 'Neu einrichten lassen' : 'Einrichten lassen'}
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
                <h5>
                  {roomName(r.roomId)} {r.reviewed && <Badge kind="muted" title="Claude hat die Aufstellung mit der Prüfliste nachgeprüft.">nachgeprüft</Badge>}
                </h5>
                {r.concept && <p className="muted">{r.concept}</p>}
                {r.brief && <BriefView brief={r.brief} />}
                {r.fixes && r.fixes.length > 0 && (
                  <div className="design-fixes" data-testid="design-fixes">
                    <strong className="small">Planer-Prüfung:</strong>
                    <ul className="small">
                      {r.fixes.map((f, i) => (
                        <li key={i}>
                          {f.kind === 'added' ? 'ergänzt' : 'weggelassen'}: {f.name} – {f.why}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <DislikeRow room={r} open={dislike?.roomId === r.roomId ? dislike.text : null} busy={st.asking || !!search} redoing={redoing === r.roomId} onOpen={() => setDislike({ roomId: r.roomId, text: '' })} onText={(text) => setDislike({ roomId: r.roomId, text })} onCancel={() => setDislike(null)} onRedo={(feedback) => void ask({ roomId: r.roomId, feedback })} />
                <ul className="assistant-list">
                  {r.picks.map((p, i) => {
                    const key = `${r.roomId}:${i}`;
                    return (
                      <li key={key} data-testid="design-pick" data-placeholder={p.placeholder ? 'yes' : 'no'}>
                        <PickLine option={p} quantity={p.quantity} item={byId(p.catalogId)} retailer={w.retailer} />
                        {p.zone && <ZoneBadge zones={project.zones} id={p.zone} />}
                        {p.placeholder && notFound.has(key) && <p className="warning small" data-testid="design-notfound">Nicht gefunden: {notFound.get(key)!.reason} – bleibt Platzhalter, Suchlink siehe oben.</p>}
                        {p.placeholder && searchMode && !search && (
                          <button className="small" onClick={() => void findReal([{ roomId: r.roomId, index: i }])}>
                            {notFound.has(key) ? 'Nochmal suchen' : 'Echtes Produkt suchen'}
                          </button>
                        )}
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
                                    <button className="small" disabled={!!search} onClick={() => swap(r.roomId, i, k)}>
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
                {r.kitchen && (
                  <KitchenBlock
                    kitchen={r.kitchen}
                    resolve={resolve}
                    retailer={w.retailer}
                    notFound={(key) => notFound.get(targetKey({ roomId: r.roomId, index: -1, kitchen: key }))?.reason}
                    onSearch={searchMode && !search ? (key) => void findReal([{ roomId: r.roomId, index: -1, kitchen: key }]) : undefined}
                  />
                )}
              </div>
            ))}
            {placeholders.length > 0 && (
              <div className="design-search" data-testid="design-search">
                {searchMode ? (
                  search ? (
                    <>
                      <p data-testid="design-search-progress">
                        Produktsuche: <strong>{searchLeft(search)}</strong>{search.current ? ` – gerade: ${search.current}` : ''} …
                      </p>
                      <progress max={search.total} value={search.done} aria-label="Fortschritt der Produktsuche" />
                      <button onClick={() => searchCtl?.abort()}>Suche stoppen</button>
                    </>
                  ) : (
                    <button className="primary" onClick={() => void findReal(placeholders.map(({ catalogId: _id, ...t }) => t))}>
                      {w.searchReal ? 'Nachsuchen' : 'Alle suchen'} ({placeholders.length === 1 ? '1 Platzhalter' : `${placeholders.length} Platzhalter`})
                    </button>
                  )
                ) : (
                  <p className="muted small">
                    Echte Produkte statt Platzhalter sucht Claude in der Claude-Desktop-App (eingebauter Browser) oder im lokalen Planer mit Claude Code und „npm run ikea-helper“.
                    <br />
                    Claude Code fehlt noch? Windows: in PowerShell <code>irm https://claude.ai/install.ps1 | iex</code> (oder <code>npm install -g @anthropic-ai/claude-code</code>), neues Terminal öffnen, <code>claude</code> eingeben und einmal anmelden, dann <code>npm run ikea-helper</code> neu starten. Prüfen: <code>npm run ikea-helper -- --check</code>.
                  </p>
                )}
                {skipped > 0 && !search && <p className="muted small">{skipped === 1 ? 'Ein Platzhalter' : `${skipped} Platzhalter`} über der Obergrenze von {MAX_AUTO_SEARCH} Suchen – mit „Nachsuchen“ nachholen.</p>}
                {note && <p className="warning small" role="status">{note}</p>}
                {!search && notFound.size > 0 && (
                  <div className="warning small" data-testid="design-notfound-list">
                    <p>Nicht gefunden ({notFound.size}):</p>
                    <ul className="plain">
                      {[...notFound.entries()].map(([k, n]) => (
                        <li key={k}>
                          {n.name} ({n.room}): {n.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {searchMode && !search && <p className="muted small">Claude öffnet dazu Such- und Produktseiten von IKEA bzw. Möbelix und liest Name, Maße und Preis ab (dauert je Möbel etwa eine Minute, braucht Claude-Kontingent).</p>}
              </div>
            )}
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
            {scope !== ALL && !proposal.rooms.some((r) => r.roomId === scope) && (
              <p className="warning small" data-testid="design-scope-hint">
                Dieser Vorschlag gilt für {proposal.rooms.map((r) => roomName(r.roomId)).join(', ')} – für „{roomName(scope)}“ bitte „Neu einrichten lassen“.
              </p>
            )}
            {!previewActive ? (
              <div className="btn-row">
                <button disabled={!!search} onClick={showPreview}>
                  Vorschau im Plan
                </button>
              </div>
            ) : (
              st.preview && (
                <div className="assistant-preview" data-testid="design-preview">
                  <Badge kind="info">noch nicht übernommen</Badge>
                  <p>{st.preview.items.length ? `${st.preview.items.length} Möbel kollisionsfrei aufgestellt.` : 'Kein freier Platz gefunden – die Gründe stehen unten.'}</p>
                  {(st.preview.replaces?.length ?? 0) > 0 && (
                    <p className="muted small" data-testid="design-replaces">
                      Ersetzt {st.preview.replaces!.length === 1 ? 'ein Möbel' : `${st.preview.replaces!.length} Möbel`} aus dem letzten Vorschlag in diesen Räumen (im Plan ausgeblendet; selbst platzierte Möbel bleiben).
                    </p>
                  )}
                  {st.preview.rooms
                    .filter((x) => x.missing.length)
                    .map((x) => (
                      <div key={x.roomId} className="warning" data-testid="design-missing">
                        <strong>{x.roomName || 'Raum'} – kein Platz für:</strong>
                        <ul className="small">
                          {(x.notes?.length ? x.notes : x.missing.map((name) => ({ name, why: 'kein freier Platz' }))).map((n, i) => (
                            <li key={i}>
                              {n.name}: {n.why}
                            </li>
                          ))}
                        </ul>
                      </div>
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

/** A piece the product search did not find, with the reason shown to the user. */
interface NotFound {
  name: string;
  room: string;
  reason: string;
}

const targetKey = (t: SearchTarget) => (t.kitchen ? `${t.roomId}:k:${t.kitchen}` : `${t.roomId}:${t.index}`);

/** A kitchen part as search request: Claude's description plus the fronts of the whole kitchen. */
function kitchenOption(part: KitchenPart, kitchen: DesignKitchen): DesignOption {
  return { catalogId: part.base, reason: kitchen.fronts ? `Küche: ${kitchen.fronts}` : 'Modul der Küchenzeile', placeholder: true, label: part.label, search: part.search };
}

/** The kitchen run of a room: rows with their length, one line per distinct module (placeholder with search link, or the found product). */
function KitchenBlock({ kitchen, resolve, retailer, notFound, onSearch }: { kitchen: DesignKitchen; resolve: Resolve; retailer: RetailerChoice; notFound: (key: string) => string | undefined; onSearch?: (key: string) => void }) {
  return (
    <div className="design-kitchen" data-testid="design-kitchen">
      <h6>
        Küchenzeile{' '}
        <span className="design-swatch" style={{ background: kitchen.frontColor }} title={`Frontfarbe ${kitchen.frontColor}`} aria-hidden="true" />
      </h6>
      {kitchen.fronts && <p>{kitchen.fronts}</p>}
      {kitchen.reason && <p className="muted">{kitchen.reason}</p>}
      <p className="muted small">
        {kitchen.runs.map((run, i) => `${kitchen.runs.length > 1 ? `Zeile ${i + 1}: ` : ''}${cm(runLength(run, resolve))} cm`).join(' · ')} · Arbeitsplatte erzeugt der Planer (Richtwert). Die Wand sucht der Planer in der Vorschau aus.
      </p>
      <ul className="assistant-list">
        {kitchenShoppingList(kitchen).map(({ part, key, count }) => {
          const item = resolve(part.catalogId);
          const placeholder = part.catalogId === part.base;
          return (
            <li key={key} data-testid="design-kitchen-part" data-placeholder={placeholder ? 'yes' : 'no'}>
              <PickLine option={{ catalogId: part.catalogId, reason: '', placeholder, label: part.label, search: part.search }} quantity={count} item={item} retailer={retailer} />
              {placeholder && notFound(key) && <p className="warning small" data-testid="design-notfound">Nicht gefunden: {notFound(key)} – bleibt Platzhalter.</p>}
              {placeholder && onSearch && (
                <button className="small" onClick={() => onSearch(key)}>
                  {notFound(key) ? 'Nochmal suchen' : 'Echtes Produkt suchen'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
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
          {item.sourceName === FOUND_SOURCE && (
            <>
              <Badge kind="info" title="Von Claude auf der Produktseite gelesen – Maße und Preis bitte dort prüfen.">
                von Claude gefunden
              </Badge>{' '}
            </>
          )}
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

/** Marked area (#416) a pick belongs to. */
function ZoneBadge({ zones, id }: { zones: PlanZone[]; id: string }) {
  const i = zones.findIndex((z) => z.id === id);
  if (i < 0) return null;
  return (
    <Badge kind="info" title="Der Planer stellt dieses Möbel nur in diesem markierten Bereich auf.">
      Bereich {i + 1}: {zones[i].purpose || 'ohne Angabe'}
    </Badge>
  );
}

function BriefView({ brief }: { brief: DesignBrief }) {
  return (
    <div className="design-brief" data-testid="design-brief">
      <strong className="small">Leitfaden</strong>
      <ul className="small">
        {brief.purpose && <li>Zweck: {brief.purpose}</li>}
        {brief.zones.length > 0 && <li>Zonen: {brief.zones.join(' · ')}</li>}
        {brief.focus && <li>Blickfang: {brief.focus}</li>}
        {brief.paths && <li>Laufwege: {brief.paths}</li>}
        {brief.palette.length > 0 && <li>Farben: {brief.palette.join(', ')}</li>}
        {brief.decor && <li>Deko: {brief.decor}</li>}
      </ul>
    </div>
  );
}

/** „Gefällt mir nicht“ (#350): a short comment, then only this room is planned again. */
function DislikeRow({
  room,
  open,
  busy,
  redoing,
  onOpen,
  onText,
  onCancel,
  onRedo,
}: {
  room: DesignRoom;
  open: string | null;
  busy: boolean;
  redoing: boolean;
  onOpen: () => void;
  onText: (t: string) => void;
  onCancel: () => void;
  onRedo: (feedback: string) => void;
}) {
  if (redoing) return <p className="muted small">Claude plant den Raum neu …</p>;
  if (open === null)
    return (
      <div className="btn-row">
        <button className="small" disabled={busy} onClick={onOpen} data-testid="design-dislike">
          Gefällt mir nicht
        </button>
      </div>
    );
  return (
    <div className="design-dislike" data-room={room.roomId}>
      <label className="field">
        <span className="field-label">Was soll anders werden?</span>
        <span className="field-input">
          <input type="text" value={open} maxLength={MAX_FIELD} placeholder="z. B. weniger vollgestellt, Sofa zum Fenster, mehr Stauraum" onChange={(e) => onText(e.target.value)} />
        </span>
      </label>
      <div className="btn-row">
        <button className="primary small" disabled={busy} onClick={() => onRedo(open.trim() || 'gefällt nicht – bitte ein anderes, stimmigeres Konzept')}>
          Raum neu planen
        </button>
        <button className="small" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
