import { useMemo, useState } from 'react';
import { computeBudget, priceStatusLabel } from '../../budget/budget';
import { exportShoppingCsv } from '../../budget/budgetActions';
import { furnitureRoomLookup } from '../../budget/rooms';
import { derivePlan } from '../../model/derived';
import { formatEuro } from '../../model/units';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { Badge, Section } from '../fields';

export function BudgetPanel() {
  const furniture = useProjectStore((s) => s.project.furniture);
  const nodes = useProjectStore((s) => s.project.nodes);
  const walls = useProjectStore((s) => s.project.walls);
  const openings = useProjectStore((s) => s.project.openings);
  const rooms = useProjectStore((s) => s.project.rooms);
  const apply = useProjectStore((s) => s.apply);
  const roomOf = useMemo(() => furnitureRoomLookup({ rooms }, derivePlan({ nodes, walls, openings, rooms })), [nodes, walls, openings, rooms]);
  const b = useMemo(() => computeBudget(furniture, roomOf), [furniture, roomOf]);
  const [group, setGroup] = useState<'category' | 'retailer' | 'room'>('category');

  if (b.lines.length === 0) {
    return (
      <div className="panel-scroll">
        <Section title="Budget">
          <p className="muted small">Noch keine Möbel oder Geräte im Projekt. Objekte aus dem Katalog hinzufügen – Preise werden hier automatisch summiert.</p>
        </Section>
      </div>
    );
  }

  const groups =
    group === 'category'
      ? b.byCategory.map((c) => ({ key: c.category, label: c.label, total: c.total, lines: b.lines.filter((l) => l.category === c.category) }))
      : group === 'retailer'
        ? b.byRetailer.map((r) => ({ key: r.retailer, label: r.retailer, total: r.total, lines: b.lines.filter((l) => l.retailer === r.retailer) }))
        : b.byRoom.map((r) => ({ key: r.roomId ?? '', label: r.label, total: r.total, lines: b.lines.filter((l) => l.roomId === r.roomId) }));

  return (
    <div className="panel-scroll">
      <Section title="Budget">
        <div className="budget-total">
          <span>Summe (bekannte Preise)</span>
          <strong>{formatEuro(b.total)}</strong>
        </div>
        <dl className="stats">
          <dt>davon bestätigt</dt>
          <dd>{formatEuro(b.confirmed)}</dd>
          <dt>davon eigene Angaben</dt>
          <dd>{formatEuro(b.userEntered)}</dd>
          <dt>davon Schätzungen</dt>
          <dd>{formatEuro(b.estimated)}</dd>
          <dt>ohne Preis</dt>
          <dd>{b.missingCount ? <Badge kind="error">{b.missingCount} Position(en)</Badge> : '–'}</dd>
        </dl>
        <p className="muted small">Schätzungen sind grobe Richtwerte für generische Objekte, keine Händlerpreise.</p>
        <button className="block" onClick={() => exportShoppingCsv(group === 'room')}>
          Einkaufsliste als CSV exportieren{group === 'room' ? ' (nach Raum)' : ''}
        </button>
      </Section>
      <Section
        title="Einkaufsliste"
        actions={
          <select value={group} onChange={(e) => setGroup(e.target.value as typeof group)} aria-label="Gruppierung">
            <option value="category">nach Kategorie</option>
            <option value="retailer">nach Händler</option>
            <option value="room">nach Raum</option>
          </select>
        }
      >
        {groups.map((g) => (
          <div key={g.key} className="budget-group">
            <div className="budget-group-head">
              <span>{g.label}</span>
              <span>{formatEuro(g.total)}</span>
            </div>
            <ul className="budget-lines">
              {g.lines.map((l) => (
                <li key={l.id}>
                  <button className="link-btn" onClick={() => useUiStore.getState().setSelection({ type: 'furniture', id: l.id })}>
                    {l.name}
                  </button>
                  <span className="qty">
                    <button
                      aria-label="Menge verringern"
                      onClick={() =>
                        apply((d) => {
                          const f = d.furniture.find((x) => x.id === l.id);
                          if (f && f.quantity > 1) f.quantity--;
                        })
                      }
                    >
                      −
                    </button>
                    {l.quantity}
                    <button
                      aria-label="Menge erhöhen"
                      onClick={() =>
                        apply((d) => {
                          const f = d.furniture.find((x) => x.id === l.id);
                          if (f && f.quantity < 999) f.quantity++;
                        })
                      }
                    >
                      +
                    </button>
                  </span>
                  <span className="amount">
                    {l.total !== null ? formatEuro(l.total) : '—'}
                    <Badge kind={l.priceStatus === 'confirmed' ? 'ok' : l.priceStatus === 'user' ? 'info' : l.priceStatus === 'estimate' ? 'muted' : 'error'}>{priceStatusLabel(l.priceStatus)}</Badge>
                  </span>
                  {l.productUrl && /^https?:\/\//.test(l.productUrl) && (
                    <a href={l.productUrl} target="_blank" rel="noopener noreferrer" className="small">
                      Link ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </div>
  );
}
