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
  deviationText,
  FOUND_SOURCE,
  foundToCatalog,
  ITEM_TIMEOUT_LATE_MS,
  ITEM_TIMEOUT_MS,
  NOT_SOLD_TEXT,
  notSold,
  notFoundReason,
  openPlaceholders,
  searchErrorReason,
  searchWithRetry,
  type AttemptResult,
  type SearchOutcome,
  type RetryHint,
  parseFound,
  replaceKitchenWithFound,
  replaceWithFound,
  searchTargets,
  type FoundProduct,
  type ProductLook,
  type SearchTarget,
} from './productSearch';
import { furnishWithKitchens, kitchenShoppingList, resolveWith, runLength, type DesignKitchen, type KitchenPart, type Resolve } from './kitchenDesign';
import {
  MAX_FIELD,
  PLACEHOLDERS,
  proposalTotal,
  METHOD_CHOICES,
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
import { pickItems, placedRooms, proposalFrom, withProduct } from '../design/apply/proposal';
import { roomShots } from './roomShots';
import { CompareVariants, type VariantKey } from './CompareVariants';
import { layoutSuggestion } from '../design/apply';
import { furnishingSheet } from '../design/apply/sheet';
import { downloadBlob } from '../ui/fileUtils';
import { svgToPng } from '../design/render';
import { runFurnishing, type Stage } from '../design/run';
import { paletteText, roomConceptOf } from '../design/concept/flatConcept';
import type { RoomReview } from '../design/types';
import { useDesignStore } from './designStore';
import { runSearchRounds, runText, type RoundRequest, type RunProgress } from './searchRun';
import './assistant.css';

const ALL = '__all';

/** What the panel says while a stage of the new run is going on. */
const STAGE_TEXT: Record<Stage, string> = {
  read: 'Räume lesen',
  concept: 'Wohnkonzept',
  program: 'Raumprogramme',
  place: 'Aufstellen',
  review: 'Begehung',
  critique: 'Nachbessern',
  done: 'Fertig',
};
/** Pieces searched at the same time with local Claude Code. */
const SEARCH_PARALLEL = 3;
let controller: AbortController | null = null;
let searchCtl: AbortController | null = null;

const FIELDS: { key: 'interests' | 'needs' | 'wants' | 'colors'; label: string; placeholder: string }[] = [
  { key: 'interests', label: 'Interessen / Hobbys', placeholder: 'z. B. Gaming, Lesen, Yoga\nein Stichpunkt pro Zeile' },
  { key: 'needs', label: 'Was du brauchst', placeholder: 'z. B. Schlafplatz für Gäste\nArbeitsplatz mit Monitor\nviel Stauraum' },
  { key: 'wants', label: 'Was du dir wünschst', placeholder: 'z. B. großes Sofa\nPflanzenecke am Fenster' },
  { key: 'colors', label: 'Farben (optional)', placeholder: 'z. B. Holz hell, Grün' },
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
  const [comparing, setComparing] = useState(false);
  const [openAlt, setOpenAlt] = useState<string | null>(null);
  const [mcp, setMcp] = useState<McpRuntime | null>(null);
  const [browser, setBrowser] = useState(false);
  const [search, setSearch] = useState<(RunProgress & { current: string }) | null>(null);
  const [designProgress, setDesignProgress] = useState<{ done: number; total: number } | null>(null);
  const [stage, setStage] = useState<string | null>(null);
  const [notFound, setNotFound] = useState<Map<string, NotFound>>(new Map());
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
  /** „Ideal“ (Claude's plan with placeholders) or „Kaufbar“ (real products, rooms placed anew), #436. */
  const showIdeal = st.variant === 'ideal' && !!st.ideal;
  const shownResult = showIdeal ? st.ideal!.result : st.result;
  /** Walk-through of a room, where the new way made the proposal. */
  const review = (id: string) => shownResult?.rooms.find((r) => r.roomId === id)?.review;
  /** Points of the ideal plan for a room, shown beside the buyable one when they differ. */
  const idealScore = (id: string) => (showIdeal ? undefined : st.ideal?.result.rooms.find((r) => r.roomId === id)?.review.score);
  const variant = (v: 'ideal' | 'kaufbar') => {
    if (v === st.variant) return;
    clearPreview();
    st.set({ variant: v, preview: null });
    setOpenAlt(null);
  };

  const clearPreview = () => {
    const old = useDesignStore.getState().preview;
    if (old && useFurnishStore.getState().preview === old) useFurnishStore.getState().setPreview(null);
  };

  /** The new way: the whole run, then its rooms as proposal and preview. */
  const askConcept = async (ctl: AbortController) => {
    try {
      const result = await runFurnishing({
        sample,
        project,
        wishes: w,
        roomIds: targets.map((r) => r.id),
        roomTypes,
        products,
        toImage: (plan) => svgToPng(plan),
        // the look sees the room in 3D, as the image review does (#443)
        toRoomShots: (room) => roomShots(room, own),
        signal: ctl.signal,
        onProgress: (p) => {
          setDesignProgress({ done: p.done, total: p.total });
          setStage(STAGE_TEXT[p.stage] + (p.room ? `: ${p.room}` : ''));
        },
      });
      const proposal = proposalFrom(result, project, roomTypes, own);
      clearPreview();
      setNotFound(new Map());
      setNote(null);
      setDislike(null);
      st.set({ asking: false, proposal, result, ideal: { result, proposal }, variant: 'kaufbar', preview: null });
      if (result.failed.length) useUiStore.getState().toast(`Für ${result.failed.map((f) => (f.roomId ? roomName(f.roomId) : 'die Wohnung')).join(', ')} kam keine verwertbare Antwort.`, 'info');
    } catch (e) {
      const code = (e as SampleError | undefined)?.code;
      if (code === 'cancelled') st.set({ asking: false });
      else if (code && HIDE_CODES.includes(code)) {
        st.set({ asking: false });
        setHidden(true);
        useUiStore.getState().toast(errorText(e), 'info');
      } else st.set({ asking: false, error: code ? errorText(e) : 'Die Antwort enthielt keinen verwertbaren Plan – bitte erneut versuchen.' });
    } finally {
      if (controller === ctl) controller = null;
      setStage(null);
      setRedoing(null);
    }
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
    // the new way (#442): concept, zones, millimetre-exact placement, walk-through and Claude's own correction
    if ((w.method ?? 'konzept') === 'konzept' && !redo) {
      await askConcept(ctl);
      return;
    }
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
      setNote(null);
      setDislike(null);
      st.set({ asking: false, proposal, ideal: null, variant: 'kaufbar', preview: null });
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
      const { targets: found } = searchTargets(made, (id) => {
        const c = catalog.find((x) => x.id === id) ?? resolve(id);
        return c ? c.width * c.depth * c.height : 0;
      });
      void findReal(found);
    }
  };

  const proposal = showIdeal ? st.ideal!.proposal : st.proposal;
  const total = proposal ? proposalTotal(proposal, catalog) : null;

  const showPreview = () => {
    if (!proposal) return;
    // the new way already placed every room millimetre-exact: take that, do not place again
    const result = shownResult;
    if (result) {
      const inPlan = placedRooms(result, roomTypes).filter((r) => rooms.some((x) => x.id === r.analysis.roomId));
      const preview = layoutSuggestion(project, inPlan, own);
      useFurnishStore.getState().setPreview(preview);
      st.set({ preview });
      if (!preview.items.length) useUiStore.getState().toast('Für diese Möbel wurde kein freier Platz gefunden – die Gründe stehen beim Vorschlag.', 'info');
      return;
    }
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

  /** Einrichtungsblatt of the shown version (#436): what goes where, to furnish the flat by. */
  const downloadSheet = () => {
    if (!shownResult) return;
    const names = Object.fromEntries(rooms.map((r) => [r.id, r.name]));
    downloadBlob(furnishingSheet(shownResult, names, catalog, undefined, showIdeal ? 'Ideal' : 'Kaufbar'), `einrichtungsblatt-${showIdeal ? 'ideal' : 'kaufbar'}.md`, 'text/markdown;charset=utf-8');
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

  /** „Diesen übernehmen“ in the side-by-side view: the whole version goes into the plan in one step. */
  const takeVariant = (v: VariantKey) => {
    const result = v === 'ideal' ? st.ideal?.result : st.result;
    if (!result) return;
    const inPlan = placedRooms(result, roomTypes).filter((r) => rooms.some((x) => x.id === r.analysis.roomId));
    const preview = layoutSuggestion(project, inPlan, own);
    clearPreview();
    let ids: string[] = [];
    apply((d) => {
      ids = applyFurnishing(d, preview);
    });
    st.set({ variant: v, preview: null });
    setComparing(false);
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast(`${ids.length} Möbel aus der Fassung „${v === 'ideal' ? 'Ideal' : 'Kaufbar'}“ übernommen – mit Strg+Z in einem Schritt rückgängig.`, 'success');
  };

  const discard = () => {
    if (previewActive) useFurnishStore.getState().setPreview(null);
    st.set({ preview: null });
  };

  /** The look a real product has to fit (#436): the style plan of the concept, the room's accent. */
  const lookOf = (roomId: string): ProductLook | null => {
    const run = useDesignStore.getState().result;
    if (!run) return null;
    const style = run.concept.style;
    const analysis = run.analysis.rooms.find((a) => a.roomId === roomId);
    const accent = analysis ? roomConceptOf(run.concept, analysis).accent : undefined;
    return {
      idea: style.idea,
      materials: style.materials,
      ...(style.forms ? { forms: style.forms } : {}),
      palette: style.palette.map(paletteText),
      ...(accent ? { accent } : {}),
    };
  };

  // real products instead of placeholders (#350, stage 3): browser of the Claude desktop app, or Claude Code locally
  const searchMode: 'browser' | 'web' | null = sample.kind === 'local' ? 'web' : browser && mcp ? 'browser' : null;

  /** Found products → catalogue ids; locally IKEA pages are read again by the helper (exact data and 3D model). */
  const toCatalog = async (found: FoundProduct[], placeholder: CatalogItem): Promise<{ id: string; why: string; deviation?: string }[]> => {
    const out: { id: string; why: string; deviation?: string }[] = [];
    // what differs from the planned piece (#436): sizes from the catalogue entry, the look in Claude's words
    const deviation = (it: CatalogItem | undefined, f: FoundProduct) => {
      const t = it ? deviationText(it, placeholder, f.deviation) : (f.deviation ?? '');
      return t ? { deviation: t } : {};
    };
    const add: CatalogItem[] = [];
    for (const f of found) {
      if (searchMode === 'web' && f.shop === 'IKEA') {
        const { outcomes } = await addIkeaArticles(f.url, { model: true }).catch(() => ({ outcomes: [] }));
        const ok = outcomes.find((o) => o.ok && o.id);
        const imported = ok?.id ? useCatalogStore.getState().items.find((c) => c.id === ok.id) : undefined;
        // a product whose page height is only the seat or the top would stand squashed (#350): skipped
        if (ok?.id && !(imported && implausibleSize(imported))) {
          out.push({ id: ok.id, why: f.why, ...deviation(imported, f) });
          continue;
        }
        if (ok?.id) continue;
      }
      const item = foundToCatalog(f, placeholder);
      if (implausibleSize(item)) continue;
      add.push(item);
      out.push({ id: item.id, why: f.why, ...deviation(item, f) });
    }
    if (add.length) await useCatalogStore.getState().addItems(add);
    return out;
  };

  /**
   * Searches real products for the given placeholders in one run (#350): rounds go on by themselves
   * until every piece is found or settled as „nicht gefunden“ (searchRun.ts); only the user's stop,
   * the Claude quota or Claude not being usable here end it early.
   */
  const findReal = async (targets: SearchTarget[]) => {
    if (!searchMode || search || !targets.length) return;
    clearPreview();
    st.set({ preview: null });
    const ctl = new AbortController();
    searchCtl = ctl;
    const missed = new Map(notFound);
    const active = new Set<string>();
    let progress: RunProgress = { done: 0, total: targets.length, round: 1 };
    let halt = false;
    setNote(null);
    const show = () => setSearch({ ...progress, current: [...active].join(', ') });
    const stopped = () => halt || ctl.signal.aborted;
    const one = async (t: SearchTarget, request: RoundRequest): Promise<SearchOutcome | null> => {
      const current = useDesignStore.getState().proposal;
      const room = current?.rooms.find((r) => r.roomId === t.roomId);
      const part = t.kitchen && room?.kitchen ? kitchenShoppingList(room.kitchen).find((x) => x.key === t.kitchen)?.part : undefined;
      const pick = t.kitchen ? (part && part.catalogId === part.base ? kitchenOption(part, room!.kitchen!) : undefined) : room?.picks[t.index];
      const placeholder = t.kitchen ? (part ? resolve(part.base) : undefined) : pick?.placeholder ? PLACEHOLDERS.find((c) => c.id === pick.catalogId) : undefined;
      if (!current || !pick || !placeholder || stopped()) return null;
      active.add(pick.label);
      show();
      const limit = request.round > 1 ? ITEM_TIMEOUT_LATE_MS : ITEM_TIMEOUT_MS;
      // each attempt may take at most `limit`; the user's stop ends the whole search
      const attempt = async (retry: RetryHint | null): Promise<AttemptResult> => {
        const item = new AbortController();
        const onStop = () => item.abort();
        ctl.signal.addEventListener('abort', onStop);
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          item.abort();
        }, limit);
        try {
          const prompt = buildFindPrompt(pick, placeholder, w, w.retailer, searchMode, roomName(t.roomId), retry, lookOf(t.roomId));
          const label = `Produktsuche: ${pick.label}${retry ? ` (Versuch ${retry.attempt})` : ''} (${runText(progress)})`;
          const raw = await sample.json(prompt, searchMode === 'browser' ? { signal: item.signal, tools: browserTools(mcp!) } : { signal: item.signal, web: true, label });
          const parsed = parseFound(raw);
          const found = await toCatalog(parsed, placeholder);
          const latest = useDesignStore.getState().proposal;
          if (!found.length || !latest) return { ok: false, reason: notFoundReason(raw, parsed.length) };
          // the new way (#442): the product goes into the programme and the room is placed and walked through again
          const run = useDesignStore.getState().result;
          if (run && !t.kitchen) {
            const line = latest.rooms.find((r) => r.roomId === t.roomId)?.picks[t.index];
            // the best hit first; when it does not fit the room, the next one (#436)
            let why = '';
            for (const [k, hit] of found.entries()) {
              const again = withProduct(run, project, { roomId: t.roomId, items: line ? pickItems(line) : [], catalogId: hit.id }, useCatalogStore.getState().items, roomTypes);
              if (!again.taken) {
                why ||= again.why ?? 'die Begehung fand einen Mangel';
                continue;
              }
              st.set({ result: again.result, proposal: replaceWithFound(latest, t.roomId, t.index, [hit, ...found.slice(0, k), ...found.slice(k + 1)]) });
              return { ok: true };
            }
            return { ok: false, reason: `passt nicht in den Raum: ${why}` };
          }
          st.set({ proposal: t.kitchen ? replaceKitchenWithFound(latest, t.roomId, t.kitchen, found) : replaceWithFound(latest, t.roomId, t.index, found) });
          return { ok: true };
        } catch (e) {
          if (timedOut && !ctl.signal.aborted) throw { code: 'timeout', limitMs: limit } satisfies SampleError & { limitMs: number };
          throw e;
        } finally {
          clearTimeout(timer);
          ctl.signal.removeEventListener('abort', onStop);
        }
      };
      try {
        const r = await searchWithRetry(attempt, { attempts: request.attempts, ...(request.after ? { after: request.after } : {}), signal: ctl.signal, stopped });
        if (r.ok) missed.delete(targetKey(t));
        else missed.set(targetKey(t), { name: pick.label, room: roomName(t.roomId), reason: r.reason, error: r.error });
        return r;
      } catch (e) {
        const code = (e as SampleError | undefined)?.code;
        if (code === 'cancelled') halt = true;
        else if (code === 'tools_unavailable' || (code && HIDE_CODES.includes(code))) {
          halt = true;
          setBrowser(false);
          setNote('Die Produktsuche ist hier nicht verfügbar (nur in der Claude-Desktop-App bzw. mit Claude Code am PC) – es bleiben Platzhalter mit Suchlink.');
        } else {
          missed.set(targetKey(t), { name: pick.label, room: roomName(t.roomId), reason: searchErrorReason(e), error: true });
          if (code === 'rate_limited' && !halt) {
            halt = true;
            useUiStore.getState().toast(errorText(e), 'info');
            setNote('Claude-Kontingent erreicht – die übrigen Platzhalter bleiben stehen; später mit „Nachsuchen“ fortsetzen.');
          }
        }
        return null;
      } finally {
        active.delete(pick.label);
      }
    };
    try {
      // browser of the desktop app: one tab, so one piece at a time; local Claude Code: a few at once
      await runSearchRounds(targets, {
        key: targetKey,
        search: one,
        parallel: searchMode === 'web' ? SEARCH_PARALLEL : 1,
        stopped,
        onProgress: (p) => {
          progress = p;
          show();
        },
      });
    } finally {
      if (searchCtl === ctl) searchCtl = null;
      setNotFound(missed);
      setSearch(null);
      const fresh = targets.filter((t) => missed.has(targetKey(t))).length;
      if (fresh) useUiStore.getState().toast(`${fresh === 1 ? '1 Produkt' : `${fresh} Produkte`} nicht gefunden – welche und warum, steht im Vorschlag unter „Nicht gefunden“.`, 'info');
    }
  };

  // the ideal plan is shown as it is: searching and swapping work on the buyable one
  const placeholders = proposal && !showIdeal ? openPlaceholders(proposal) : [];
  /** Placeholders not settled yet: never searched, or the last search failed for a technical reason (not „nothing in the shop“). */
  const stillOpen = placeholders.filter((p) => !notFound.get(targetKey(p)) || notFound.get(targetKey(p))!.error);

  const swap = (roomId: string, index: number, alt: number) => {
    if (!proposal || showIdeal) return;
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
                    ? `Claude plant und sucht dann für die Platzhalter echte Produkte (je Möbel etwa eine Minute, die Suche läuft von selbst, bis alle gefunden oder als „nicht gefunden“ markiert sind).`
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
                  <textarea className="design-wish" rows={4} value={w[f.key]} placeholder={f.placeholder} maxLength={MAX_FIELD} onChange={(e) => text(f.key, e.target.value)} />
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
            <SelectField label="Verfahren" value={w.method ?? 'konzept'} options={METHOD_CHOICES} onChange={(v) => st.setWishes({ method: v })} />
            <SelectField label="Qualität" value={w.quality ?? 'thorough'} options={QUALITY_CHOICES} onChange={(v) => st.setWishes({ quality: v })} />
            <p className="muted small" data-testid="design-method-hint">
              {(w.method ?? 'konzept') === 'konzept'
                ? `Claude entwirft erst ein Wohnkonzept für die ganze Wohnung, dann je Raum Zonen, Ankermöbel und Beziehungen. Die App stellt millimetergenau auf, begeht den Raum nach rund 35 Regeln und zeigt Claude das Ergebnis${sample.images ? ' als Bild' : ' als Textkarte'}; wo etwas nicht stimmt, bessert Claude bis zu zweimal nach. Das dauert pro Raum ein paar Minuten.`
                : 'Der bisherige Weg: Claude wählt je Raum eine Möbelliste, der Planer stellt sie auf.'}
            </p>
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
                {st.asking ? `${stage ? `${stage}…` : 'Claude richtet ein…'}${designProgress && designProgress.total > 1 ? ` (${designProgress.done}/${designProgress.total})` : ''}` : search ? 'Suche läuft…' : proposal ? 'Neu einrichten lassen' : 'Einrichten lassen'}
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
            {st.ideal && (
              <div className="design-variant" data-testid="design-variant">
                <div className="btn-row" role="group" aria-label="Fassung des Vorschlags">
                  <button className={showIdeal ? 'primary' : undefined} aria-pressed={showIdeal} disabled={!!search} onClick={() => variant('ideal')}>
                    Ideal
                  </button>
                  <button className={!showIdeal ? 'primary' : undefined} aria-pressed={!showIdeal} disabled={!!search} onClick={() => variant('kaufbar')}>
                    Kaufbar
                  </button>
                </div>
                {st.result && (
                  <button disabled={!!search} onClick={() => { clearPreview(); st.set({ preview: null }); setComparing(true); }} data-testid="design-compare-open">
                    Nebeneinander vergleichen
                  </button>
                )}
                <p className="muted small">
                  {showIdeal
                    ? 'Ideal: Claudes Plan mit Soll-Möbeln (Art, Maße, Optik, Funktionen) als Platzhalter – so würde eine Innenarchitektin den Raum planen.'
                    : 'Kaufbar: die bestpassenden gefundenen IKEA-/Möbelix-Produkte, der Raum mit ihnen neu aufgestellt und begangen; Abweichungen stehen beim Möbel.'}
                </p>
              </div>
            )}
            {comparing && st.ideal && st.result && (
              <CompareVariants ideal={st.ideal.result} kaufbar={st.result} roomTypes={roomTypes} rooms={rooms} catalog={own} onTake={takeVariant} onClose={() => setComparing(false)} />
            )}
            {proposal.summary && <p>{proposal.summary}</p>}
            {proposal.rooms.map((r) => (
              <div key={r.roomId} className="design-room" data-testid="design-room">
                <h5>
                  {roomName(r.roomId)} {r.reviewed && <Badge kind="muted" title="Claude hat die Aufstellung mit der Prüfliste nachgeprüft.">nachgeprüft</Badge>}
                </h5>
                {r.concept && <p className="muted">{r.concept}</p>}
                {r.brief && <BriefView brief={r.brief} />}
                {review(r.roomId) && <ReviewView review={review(r.roomId)!} />}
                {idealScore(r.roomId) !== undefined && idealScore(r.roomId) !== review(r.roomId)?.score && (
                  <p className="muted small" data-testid="design-ideal-score">
                    Ideal: {idealScore(r.roomId)} Punkte – mit den echten Produkten {review(r.roomId)!.score}.
                  </p>
                )}
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
                        {!showIdeal && p.deviation && (
                          <p className="muted small" data-testid="design-deviation">
                            Abweichung vom Ideal: {p.deviation}
                          </p>
                        )}
                        {p.placeholder && notFound.has(key) && <p className="warning small" data-testid="design-notfound">Nicht gefunden: {notFound.get(key)!.reason} – bleibt Platzhalter, Suchlink siehe oben.</p>}
                        {p.placeholder && notSold(p.catalogId) && (
                          <p className="muted small" data-testid="design-not-sold">
                            {NOT_SOLD_TEXT}
                          </p>
                        )}
                        {p.placeholder && !notSold(p.catalogId) && searchMode && !search && !showIdeal && (
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
                                    <button className="small" disabled={!!search || showIdeal} onClick={() => swap(r.roomId, i, k)}>
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
                    onSearch={searchMode && !search && !showIdeal ? (key) => void findReal([{ roomId: r.roomId, index: -1, kitchen: key }]) : undefined}
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
                        Produktsuche: <strong>{runText(search)}</strong>{search.current ? ` – gerade: ${search.current}` : ''} …
                      </p>
                      <progress max={search.total} value={search.done} aria-label="Fortschritt der Produktsuche" />
                      <button onClick={() => searchCtl?.abort()}>Suche stoppen</button>
                    </>
                  ) : (
                    <>
                      {stillOpen.length > 0 ? (
                        <button className="primary" onClick={() => void findReal(stillOpen.map(({ catalogId: _id, ...t }) => t))}>
                          {w.searchReal ? 'Nachsuchen' : 'Alle suchen'} ({stillOpen.length === 1 ? '1 Platzhalter' : `${stillOpen.length} Platzhalter`})
                        </button>
                      ) : (
                        <button onClick={() => void findReal(placeholders.map(({ catalogId: _id, ...t }) => t))}>Nicht gefundene nochmal suchen ({placeholders.length})</button>
                      )}
                    </>
                  )
                ) : (
                  <p className="muted small">
                    Echte Produkte statt Platzhalter sucht Claude in der Claude-Desktop-App (eingebauter Browser) oder im lokalen Planer mit Claude Code und „npm run ikea-helper“.
                    <br />
                    Claude Code fehlt noch? Windows: in PowerShell <code>irm https://claude.ai/install.ps1 | iex</code> (oder <code>npm install -g @anthropic-ai/claude-code</code>), neues Terminal öffnen, <code>claude</code> eingeben und einmal anmelden, dann <code>npm run ikea-helper</code> neu starten. Prüfen: <code>npm run ikea-helper -- --check</code>.
                  </p>
                )}
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
                {shownResult && (
                  <button title="Was wohin kommt, mit Maßen, Abständen, Licht und Begründung – zum Nachbauen (Markdown)" onClick={downloadSheet}>
                    Einrichtungsblatt
                  </button>
                )}
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
  /** The last attempt failed for a technical reason (time, helper, quota), not „nothing in the shop“: still open. */
  error: boolean;
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
          {(notSold(option.catalogId) ? [] : searchLinks(option.search, retailer)).map((l) => (
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

/** What the walk-through found in this room (#442, stage 4). */
function ReviewView({ review }: { review: RoomReview }) {
  return (
    <div className="design-brief" data-testid="design-review">
      <strong className="small">
        Begehung: {review.score} von 100 Punkten {review.passed ? '· bestanden' : '· nicht bestanden'}
      </strong>
      {review.findings.length ? (
        <ul className="small">
          {review.findings.map((f, i) => (
            <li key={i} className={f.severity === 'S' ? 'warning' : undefined}>
              {f.severity === 'S' ? 'Schwer' : f.severity === 'M' ? 'Mittel' : 'Leicht'}: {f.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Alle Regeln erfüllt.</p>
      )}
    </div>
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
          <textarea className="design-wish" rows={3} value={open} maxLength={MAX_FIELD} placeholder="z. B. weniger vollgestellt, Sofa zum Fenster, mehr Stauraum" onChange={(e) => onText(e.target.value)} />
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
