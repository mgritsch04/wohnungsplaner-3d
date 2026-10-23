import { categoryLabel } from '../catalog/types';
import { packsNeeded } from '../catalog/packSize';
import type { Furniture } from '../model/schema';

/** Room an item stands in (by its centre), or null when it is outside every room. */
export type RoomOf = (f: Furniture) => { id: string; name: string } | null;

export const NO_ROOM = 'Ohne Raum';

export interface BudgetLine {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  retailer: string;
  /** Pieces needed. */
  quantity: number;
  /** Price of one unit as sold (a pack for multipacks, else one piece). */
  unitPrice: number | null;
  /** Pieces per pack (1 = sold singly). */
  packSize: number;
  /** Packs to buy, rounded up (= quantity when sold singly). */
  packs: number;
  /** Price per piece (unitPrice / packSize); null = no price. */
  piecePrice: number | null;
  total: number | null;
  priceStatus: 'confirmed' | 'estimate' | 'user' | 'missing';
  productUrl?: string;
  generated: boolean;
  /** "B × T × H" in cm, for the shopping list */
  size: string;
  /** Room the item stands in (#75); null = outside every room or rooms not known. */
  roomId: string | null;
  room: string;
}

export interface BudgetSummary {
  lines: BudgetLine[];
  /** Sum of all known prices. */
  total: number;
  /** Sum by price status. */
  confirmed: number;
  estimated: number;
  userEntered: number;
  missingCount: number;
  byCategory: { category: string; label: string; total: number; count: number; missing: number }[];
  byRetailer: { retailer: string; total: number; count: number }[];
  /** Subtotals per room, sorted by name; items outside every room come last (#75). */
  byRoom: { roomId: string | null; label: string; total: number; count: number; missing: number }[];
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function computeBudget(all: Furniture[], roomOf?: RoomOf): BudgetSummary {
  // fitted objects that came with the flat are not bought (#255)
  const items = all.filter((f) => !f.existing);
  const lines: BudgetLine[] = items.map((f) => {
    const unit = f.price ? f.price.amount : null;
    const room = roomOf?.(f) ?? null;
    const packSize = f.price?.packSize ?? 1;
    const packs = packsNeeded(f.quantity, packSize);
    return {
      id: f.id,
      name: f.name,
      category: f.category,
      categoryLabel: categoryLabel(f.category),
      retailer: f.retailer?.trim() || 'Ohne Händler',
      quantity: f.quantity,
      unitPrice: unit,
      packSize,
      packs,
      piecePrice: unit === null ? null : round2(unit / packSize),
      total: unit === null ? null : round2(unit * packs),
      priceStatus: f.price ? f.price.status : 'missing',
      productUrl: f.productUrl,
      generated: !!f.kitchen?.generated,
      size: [f.width, f.depth, f.height].map((m) => String(Math.round(m * 1000) / 10).replace('.', ',')).join(' × '),
      roomId: room?.id ?? null,
      room: room ? room.name.trim() || 'Raum ohne Namen' : NO_ROOM,
    };
  });
  const sum = (pred: (l: BudgetLine) => boolean) => round2(lines.filter(pred).reduce((s, l) => s + (l.total ?? 0), 0));
  const cats = new Map<string, { category: string; label: string; total: number; count: number; missing: number }>();
  const rets = new Map<string, { retailer: string; total: number; count: number }>();
  const rooms = new Map<string, { roomId: string | null; label: string; total: number; count: number; missing: number }>();
  for (const l of lines) {
    const rk = l.roomId ?? '';
    const ro = rooms.get(rk) ?? { roomId: l.roomId, label: l.room, total: 0, count: 0, missing: 0 };
    ro.total = round2(ro.total + (l.total ?? 0));
    ro.count += l.quantity;
    if (l.total === null) ro.missing++;
    rooms.set(rk, ro);
    const c = cats.get(l.category) ?? { category: l.category, label: l.categoryLabel, total: 0, count: 0, missing: 0 };
    c.total = round2(c.total + (l.total ?? 0));
    c.count += l.quantity;
    if (l.total === null) c.missing++;
    cats.set(l.category, c);
    const r = rets.get(l.retailer) ?? { retailer: l.retailer, total: 0, count: 0 };
    r.total = round2(r.total + (l.total ?? 0));
    r.count += l.quantity;
    rets.set(l.retailer, r);
  }
  return {
    lines,
    total: sum(() => true),
    confirmed: sum((l) => l.priceStatus === 'confirmed'),
    estimated: sum((l) => l.priceStatus === 'estimate'),
    userEntered: sum((l) => l.priceStatus === 'user'),
    missingCount: lines.filter((l) => l.priceStatus === 'missing').length,
    byCategory: [...cats.values()].sort((a, b) => b.total - a.total),
    byRetailer: [...rets.values()].sort((a, b) => b.total - a.total),
    byRoom: [...rooms.values()].sort(byRoomName),
  };
}

/** Rooms alphabetically, "Ohne Raum" last. */
function byRoomName(a: { roomId: string | null; label: string }, b: { roomId: string | null; label: string }): number {
  if ((a.roomId === null) !== (b.roomId === null)) return a.roomId === null ? 1 : -1;
  return a.label.localeCompare(b.label);
}

const STATUS_LABEL: Record<BudgetLine['priceStatus'], string> = {
  confirmed: 'bestätigt',
  estimate: 'Schätzung',
  user: 'eigene Angabe',
  missing: 'fehlt',
};

export function priceStatusLabel(s: BudgetLine['priceStatus']): string {
  return STATUS_LABEL[s];
}

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? v.toFixed(2).replace('.', ',') : v;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Identical items (same name, size, retailer, price, status and link) become one line with
 * the summed quantity – e.g. four identical chairs → "4". With `byRoom`, items in different
 * rooms stay separate lines.
 */
export function groupBudgetLines(lines: BudgetLine[], opts: { byRoom?: boolean } = {}): BudgetLine[] {
  const groups = new Map<string, BudgetLine>();
  for (const l of lines) {
    const key = [l.category, l.name, l.size, l.retailer, l.unitPrice, l.packSize, l.priceStatus, l.productUrl ?? '', opts.byRoom ? (l.roomId ?? '') : ''].join('\u0000');
    const g = groups.get(key);
    if (!g) groups.set(key, { ...l });
    else {
      g.quantity += l.quantity;
      g.packs += l.packs;
      g.total = g.total === null || l.total === null ? null : round2(g.total + l.total);
    }
  }
  return [...groups.values()];
}

/**
 * Shopping list as CSV (semicolon separated, German decimal comma – opens directly in Excel AT/DE).
 * With `byRoom` (#75) the first column is the room, lines are sorted by room and every room
 * ends with a subtotal row.
 */
export function budgetToCsv(b: BudgetSummary, opts: { byRoom?: boolean } = {}): string {
  const cols = ['Kategorie', 'Artikel', 'Maße B × T × H (cm)', 'Händler', 'Menge (Stück)', 'Stück pro Packung', 'Packungen', 'Preis pro Packung/Stück EUR', 'Stückpreis EUR', 'Summe EUR', 'Preisstatus', 'Produktlink'];
  const header = opts.byRoom ? ['Raum', ...cols] : cols;
  const row = (l: BudgetLine) => [l.categoryLabel, l.name, l.size, l.retailer, String(l.quantity), String(l.packSize), String(l.packs), l.unitPrice, l.piecePrice, l.total, STATUS_LABEL[l.priceStatus], l.productUrl ?? ''];
  const blank = (label: string, total: number | null) => ['', label, '', '', '', '', '', null, null, total, '', ''];
  const byName = (x: BudgetLine, y: BudgetLine) => x.categoryLabel.localeCompare(y.categoryLabel) || x.name.localeCompare(y.name);
  const out: (string | number | null)[][] = [];
  if (opts.byRoom) {
    const lines = groupBudgetLines(b.lines, { byRoom: true });
    for (const r of b.byRoom) {
      for (const l of lines.filter((x) => x.roomId === r.roomId).sort(byName)) out.push([r.label, ...row(l)]);
      out.push([r.label, ...blank(`Zwischensumme ${r.label}`, r.total)]);
    }
    out.push(['', ...blank('Gesamt (bekannte Preise)', b.total)]);
    if (b.missingCount) out.push(['', ...blank(`${b.missingCount} Position(en) ohne Preis`, null)]);
  } else {
    for (const l of groupBudgetLines(b.lines).sort(byName)) out.push(row(l));
    out.push(blank('Gesamt (bekannte Preise)', b.total));
    if (b.missingCount) out.push(blank(`${b.missingCount} Position(en) ohne Preis`, null));
  }
  return '\uFEFF' + [header.join(';'), ...out.map((r) => r.map(csvCell).join(';'))].join('\r\n');
}
