import { useMemo } from 'react';
import { useBudgetGroupStore, type BudgetGrouping } from '../budgetGroupStore';
import { computeBudget, priceStatusLabel } from '../../budget/budget';
import { exportShoppingCsv } from '../../budget/budgetActions';
import { BUY_PHASE_LABEL, BUY_PHASES, buildingDevices, computePurchasePlan } from '../../budget/purchasePlan';
import { buildingFurniture } from '../../budget/rooms';
import { furnitureOnAnyLevel, levelOfFurniture } from '../../model/levels';
import { goToLevel } from '../levelActions';
import { formatEuro } from '../../model/units';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { Badge, Section } from '../fields';
import type { BuyPhase } from '../../model/schema';

export function BudgetPanel() {
  const furniture = useProjectStore((s) => s.project.furniture);
  const nodes = useProjectStore((s) => s.project.nodes);
  const walls = useProjectStore((s) => s.project.walls);
  const openings = useProjectStore((s) => s.project.openings);
  const rooms = useProjectStore((s) => s.project.rooms);
  const levels = useProjectStore((s) => s.project.levels);
  const apply = useProjectStore((s) => s.apply);
  const devices = useProjectStore((s) => s.project.devices);
  const budgets = useProjectStore((s) => s.project.purchaseBudgets);
  // the whole building (#54): furniture of every storey
  const all = useMemo(
    () => buildingFurniture(useProjectStore.getState().project),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [furniture, nodes, walls, openings, rooms, levels],
  );
  const b = useMemo(() => computeBudget(all.furniture, all.roomOf), [all]);
  const plan = useMemo(() => {
    const p = useProjectStore.getState().project;
    const phaseOf = new Map(all.furniture.map((f) => [f.id, f.buyPhase ?? 'movein'] as const));
    return computePurchasePlan(b.lines, (id) => phaseOf.get(id) ?? 'movein', buildingDevices(p), budgets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b, all, devices, levels, budgets]);
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
      <Section title="Kaufplan in Phasen">
        <p className="muted small">Wann wird was gekauft? Phase pro Position wählen, optional ein Budget je Phase eintragen. Smart-Home-Geräte stehen zunächst in der Phase ihres Konzepts.</p>
        <div className="budget-total">
          <span>Gesamt aller Phasen</span>
          <strong>{formatEuro(plan.total)}</strong>
        </div>
        {plan.phases.map((ph) => (
          <div key={ph.phase} className="purchase-group" data-testid={`kaufplan-${ph.phase}`}>
            <div className="purchase-group-head">
              <span>{ph.label}</span>
              <span>{formatEuro(ph.total)}</span>
            </div>
            <label className="small phase-budget">
              Budget (€)
              <input
                type="number"
                min={0}
                step={50}
                value={ph.budget ?? ''}
                placeholder="kein Limit"
                aria-label={`Budget ${ph.label}`}
                onChange={(e) => {
                  const v = e.target.value === '' ? undefined : Math.max(0, Number(e.target.value));
                  apply((d) => {
                    if (v === undefined || !Number.isFinite(v)) delete d.purchaseBudgets[ph.phase];
                    else d.purchaseBudgets[ph.phase] = v;
                  });
                }}
              />
            </label>
            {ph.over !== null && <Badge kind="error">Über Budget um {formatEuro(ph.over)}</Badge>}
            {ph.missing > 0 && <p className="muted small">{ph.missing} Position(en) ohne Preis – nicht in der Summe.</p>}
            <ul className="budget-lines">
              {ph.items.length === 0 && <li className="muted small">Nichts in dieser Phase.</li>}
              {ph.items.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.type === 'device' ? '📡 ' : ''}
                    {i.name}
                    {i.quantity > 1 ? ` × ${i.quantity}` : ''}
                  </span>
                  <select
                    value={ph.phase}
                    aria-label={`Phase für ${i.name}`}
                    onChange={(e) => setPhase(i.type, i.id, e.target.value as BuyPhase)}
                  >
                    {BUY_PHASES.map((p) => (
                      <option key={p} value={p}>
                        {BUY_PHASE_LABEL[p]}
                      </option>
                    ))}
                  </select>
                  <span className="amount">{i.total !== null ? `${i.estimate && i.type === 'device' ? '≈ ' : ''}${formatEuro(i.total)}` : '—'}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </div>
  );
}

/** Set the purchase phase of an item or device on any storey (#363). */
function setPhase(type: 'furniture' | 'device', id: string, phase: BuyPhase) {
  useProjectStore.getState().apply((d) => {
    if (type === 'furniture') {
      const f = furnitureOnAnyLevel(d, id);
      if (f) f.buyPhase = phase;
    } else {
      const dev = [...d.devices, ...d.levels.flatMap((l) => l.plan?.devices ?? [])].find((x) => x.id === id);
      if (dev) dev.buyPhase = phase;
    }
  });
}

/** Select an item of the list; on another storey (#54) that storey is shown first. */
function selectAnywhere(id: string) {
  const p = useProjectStore.getState().project;
  const level = levelOfFurniture(p, id);
  if (level && level !== p.activeLevelId) goToLevel(level);
  useUiStore.getState().setSelection({ type: 'furniture', id });
}
