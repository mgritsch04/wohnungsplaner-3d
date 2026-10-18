import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCatalogStore } from '../../catalog/catalogStore';
import { endCatalogDrag, startCatalogDrag } from '../../catalog/catalogDrag';
import { useIkeaDrafts, type PendingDraft } from '../../catalog/ikeaDrafts';
import { addIkeaArticles, completePending, estimateFromModel, IKEA_SELECTION_MAX, isIkeaItem, takeInbox, type IkeaFetchOutcome } from '../../catalog/ikeaSelection';
import { buildBookmarklet } from '../../catalog/providers/bookmarklet';
import { fetchBookmarkletToken, helperAvailable } from '../../catalog/providers/ikeaHelper';
import { DIM_KEYS, parseArticleList, type DimKey } from '../../catalog/providers/ikeaList';
import type { CatalogItem } from '../../catalog/types';
import { formatEuro } from '../../model/units';
import { useUiStore } from '../../store/uiStore';
import { addCatalogItem } from '../actions';
import { Badge } from '../fields';
import s from './IkeaSection.module.css';

const IN_ARTIFACT = import.meta.env.MODE === 'artifact';
type HelperState = 'checking' | 'on' | 'off';
/** How often the open IKEA section asks the helper for pages sent by the bookmarklet. */
const INBOX_POLL_MS = 3000;

/**
 * Katalog › IKEA: paste ikea.com links or article numbers, fetch them through the local
 * helper (`npm run ikea-helper`) and place them in the room as 3D objects.
 */
export function IkeaSection() {
  const items = useCatalogStore((st) => st.items);
  const mine = useMemo(() => items.filter(isIkeaItem), [items]);
  const [helper, setHelper] = useState<HelperState>(IN_ARTIFACT ? 'off' : 'checking');
  const [text, setText] = useState('');
  const [withModel, setWithModel] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<IkeaFetchOutcome[]>([]);
  const found = useMemo(() => parseArticleList(text).length, [text]);
  /** catalog ids that arrived from the bookmarklet while this section was open */
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const check = useCallback(async () => {
    if (IN_ARTIFACT) return;
    setHelper('checking');
    setHelper((await helperAvailable()) ? 'on' : 'off');
  }, []);
  useEffect(() => {
    void check();
  }, [check]);

  // pages sent with the bookmarklet „An Planer senden“ (#221)
  useEffect(() => {
    if (helper !== 'on') return;
    let busy = false;
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const got = await takeInbox();
        const ok = got.filter((o) => o.ok);
        if (ok.length) setFresh((prev) => new Set([...prev, ...ok.map((o) => o.id!)]));
        for (const o of got)
          useUiStore
            .getState()
            .toast(
              o.ok
                ? `„${o.name}“ vom Lesezeichen übernommen${o.withModel ? ' (mit 3D-Modell)' : ''}.`
                : o.pending
                  ? `„${o.name}“: Maße fehlen auf der Seite – bitte unter „Maße fehlen“ eintragen.`
                  : `Lesezeichen: ${o.message}`,
              o.ok ? 'success' : 'info',
            );
      } catch {
        // helper gone – the next status check shows it
      } finally {
        busy = false;
      }
    };
    void poll();
    const t = window.setInterval(() => void poll(), INBOX_POLL_MS);
    return () => window.clearInterval(t);
  }, [helper]);

  const run = async () => {
    setOutcomes([]);
    const res = await addIkeaArticles(text, {
      model: withModel,
      onProgress: (done, total, current) => setProgress(current ? `Hole ${done + 1} von ${total}: ${current} …` : null),
    });
    setProgress(null);
    setOutcomes(res.outcomes);
    const ok = res.outcomes.filter((o) => o.ok).length;
    if (ok) setText('');
    useUiStore
      .getState()
      .toast(
        `${ok} von ${res.outcomes.length} IKEA-Produkt(en) übernommen${res.skipped ? ` – ${res.skipped} weitere übersprungen (max. ${IKEA_SELECTION_MAX} pro Durchgang)` : ''}.`,
        ok === res.outcomes.length && !res.skipped ? 'success' : 'info',
      );
    if (!ok && res.outcomes.some((o) => /antwortet nicht/.test(o.message ?? ''))) void check();
  };

  return (
    <div className={s.section} data-testid="ikea-section">
      <div className={s.fetch}>
        <HelperStatus state={helper} onRetry={() => void check()} />
        <label className={s.label} htmlFor="ikea-articles">
          Links oder Artikelnummern von ikea.com/at
        </label>
        <textarea
          id="ikea-articles"
          className={s.input}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'z. B. https://www.ikea.com/at/de/p/kallax-regal-weiss-10409932/\noder 104.099.32, 2x 106.230.36'}
        />
        <label className={s.check}>
          <input type="checkbox" checked={withModel} onChange={(e) => setWithModel(e.target.checked)} /> 3D-Modell mitladen
        </label>
        <div className={s.actions}>
          <button className="primary" disabled={helper !== 'on' || !found || progress !== null} onClick={() => void run()}>
            {found > 1 ? `${Math.min(found, IKEA_SELECTION_MAX)} Produkte holen` : 'Holen'}
          </button>
          <a href="https://www.ikea.com/at/de/" target="_blank" rel="noopener noreferrer">
            Auf ikea.com suchen ↗
          </a>
        </div>
        {progress && (
          <p className={s.progress} role="status">
            {progress}
          </p>
        )}
        {outcomes.some((o) => !o.ok || o.message) && (
          <ul className={s.outcomes} data-testid="ikea-outcomes">
            {outcomes
              .filter((o) => !o.ok || o.message)
              .map((o) => (
                <li key={o.article} className={o.ok ? undefined : s.failed}>
                  {o.article}
                  {o.name ? ` (${o.name})` : ''}: {o.message}
                </li>
              ))}
          </ul>
        )}
      </div>
      {helper === 'on' && <BookmarkletSetup />}
      <MissingDims onAdded={(id) => setFresh((prev) => new Set([...prev, id]))} />
      <h3 className={s.heading}>Meine IKEA-Auswahl ({mine.length})</h3>
      {mine.length === 0 ? (
        <p className={s.empty}>Noch keine IKEA-Produkte. Link einfügen und „Holen“ drücken – das Produkt erscheint hier und lässt sich in den Raum setzen.</p>
      ) : (
        <ul className={s.cards}>
          {mine.map((i) => (
            <IkeaCard key={i.id} item={i} fresh={fresh.has(i.id)} />
          ))}
        </ul>
      )}
      <p className={s.note}>
        Daten und 3D-Modelle stammen von den öffentlichen Produktseiten von IKEA Österreich und sind urheberrechtlich geschützt – nur privat nutzen. Preise mit
        Abrufdatum, bitte vor dem Kauf auf ikea.com prüfen.
      </p>
    </div>
  );
}

function HelperStatus({ state, onRetry }: { state: HelperState; onRetry: () => void }) {
  if (IN_ARTIFACT)
    return (
      <p className={s.helperOff} data-testid="ikea-helper-status" data-state="artifact">
        Produkte holen geht nur in der Web-App auf deinem PC (mit dem IKEA-Helfer). Hier kannst du die Auswahl nutzen oder einen Ordner importieren.
      </p>
    );
  if (state === 'on')
    return (
      <p className={s.helperOn} data-testid="ikea-helper-status" data-state="on">
        IKEA-Helfer verbunden.
      </p>
    );
  return (
    <div className={s.helperOff} data-testid="ikea-helper-status" data-state={state}>
      {state === 'checking' ? (
        <p>Suche den IKEA-Helfer …</p>
      ) : (
        <>
          <p>
            <strong>IKEA-Helfer nicht gestartet.</strong> Im Projektordner ein Terminal öffnen, <code>npm run ikea-helper</code> eingeben und das Fenster offen
            lassen.
          </p>
          <button onClick={onRetry}>Erneut prüfen</button>
        </>
      )}
    </div>
  );
}

/** Bookmarklet „An Planer senden“: drag it to the bookmarks bar, click it on a product page. */
function BookmarkletSetup() {
  const [code, setCode] = useState<string | null>(null);
  const link = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    let live = true;
    void fetchBookmarkletToken().then((t) => live && setCode(t ? buildBookmarklet(t) : null));
    return () => {
      live = false;
    };
  }, []);
  // React refuses javascript: URLs as props, so the bookmark target is set directly
  useEffect(() => {
    if (code && link.current) link.current.setAttribute('href', code);
  }, [code]);
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      useUiStore.getState().toast('Lesezeichen-Code kopiert: neues Lesezeichen anlegen und den Code als Adresse einfügen.', 'success');
    } catch {
      useUiStore.getState().toast('Kopieren nicht möglich – bitte den Knopf in die Lesezeichenleiste ziehen.', 'info');
    }
  };
  return (
    <details className={s.bookmarklet} data-testid="ikea-bookmarklet">
      <summary>Lesezeichen „An Planer senden“</summary>
      <p>
        Diesen Knopf mit der Maus in die Lesezeichenleiste ziehen. Danach auf einer Produktseite von ikea.com oder moebelix.at das Lesezeichen anklicken: Das
        Produkt erscheint hier, solange der Helfer läuft.
      </p>
      {code ? (
        <div className={s.actions}>
          <a ref={link} className={s.bookmarkletLink} onClick={(e) => e.preventDefault()} title="In die Lesezeichenleiste ziehen" data-testid="ikea-bookmarklet-link">
            An Planer senden
          </a>
          <button onClick={() => void copy()}>Code kopieren</button>
        </div>
      ) : (
        <p>Lesezeichen wird vorbereitet …</p>
      )}
      <p className={s.note}>
        Das Lesezeichen enthält einen geheimen Schlüssel deines Helfers – nicht weitergeben. Fragt der Browser beim ersten Klick, ob ikea.com auf Geräte im lokalen
        Netzwerk zugreifen darf, bitte erlauben (nur so erreicht die Seite den Helfer auf deinem PC).
      </p>
    </details>
  );
}

function IkeaCard({ item, fresh }: { item: CatalogItem; fresh: boolean }) {
  const [imageOk, setImageOk] = useState(true);
  const image = item.imageUrl && /^https:\/\//i.test(item.imageUrl) && imageOk ? item.imageUrl : null;
  const article = item.tags.find((t) => /^S?\d{3}\.\d{3}\.\d{2}$/i.test(t));
  return (
    <li
      className={s.card}
      draggable
      onDragStart={(e) => startCatalogDrag(e.dataTransfer, item)}
      onDragEnd={endCatalogDrag}
      title="In den Plan ziehen oder „In den Raum“ klicken"
      data-testid="ikea-card"
    >
      {image ? (
        <img className={s.image} src={image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageOk(false)} />
      ) : (
        <span className={s.image} style={{ background: item.color }} />
      )}
      <span className={s.body}>
        <span className={s.name}>{item.name}</span>
        <span className={s.meta}>
          {Math.round(item.width * 100)} × {Math.round(item.depth * 100)} × {Math.round(item.height * 100)} cm{article ? ` · ${article}` : ''}
          {item.retailer && item.retailer !== 'IKEA Österreich' ? ` · ${item.retailer}` : ''}
        </span>
        <span className={s.meta}>
          {item.price ? formatEuro(item.price.amount) : 'ohne Preis'}
          {item.price?.recordedAt ? ` (Stand ${item.price.recordedAt})` : ''}{' '}
          {item.model.type === 'gltf' ? <Badge kind="ok">3D-Modell</Badge> : <Badge kind="muted">Näherung</Badge>}{' '}
          {fresh && <Badge kind="info">neu vom Lesezeichen</Badge>}
        </span>
        <span className={s.cardActions}>
          <button className="primary" onClick={() => addCatalogItem(item)}>
            In den Raum
          </button>
          {item.productUrl && (
            <a href={item.productUrl} target="_blank" rel="noopener noreferrer">
              {item.retailer === 'Möbelix Österreich' ? 'moebelix.at' : 'ikea.com'} ↗
            </a>
          )}
          <button onClick={() => void useCatalogStore.getState().removeItem(item.id)} aria-label={`${item.name} aus der Auswahl entfernen`}>
            Entfernen
          </button>
        </span>
      </span>
    </li>
  );
}

const DIM_LABEL: Record<DimKey, string> = { width: 'Breite', depth: 'Tiefe', height: 'Höhe' };

/** Products whose page states no (complete) dimensions (#269): enter them here, then they join the selection. */
function MissingDims({ onAdded }: { onAdded: (id: string) => void }) {
  const drafts = useIkeaDrafts((st) => st.drafts);
  if (!drafts.length) return null;
  return (
    <section data-testid="ikea-missing-dims">
      <h3 className={s.heading}>Maße fehlen ({drafts.length})</h3>
      <p className={s.empty}>
        Auf diesen Seiten stehen keine vollständigen Maße. Bitte selbst eintragen (bei Pflanzen z. B. den Topfdurchmesser als Breite und Tiefe), dann kommt das
        Produkt in die Auswahl.
      </p>
      <ul className={s.cards}>
        {drafts.map((d) => (
          <DraftCard key={d.article} pending={d} onAdded={onAdded} />
        ))}
      </ul>
    </section>
  );
}

function DraftCard({ pending, onAdded }: { pending: PendingDraft; onAdded: (id: string) => void }) {
  const d = pending.draft;
  const [dims, setDims] = useState<Record<DimKey, string>>(() => ({
    width: d.width ? String(d.width) : '',
    depth: d.depth ? String(d.depth) : '',
    height: d.height ? String(d.height) : '',
  }));
  const [estimated, setEstimated] = useState<ReadonlySet<DimKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const value = (k: DimKey) => {
    const n = parseFloat(dims[k].replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  };
  const estimate = async () => {
    if (!pending.model) return;
    setBusy(true);
    setError(null);
    try {
      const m = await estimateFromModel(pending.model);
      const filled = d.missing.filter((k) => !dims[k].trim());
      setDims((prev) => ({ ...prev, ...Object.fromEntries(filled.map((k) => [k, String(m[k])])) }));
      setEstimated(new Set(filled));
    } catch (e) {
      setError(`3D-Modell nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const take = async () => {
    setBusy(true);
    setError(null);
    const o = await completePending(pending, { width: value('width'), depth: value('depth'), height: value('height') });
    setBusy(false);
    if (!o.ok) return setError(o.message ?? 'Nicht übernommen.');
    onAdded(o.id!);
    useUiStore.getState().toast(`„${o.name}“ übernommen${o.withModel ? ' (mit 3D-Modell)' : ''}.`, 'success');
  };
  return (
    <li className={s.card} data-testid="ikea-draft">
      <span className={s.image} style={{ background: '#d8d2c8' }} />
      <span className={s.body}>
        <span className={s.name}>{d.name}</span>
        <span className={s.meta}>
          {d.price !== undefined ? formatEuro(d.price) : 'ohne Preis'}
          {d.retailer && d.retailer !== 'IKEA Österreich' ? ` · ${d.retailer}` : ''} <Badge kind="info">Maße fehlen</Badge>
        </span>
        <span className={s.dims}>
          {DIM_KEYS.map((k) => (
            <label key={k}>
              {DIM_LABEL[k]}
              <input
                type="number"
                min={1}
                inputMode="decimal"
                value={dims[k]}
                onChange={(e) => {
                  setDims((prev) => ({ ...prev, [k]: e.target.value }));
                  setEstimated((prev) => new Set([...prev].filter((x) => x !== k)));
                }}
                aria-label={`${DIM_LABEL[k]} in cm`}
              />
              {estimated.has(k) ? ' ca.' : ''}
            </label>
          ))}
          <span>cm</span>
        </span>
        {estimated.size > 0 && <span className={s.meta}>„ca.“ = aus dem 3D-Modell gemessen; bei Pflanzen zählen die Blätter mit. Bitte prüfen.</span>}
        {error && <span className={s.failed}>{error}</span>}
        <span className={s.cardActions}>
          <button className="primary" disabled={busy} onClick={() => void take()}>
            Übernehmen
          </button>
          {pending.model && d.missing.some((k) => !dims[k].trim()) && (
            <button disabled={busy} onClick={() => void estimate()}>
              Aus 3D-Modell schätzen
            </button>
          )}
          {d.productUrl && (
            <a href={d.productUrl} target="_blank" rel="noopener noreferrer">
              {d.retailer === 'Möbelix Österreich' ? 'moebelix.at' : 'ikea.com'} ↗
            </a>
          )}
          <button onClick={() => useIkeaDrafts.getState().remove(pending.article)} aria-label={`${d.name} verwerfen`}>
            Verwerfen
          </button>
        </span>
      </span>
    </li>
  );
}
