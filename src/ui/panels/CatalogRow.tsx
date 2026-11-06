import { endCatalogDrag, startCatalogDrag } from '../../catalog/catalogDrag';
import type { CatalogItem } from '../../catalog/types';
import { formatEuro } from '../../model/units';
import { addCatalogItem } from '../actions';
import { Badge } from '../fields';

export function CatalogRow({ item }: { item: CatalogItem }) {
  return (
    <li>
      <button
        className="catalog-item"
        onClick={() => addCatalogItem(item)}
        draggable
        onDragStart={(e) => startCatalogDrag(e.dataTransfer, item)}
        onDragEnd={endCatalogDrag}
        title="Klicken zum Hinzufügen oder in den Plan ziehen"
      >
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
