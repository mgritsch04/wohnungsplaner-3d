import { useMemo } from 'react';
import { useBudgetGroupStore, type BudgetGrouping } from '../budgetGroupStore';
import { computeBudget, priceStatusLabel } from '../../budget/budget';
import { exportShoppingCsv } from '../../budget/budgetActions';
import { buildingFurniture } from '../../budget/rooms';
import { furnitureOnAnyLevel, levelOfFurniture } from '../../model/levels';
import { goToLevel } from '../levelActions';
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
  const levels = useProjectStore((s) => s.project.levels);
  const apply = useProjectStore((s) => s.apply);
  // the whole building (#54): furniture of every storey
  const all = useMemo(
    () => buildingFurniture(useProjectStore.getState().project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [furniture, nodes, walls, openings, rooms, levels],
  );
  const b = useMemo(() => computeBudget(all.furniture, all.roomOf), [all]);
  const group = useBudgetGroupStore((s) => s.grouping);
  const setGroup = useBudgetGroupStore((s) => s.setGrouping);

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
          <select value={group} onChange={(e) => setGroup(e.target.value as BudgetGrouping)} aria-label="Gruppierung">
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
                  <button className="link-btn" onClick={() => selectAnywhere(l.id)}>
                    {l.name}
                  </button>
                  <span className="qty">
                    <button
                      aria-label="Menge verringern"
                      onClick={() =>
                        apply((d) => {
                          const f = furnitureOnAnyLevel(d, l.id);
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
                          const f = furnitureOnAnyLevel(d, l.id);
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

/** Select an item of the list; on another storey (#54) that storey is shown first. */
function selectAnywhere(id: string) {
  const p = useProjectStore.getState().project;
  const level = levelOfFurniture(p, id);
  if (level && level !== p.activeLevelId) goToLevel(level);
  useUiStore.getState().setSelection({ type: 'furniture', id });
}
