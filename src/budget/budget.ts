import { categoryLabel } from '../catalog/types';
import type { Furniture } from '../model/schema';

export interface BudgetLine {
  id: string;
  name: string;
  category: string;
  categoryLabel: string;
  retailer: string;
  quantity: number;
  unitPrice: number | null;
  total: number | null;
  priceStatus: 'confirmed' | 'estimate' | 'user' | 'missing';
  productUrl?: string;
  generated: boolean;
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
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function computeBudget(items: Furniture[]): BudgetSummary {
  const lines: BudgetLine[] = items.map((f) => {
    const unit = f.price ? f.price.amount : null;
    return {
      id: f.id,
      name: f.name,
      category: f.category,
      categoryLabel: categoryLabel(f.category),
      retailer: f.retailer?.trim() || 'Ohne Händler',
      quantity: f.quantity,
      unitPrice: unit,
      total: unit === null ? null : round2(unit * f.quantity),
      priceStatus: f.price ? f.price.status : 'missing',
      productUrl: f.productUrl,
      generated: !!f.kitchen?.generated,
    };
  });
  const sum = (pred: (l: BudgetLine) => boolean) => round2(lines.filter(pred).reduce((s, l) => s + (l.total ?? 0), 0));
  const cats = new Map<string, { category: string; label: string; total: number; count: number; missing: number }>();
  const rets = new Map<string, { retailer: string; total: number; count: number }>();
  for (const l of lines) {
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
  };
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

/** Shopping list as CSV (semicolon separated, German decimal comma – opens directly in Excel AT/DE). */
export function budgetToCsv(b: BudgetSummary): string {
  const header = ['Kategorie', 'Artikel', 'Händler', 'Menge', 'Einzelpreis EUR', 'Summe EUR', 'Preisstatus', 'Produktlink'];
  const rows = [...b.lines]
    .sort((x, y) => x.categoryLabel.localeCompare(y.categoryLabel) || x.name.localeCompare(y.name))
    .map((l) => [l.categoryLabel, l.name, l.retailer, String(l.quantity), l.unitPrice, l.total, STATUS_LABEL[l.priceStatus], l.productUrl ?? ''].map(csvCell).join(';'));
  rows.push(['', 'Gesamt (bekannte Preise)', '', '', null, b.total, '', ''].map(csvCell).join(';'));
  if (b.missingCount) rows.push(['', `${b.missingCount} Position(en) ohne Preis`, '', '', null, null, '', ''].map(csvCell).join(';'));
  return '\uFEFF' + [header.join(';'), ...rows].join('\r\n');
}
