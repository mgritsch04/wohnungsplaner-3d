import type { BuyPhase, Project, SmartDevice } from '../model/schema';
import { projectOnLevel, sortedLevels } from '../model/levels';
import { KIND_LABEL, productById } from '../smarthome/catalog';
import { KIND_PHASE } from '../smarthome/concept';
import type { BudgetLine } from './budget';

/** Purchase plan (#363): the shopping list split into phases with a budget per phase. */
export const BUY_PHASES: BuyPhase[] = ['movein', 'month2', 'later'];
export const BUY_PHASE_LABEL: Record<BuyPhase, string> = { movein: 'Zum Einzug', month2: 'Monat 2', later: 'Irgendwann' };

/** Smart-home devices follow the phases of the concept (#375): 1 → moving in, 2 → month 2, 3 → later. */
const CONCEPT_PHASE: BuyPhase[] = ['movein', 'month2', 'later'];

export interface PurchaseItem {
  id: string;
  type: 'furniture' | 'device';
  name: string;
  quantity: number;
  /** Multipack: packs to buy and pieces per pack (1 = sold singly). */
  packs: number;
  packSize: number;
  /** Known price of the line (devices: middle of the catalogue range, an estimate); null = unknown. */
  total: number | null;
  /** Estimates (device catalogue range) are not a retailer price. */
  estimate: boolean;
}

export interface PurchasePhase {
  phase: BuyPhase;
  label: string;
  items: PurchaseItem[];
  total: number;
  missing: number;
  budget: number | null;
  /** Total above the budget of this phase; null = no budget set or not exceeded. */
  over: number | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Every smart-home device of the building (all storeys). */
export function buildingDevices(project: Project): SmartDevice[] {
  return sortedLevels(project).flatMap((l) => projectOnLevel(project, l.id).devices);
}

export function devicePhase(d: SmartDevice): BuyPhase {
  return d.buyPhase ?? CONCEPT_PHASE[KIND_PHASE[d.kind] - 1];
}

/** Price of a device from the catalogue (middle of the range); null when no source states one. */
export function devicePrice(d: SmartDevice): number | null {
  const r = productById(d.productId)?.priceEur;
  return r ? round2((r[0] + r[1]) / 2) : null;
}

/**
 * Items per phase with sums and budget warning. `furnitureLines` are the lines of the budget
 * (`computeBudget`), `furniturePhase` gives each line's phase; the sum over all phases equals
 * the furniture total plus the priced devices.
 */
export function computePurchasePlan(
  furnitureLines: BudgetLine[],
  phaseOfFurniture: (id: string) => BuyPhase,
  devices: SmartDevice[],
  budgets: Project['purchaseBudgets'],
): { phases: PurchasePhase[]; total: number } {
  const phases = BUY_PHASES.map((phase): PurchasePhase => {
    const items: PurchaseItem[] = [
      ...furnitureLines
        .filter((l) => phaseOfFurniture(l.id) === phase)
        .map((l): PurchaseItem => ({ id: l.id, type: 'furniture', name: l.name, quantity: l.quantity, packs: l.packs, packSize: l.packSize, total: l.total, estimate: l.priceStatus === 'estimate' })),
      ...devices
        .filter((d) => devicePhase(d) === phase)
        .map((d): PurchaseItem => ({ id: d.id, type: 'device', name: d.name || KIND_LABEL[d.kind], quantity: 1, packs: 1, packSize: 1, total: devicePrice(d), estimate: true })),
    ];
    const total = round2(items.reduce((s, i) => s + (i.total ?? 0), 0));
    const budget = budgets[phase] ?? null;
    return {
      phase,
      label: BUY_PHASE_LABEL[phase],
      items,
      total,
      missing: items.filter((i) => i.total === null).length,
      budget,
      over: budget !== null && total > budget ? round2(total - budget) : null,
    };
  });
  return { phases, total: round2(phases.reduce((s, p) => s + p.total, 0)) };
}
