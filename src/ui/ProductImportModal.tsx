import { useState } from 'react';
import { parseProductPage, type InputKind, type ParsedProductPage } from '../catalog/providers/structuredData';
import { providerForUrl } from '../catalog/providers/registry';
import { productToCatalogItem } from '../catalog/providers/toCatalog';
import { useCatalogStore } from '../catalog/catalogStore';
import { CATEGORIES } from '../catalog/types';
import { formatEuro } from '../model/units';
import { addCatalogItem } from './actions';
import { useDialogStore } from './dialogStore';
import { Badge } from './fields';
import { useUiStore } from '../store/uiStore';

const SHAPES: Record<string, string> = {
  sofa: 'sofa', bed: 'bed', table: 'table', chair: 'chair', storage: 'shelf', desk: 'desk', lighting: 'floor-lamp',
  textile: 'rug', kitchen: 'k-base', appliance: 'box', bathroom: 'box', decor: 'box',
};

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
  const [form, setForm] = useState({ name: '', category: 'storage', width: '', depth: '', height: '' });
  const provider = providerForUrl(url);

  const parse = () => {
    const p = parseProductPage(source, url || undefined);
    setProduct(p);
    const cm = (v: number | null) => (v === null ? '' : String(Math.round(v * 10) / 10).replace('.', ','));
    setForm({ name: p.name ?? '', category: form.category, width: cm(p.dimensions.width), depth: cm(p.dimensions.depth), height: cm(p.dimensions.height) });
  };

  const num = (s: string) => {
    const n = parseFloat(s.replace(',', '.'));
    return Number.isFinite(n) && n > 0 && n < 2000 ? n : null;
  };
  const w = num(form.width);
  const d = num(form.depth);
  const h = num(form.height);
  const ready = !!product && form.name.trim() && w && d && h;

  const save = async (place: boolean) => {
    if (!product || !w || !d || !h) return;
    const item = productToCatalogItem({ product, width: w, depth: d, height: h, name: form.name.trim(), category: form.category, shape: SHAPES[form.category] ?? 'box' });
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
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
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
              <p className="muted small">{product.licenseNote} Das 3D-Modell ist eine maßstäbliche Näherung; ein eigenes GLB kann danach beim Objekt hinterlegt werden.</p>
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
