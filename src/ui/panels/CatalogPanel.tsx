import { useMemo, useState } from 'react';
import { GENERIC_CATALOG } from '../../catalog/generic';
import { CATEGORIES, categoryLabel, type CatalogItem } from '../../catalog/types';
import { useCatalogStore } from '../../catalog/catalogStore';
import { formatEuro } from '../../model/units';
import { addCatalogItem } from '../actions';
import { Badge } from '../fields';
import { importCatalogFile } from '../../catalog/catalogImport';

export function CatalogPanel() {
  const imported = useCatalogStore((s) => s.items);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [maxWidth, setMaxWidth] = useState<number | null>(null);
  const [source, setSource] = useState<'all' | 'generic' | 'imported'>('all');

  const all = useMemo(() => [...imported, ...GENERIC_CATALOG], [imported]);
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((i) => {
      if (category && i.category !== category) return false;
      if (source !== 'all' && i.source !== source) return false;
      if (maxWidth !== null && i.width * 100 > maxWidth) return false;
      if (!q) return true;
      return [i.name, categoryLabel(i.category), i.brand ?? '', i.retailer ?? '', ...i.tags].join(' ').toLowerCase().includes(q);
    });
  }, [all, query, category, maxWidth, source]);

  return (
    <div className="panel-scroll catalog">
      <div className="catalog-filters">
        <input type="search" placeholder="Suchen (z. B. Sofa, Bett, Spüle)…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Katalog durchsuchen" />
        <div className="chips">
          <button className={`chip ${category === null ? 'active' : ''}`} onClick={() => setCategory(null)}>
            Alle
          </button>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={`chip ${category === c.id ? 'active' : ''}`} onClick={() => setCategory(category === c.id ? null : c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <div className="field-row compact">
          <label className="field">
            <span className="field-label">Max. Breite</span>
            <span className="field-input">
              <input
                type="number"
                min={10}
                placeholder="beliebig"
                value={maxWidth ?? ''}
                onChange={(e) => setMaxWidth(e.target.value ? Number(e.target.value) : null)}
              />
              <span className="field-unit">cm</span>
            </span>
          </label>
          <label className="field">
            <span className="field-label">Quelle</span>
            <span className="field-input">
              <select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                <option value="all">Alle</option>
                <option value="generic">Generisch</option>
                <option value="imported">Importiert ({imported.length})</option>
              </select>
            </span>
          </label>
        </div>
      </div>
      <ul className="catalog-list">
        {items.map((i) => (
          <CatalogRow key={i.id} item={i} />
        ))}
        {items.length === 0 && <li className="empty">Keine Einträge gefunden.</li>}
      </ul>
      <div className="catalog-footer">
        <button className="block" onClick={() => void importCatalogFile()}>
          Produktliste importieren (JSON/CSV)…
        </button>
        <p className="muted small">
          Generische Einträge haben typische Maße und <strong>geschätzte Richtpreise</strong> – keine Angebote eines Händlers. Echte Produkte (z. B. IKEA, Möbelix)
          können per Produktliste importiert werden – siehe Dokumentation.
        </p>
      </div>
    </div>
  );
}

function CatalogRow({ item }: { item: CatalogItem }) {
  return (
    <li>
      <button className="catalog-item" onClick={() => addCatalogItem(item)} title="Zum Plan hinzufügen">
        <span className="swatch" style={{ background: item.color }} />
        <span className="catalog-main">
          <span className="catalog-name">{item.name}</span>
          <span className="catalog-meta">
            {Math.round(item.width * 100)} × {Math.round(item.depth * 100)} × {Math.round(item.height * 100)} cm
            {item.brand ? ` · ${item.brand}` : ''}
          </span>
        </span>
        <span className="catalog-price">
          {item.price ? (
            <>
              {formatEuro(item.price.amount)}
              {item.price.status === 'estimate' && <Badge kind="muted">Schätzung</Badge>}
            </>
          ) : (
            <Badge kind="muted">ohne Preis</Badge>
          )}
        </span>
      </button>
    </li>
  );
}
