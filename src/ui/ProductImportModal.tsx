import { useState } from 'react';
import { parseProductPage, type InputKind, type ParsedProductPage } from '../catalog/providers/structuredData';
import { providerForUrl } from '../catalog/providers/registry';
import { productToCatalogItem } from '../catalog/providers/toCatalog';
import { classifyProduct, type CategoryGuess } from '../catalog/providers/classify';
import { useCatalogStore } from '../catalog/catalogStore';
import { CATEGORIES } from '../catalog/types';
import { formatEuro } from '../model/units';
import { addCatalogItem } from './actions';
import { useDialogStore } from './dialogStore';
import { Badge } from './fields';
import { useUiStore } from '../store/uiStore';
import { checkModelBlob, compareDimensions, fetchModel, type FetchedModel } from '../catalog/providers/modelFetch';
import { db } from '../persistence/db';
import { newId } from '../model/ids';

const SHAPES: Record<string, string> = {
  sofa: 'sofa', bed: 'bed', table: 'table', chair: 'chair', storage: 'shelf', desk: 'desk', lighting: 'floor-lamp',
  textile: 'rug', kitchen: 'k-base', appliance: 'box', bathroom: 'box', decor: 'box',
};

function ModelSection({
  url,
  declared,
  fetchNote,
  model,
  state,
  dims,
  onState,
  onModel,
}: {
  url: string | null;
  /** Number of models the page declares as schema.org 3DModel (0 = heuristic find). */
  declared: number;
  /** Retailer-specific reason why direct loading is refused (shown on failure). */
  fetchNote?: string;
  model: FetchedModel | null;
  state: { busy: boolean; message: string | null; failed: boolean };
  dims: { width: number; depth: number; height: number } | null;
  onState: (s: { busy: boolean; message: string | null; failed: boolean }) => void;
  onModel: (m: FetchedModel | null) => void;
}) {
  const tryDirect = async () => {
    if (!url) return;
    onState({ busy: true, message: 'Lade Modell…', failed: false });
    const r = await fetchModel(url);
    if (r.ok) {
      onModel(r.model);
      onState({ busy: false, message: 'Modell direkt geladen.', failed: false });
    } else {
      const why =
        r.error === 'cors-or-network'
          ? fetchNote ?? 'Der Server des Händlers erlaubt keinen direkten Abruf aus dieser App (Browser-Sicherheit/CORS) oder ist nicht erreichbar.'
          : r.error === 'timeout'
            ? 'Zeitüberschreitung beim Abruf.'
            : r.error === 'http'
              ? `Die Adresse ist nicht (mehr) gültig (${r.detail}) – Modell-Links können ablaufen; ggf. Seitenquelltext neu kopieren.`
              : `Die Datei ist kein gültiges Modell (${r.detail}).`;
      onState({ busy: false, message: why, failed: true });
    }
  };
  const pick = async (f: File | undefined) => {
    if (!f) return;
    onState({ busy: true, message: 'Prüfe Datei…', failed: false });
    try {
      onModel(await checkModelBlob(f));
      onState({ busy: false, message: `„${f.name}“ geprüft.`, failed: false });
    } catch (e) {
      onState({ busy: false, message: e instanceof Error ? e.message : String(e), failed: true });
    }
  };
  const cmp = model && dims ? compareDimensions(model.info.size, dims) : null;
  return (
    <div className="model-section">
      <p className="small">
        <strong>3D-Modell:</strong>{' '}
        {url && declared > 0 ? (
          <>
            von der Produktseite angegeben (schema.org 3DModel{declared > 1 ? `, ${declared} Varianten – die erste wird verwendet` : ''}){' '}
            <Badge kind="ok" title="Die Seite deklariert das Modell selbst in ihren strukturierten Daten">deklariert</Badge>
          </>
        ) : url ? (
          <>
            Verweis im Quelltext gefunden <Badge kind="warn">experimentell</Badge>
          </>
        ) : (
          'kein Verweis im Quelltext gefunden'
        )}
      </p>
      <div className="btn-row">
        {url && (
          <button disabled={state.busy} onClick={() => void tryDirect()}>
            Modell direkt laden
          </button>
        )}
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="small">
            Modell-Link im Browser öffnen ↗
          </a>
        )}
        <label className="small file-pick">
          {url ? 'Heruntergeladene .glb wählen:' : 'Eigene .glb wählen:'}{' '}
          <input type="file" accept=".glb,.gltf" aria-label="Modelldatei für das Produkt" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
      </div>
      {state.message && <p className={`small ${state.failed ? 'warning' : 'muted'}`}>{state.message}{state.failed && url ? ' Alternative: „Modell-Link im Browser öffnen“ – der Browser lädt die .glb herunter – und die Datei hier wählen.' : ''}</p>}
      {model && (
        <p className="small">
          <Badge kind="ok">Modell geprüft</Badge> {model.info.meshes} Mesh(es), {model.info.triangles.toLocaleString('de-AT')} Dreiecke · Modellmaße{' '}
          {Math.round(model.info.size.x * 1000) / 10} × {Math.round(model.info.size.z * 1000) / 10} × {Math.round(model.info.size.y * 1000) / 10} cm
          {cmp && (
            <>
              {' '}
              · Abweichung zu den Produktmaßen max. {(cmp.maxDeviation * 100).toFixed(1)} %{' '}
              <Badge kind={cmp.maxDeviation <= 0.03 ? 'ok' : cmp.maxDeviation <= 0.1 ? 'warn' : 'error'}>{cmp.maxDeviation <= 0.03 ? 'passt' : 'prüfen'}</Badge>
              {cmp.rotated && ' (Modell um 90° gedreht)'}
            </>
          )}{' '}
          <button className="link-btn" onClick={() => onModel(null)}>
            entfernen
          </button>
        </p>
      )}
    </div>
  );
}

const KIND_LABEL: Record<InputKind, string> = {
  empty: 'leer',
  url: 'nur Adresse',
  html: 'HTML-Seitenquelltext',
  jsonld: 'JSON-LD (schema.org)',
  'json-simple': 'einfaches JSON',
  text: 'sichtbarer Seitentext',
  'invalid-json': 'fehlerhaftes JSON',
};

/**
 * Proof of concept: take over a real product from a retailer page the user copied
 * themselves (URL + page source / JSON-LD). Nothing is fetched from the retailer.
 */
export function ProductImportModal() {
  const close = useDialogStore((s) => s.closeModal);
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('');
  const [product, setProduct] = useState<ParsedProductPage | null>(null);
  // no preset category: it comes from the page or the user picks it (never a silent default)
  const [form, setForm] = useState({ name: '', category: '', width: '', depth: '', height: '' });
  const [guess, setGuess] = useState<CategoryGuess | null>(null);
  const [model, setModel] = useState<FetchedModel | null>(null);
  const [modelState, setModelState] = useState<{ busy: boolean; message: string | null; failed: boolean }>({ busy: false, message: null, failed: false });
  const provider = providerForUrl(url);

  const parse = () => {
    const p = parseProductPage(source, url || undefined);
    setProduct(p);
    setModel(null);
    setModelState({ busy: false, message: null, failed: false });
    const cm = (v: number | null) => (v === null ? '' : String(Math.round(v * 10) / 10).replace('.', ','));
    const g = classifyProduct(p.name, p.categoryHints);
    setGuess(g);
    setForm({ name: p.name ?? '', category: g.category ?? '', width: cm(p.dimensions.width), depth: cm(p.dimensions.depth), height: cm(p.dimensions.height) });
  };

  const num = (s: string) => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 2000 ? n : null;
  };
  const w = num(form.width);
  const d = num(form.depth);
  const h = num(form.height);
  const ready = !!product && form.name.trim() && form.category && w && d && h;
  // the recognised shape (e.g. armchair vs. sofa) as long as the user keeps the recognised category
  const shape = guess?.category === form.category && guess.shape ? guess.shape : (SHAPES[form.category] ?? 'box');

  const save = async (place: boolean) => {
    if (!product || !w || !d || !h) return;
    const base = productToCatalogItem({ product, width: w, depth: d, height: h, name: form.name.trim(), category: form.category, shape });
    let item = base;
    if (model) {
      const assetId = newId('asset');
      await db.putAsset(assetId, model.blob);
      item = {
        ...base,
        model: { type: 'gltf', assetId, fallbackShape: base.model.type === 'procedural' ? base.model.shape : 'box' },
        approximate: false,
        description: `${base.description ?? ''} · 3D-Modell vom Händler (nur privater Gebrauch, nicht weitergeben)`,
      };
    }
    await useCatalogStore.getState().addItems([item]);
    close();
    if (place) addCatalogItem(item);
    else useUiStore.getState().toast(`„${item.name}“ zum Katalog hinzugefügt (Quelle: Importiert).`, 'success');
  };

  const st = (s: 'source' | 'user' | 'missing') => (s === 'source' ? <Badge kind="ok">aus Seite</Badge> : <Badge kind="error">fehlt</Badge>);

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label="Produkt von Händlerseite übernehmen" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Produkt von Händlerseite übernehmen</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">
          <ol className="steps">
            <li>Produktseite (z. B. IKEA Österreich, Möbelix) im Browser öffnen und die Adresse unten bei „Produkt-URL“ einfügen.</li>
            <li>
              <strong>Seitenquelltext</strong> öffnen: <kbd>Strg</kbd>+<kbd>U</kbd> (Mac: <kbd>⌥</kbd>+<kbd>⌘</kbd>+<kbd>U</kbd>), dort <kbd>Strg</kbd>+<kbd>A</kbd>,{' '}
              <kbd>Strg</kbd>+<kbd>C</kbd> – und unten einfügen.
            </li>
          </ol>
          <p className="muted small">
            Ebenfalls möglich: ein JSON-LD-Block oder einfaches JSON wie{' '}
            <code>{'{"name":"Regal","width":80,"depth":30,"height":200,"price":79.9,"url":"https://…"}'}</code> (Maße in cm). Nur sichtbarer Text liefert lediglich
            Maße. Die App ruft selbst nichts vom Händler ab (Browser-Sicherheit/CORS), führt eingefügte Skripte nicht aus und schätzt keine fehlenden Werte.
          </p>
          <label className="field">
            <span className="field-label">Produkt-URL</span>
            <span className="field-input">
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.ikea.com/at/de/p/…" />
            </span>
          </label>
          {url && (
            <p className="muted small">
              Erkannt: <strong>{provider.label}</strong> · Live-Abfrage: {provider.liveLookup === 'available' ? 'verfügbar' : 'nicht verfügbar'} – {provider.liveLookupNote}
            </p>
          )}
          <label className="field">
            <span className="field-label">Seitenquelltext oder JSON-LD</span>
            <textarea
              rows={6}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setProduct(null);
              }}
              placeholder="<!DOCTYPE html>… (Seitenquelltext) oder JSON"
              aria-label="Seitenquelltext oder JSON-LD"
            />
          </label>
          {source && <p className="muted small">{source.length.toLocaleString('de-AT')} Zeichen eingefügt{source.length < 2000 && /<html/i.test(source) ? ' – auffällig kurz, wurde der Quelltext vollständig kopiert?' : ''}</p>}
          <div className="btn-row">
            <button className="primary" disabled={!source.trim()} onClick={parse}>
              Produktdaten auslesen
            </button>
          </div>

          {product && product.errors.length > 0 && (
            <ul className="issues">
              {product.errors.map((e, i) => (
                <li key={i} className="warning small error-text">
                  {e}
                </li>
              ))}
            </ul>
          )}
          {product && product.inputKind !== 'url' && product.inputKind !== 'empty' && (
            <div className="product-review">
              <p className="muted small">
                Erkannt als: <strong>{KIND_LABEL[product.inputKind]}</strong>
                {product.sources.length > 0 && <> · Daten aus: {product.sources.join(', ')}</>}
              </p>
              <p className="small">
                Qualität:{' '}
                {product.quality === 'complete-from-source' ? (
                  <Badge kind="ok">vollständig aus Quelle</Badge>
                ) : product.quality === 'partial' ? (
                  <Badge kind="warn">teilweise</Badge>
                ) : (
                  <Badge kind="error">unzureichend</Badge>
                )}{' '}
                {product.articleNumber && <>· Artikelnr. {product.articleNumber} </>}
                {product.price ? (
                  <>
                    · Preis {product.price.currency === 'EUR' ? formatEuro(product.price.amount) : `${product.price.amount} ${product.price.currency}`} (Stand {product.retrievedAt.slice(0, 10)})
                  </>
                ) : (
                  <>· kein Preis gefunden</>
                )}
                {product.availability && <> · Verfügbarkeit laut Seite: {product.availability}</>}
              </p>
              {product.warnings.length > 0 && (
                <ul className="issues">
                  {product.warnings.map((w, i) => (
                    <li key={i} className="warn-text">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
              <div className="field-grid">
                <label className="field">
                  <span className="field-label">Name</span>
                  <span className="field-input">
                    <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </span>
                </label>
                <label className="field">
                  <span className="field-label">Kategorie</span>
                  <span className="field-input">
                    <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                      {!form.category && <option value="">– bitte wählen –</option>}
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
              {guess && (
                <p className="small" data-testid="category-guess">
                  <Badge kind={guess.confidence === 'sicher' ? 'ok' : guess.confidence === 'unsicher' ? 'warn' : 'error'}>
                    Produkttyp {guess.confidence}
                  </Badge>{' '}
                  {guess.reason}
                  {guess.category && form.category && guess.category !== form.category && ' · von dir geändert'}
                </p>
              )}
              <div className="field-grid three">
                {(['width', 'depth', 'height'] as const).map((k) => (
                  <label className="field" key={k}>
                    <span className="field-label">
                      {{ width: 'Breite', depth: 'Tiefe', height: 'Höhe' }[k]} (cm) {st(product.dimensions.status[k])}
                    </span>
                    <span className="field-input">
                      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} inputMode="decimal" placeholder="selbst messen/eintragen" />
                    </span>
                  </label>
                ))}
              </div>
              {product.dimensions.sourceText && <p className="muted small">Gefundene Maßangabe: „{product.dimensions.sourceText}“</p>}
              <ModelSection
                url={product.modelUrl}
                declared={product.modelCandidates.length}
                fetchNote={provider.modelFetchNote}
                model={model}
                state={modelState}
                dims={w && d && h ? { width: w, depth: d, height: h } : null}
                onState={setModelState}
                onModel={setModel}
              />
              <p className="muted small">
                {product.licenseNote} {model ? '' : 'Ohne Händlermodell wird eine maßstäbliche Näherung verwendet.'}
              </p>
              <div className="btn-row end">
                <button disabled={!ready} onClick={() => void save(false)}>
                  Zum Katalog hinzufügen
                </button>
                <button className="primary" disabled={!ready} onClick={() => void save(true)}>
                  Hinzufügen und platzieren
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
