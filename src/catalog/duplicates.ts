import type { Furniture, Project } from '../model/schema';
import type { CatalogItem } from './types';

/**
 * Duplicate detection and merging for imported catalog entries (IKEA/Möbelix …).
 * Pure functions – the UI and the store only call them. Entries count as the same product when they share
 * an article number, a product URL, or (weakest) name + footprint + height within 1 cm.
 */

export type DuplicateReason = 'article' | 'url' | 'name';

export const REASON_LABEL: Record<DuplicateReason, string> = {
  article: 'gleiche Artikelnummer',
  url: 'gleiche Produktseite',
  name: 'gleicher Name und gleiche Maße',
};

const REASON_RANK: Record<DuplicateReason, number> = { article: 0, url: 1, name: 2 };

/** Digits of an article number as written in tags, ids or IKEA URLs (`123.456.78`, `s12345678`), or undefined. */
export function articleKey(item: CatalogItem): string | undefined {
  for (const t of item.tags) {
    const digits = t.replace(/[.\s-]/g, '');
    if (/^s?\d{6,}$/i.test(digits)) return digits.replace(/^s/i, '');
  }
  const fromUrl = item.productUrl?.match(/-s?(\d{8})\/?(?:[?#]|$)/i);
  return fromUrl?.[1];
}

/** Product URL without scheme, `www.`, query, hash and trailing slash. */
export function urlKey(item: CatalogItem): string | undefined {
  if (!item.productUrl) return undefined;
  try {
    const u = new URL(item.productUrl);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return undefined;
  }
}

const cm = (m: number) => Math.round(m * 100);

/** Name and sizes (width/depth order does not matter), same category. */
export function nameKey(item: CatalogItem): string | undefined {
  const name = item.name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '');
  if (name.length < 3) return undefined;
  const [a, b] = [cm(item.width), cm(item.depth)].sort((x, y) => x - y);
  return `${item.category}|${name}|${a}x${b}x${cm(item.height)}`;
}

export interface DuplicateMember {
  item: CatalogItem;
  /** Number of placements in the plan that reference this catalog entry. */
  used: number;
}

export interface DuplicateGroup {
  id: string;
  reason: DuplicateReason;
  members: DuplicateMember[];
  /** Entry to keep by default: used most, then with 3D model, price, photo, link. */
  keepId: string;
}

export function usageCounts(project: Pick<Project, 'furniture'>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const f of project.furniture) if (f.catalogId) counts.set(f.catalogId, (counts.get(f.catalogId) ?? 0) + 1);
  return counts;
}

const quality = (i: CatalogItem) =>
  (i.model.type === 'gltf' ? 8 : 0) + (i.price ? 4 : 0) + (i.imageUrl ? 2 : 0) + (i.productUrl ? 1 : 0);

/** Default entry to keep: most placements, then best data, then the first one in the list. */
export function chooseKeeper(members: DuplicateMember[]): string {
  let best = members[0];
  for (const m of members.slice(1)) {
    if (m.used > best.used || (m.used === best.used && quality(m.item) > quality(best.item))) best = m;
  }
  return best.item.id;
}

/** Groups of imported entries that look like the same product, strongest evidence first. */
export function findDuplicateGroups(items: CatalogItem[], project: Pick<Project, 'furniture'>): DuplicateGroup[] {
  const imported = items.filter((i) => i.source === 'imported');
  const parent = imported.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map<number, Set<DuplicateReason>>();
  const link = (reason: DuplicateReason, keyOf: (i: CatalogItem) => string | undefined) => {
    const first = new Map<string, number>();
    imported.forEach((it, idx) => {
      const k = keyOf(it);
      if (!k) return;
      const o = first.get(k);
      if (o === undefined) first.set(k, idx);
      else {
        parent[find(idx)] = find(o);
        for (const n of [idx, o]) (reasons.get(n) ?? reasons.set(n, new Set()).get(n)!).add(reason);
      }
    });
  };
  link('article', articleKey);
  link('url', urlKey);
  link('name', nameKey);

  const used = usageCounts(project);
  const byRoot = new Map<number, number[]>();
  imported.forEach((_, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]));
  const groups: DuplicateGroup[] = [];
  for (const idxs of byRoot.values()) {
    if (idxs.length < 2) continue;
    const members = idxs.map((i) => ({ item: imported[i], used: used.get(imported[i].id) ?? 0 }));
    const all = new Set<DuplicateReason>();
    for (const i of idxs) reasons.get(i)?.forEach((r) => all.add(r));
    const reason = [...all].sort((a, b) => REASON_RANK[a] - REASON_RANK[b])[0] ?? 'name';
    groups.push({ id: members.map((m) => m.item.id).sort()[0], reason, members, keepId: chooseKeeper(members) });
  }
  return groups.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || a.members[0].item.name.localeCompare(b.members[0].item.name, 'de'));
}

export interface MergePreview {
  keep: CatalogItem;
  remove: CatalogItem[];
  /** Placements in the plan that move to the kept entry. */
  rehomed: number;
  /** Fields the kept entry takes over from removed ones because it lacked them. */
  filled: string[];
}

/** The kept entry gets what it lacks (3D model, price, photo, link, brand, retailer) from the removed ones. */
export function mergeItems(keep: CatalogItem, remove: CatalogItem[]): { item: CatalogItem; filled: string[] } {
  const item: CatalogItem = { ...keep, tags: [...keep.tags] };
  const filled: string[] = [];
  for (const r of remove) {
    if (item.model.type !== 'gltf' && r.model.type === 'gltf') {
      item.model = r.model;
      item.approximate = r.approximate;
      if (r.modelFile) item.modelFile = r.modelFile;
      filled.push('3D-Modell');
    }
    const fill = <K extends 'price' | 'imageUrl' | 'productUrl' | 'brand' | 'retailer'>(k: K, label: string) => {
      if (item[k] === undefined && r[k] !== undefined) {
        item[k] = r[k];
        filled.push(label);
      }
    };
    fill('price', 'Preis');
    fill('imageUrl', 'Foto');
    fill('productUrl', 'Produktlink');
    fill('brand', 'Marke');
    fill('retailer', 'Händler');
    for (const t of r.tags) if (!item.tags.includes(t)) item.tags.push(t);
  }
  return { item, filled: [...new Set(filled)] };
}

export function previewMerge(group: DuplicateGroup, keepId: string, project: Pick<Project, 'furniture'>): MergePreview {
  const keep = group.members.find((m) => m.item.id === keepId)?.item ?? group.members[0].item;
  const remove = group.members.filter((m) => m.item.id !== keep.id).map((m) => m.item);
  const gone = new Set(remove.map((r) => r.id));
  const rehomed = project.furniture.filter((f) => f.catalogId && gone.has(f.catalogId)).length;
  return { keep, remove, rehomed, filled: mergeItems(keep, remove).filled };
}

/** Point placements of removed entries at the kept one. Placed pieces keep their own copy of size, look and price. */
export function rehomeFurniture(furniture: Furniture[], removeIds: ReadonlySet<string>, keepId: string): number {
  let n = 0;
  for (const f of furniture) {
    if (f.catalogId && removeIds.has(f.catalogId)) {
      f.catalogId = keepId;
      n++;
    }
  }
  return n;
}

/** Catalog list after the merge: kept entry updated, removed ones gone. */
export function applyMergeToCatalog(items: CatalogItem[], keepId: string, removeIds: ReadonlySet<string>): CatalogItem[] {
  const keep = items.find((i) => i.id === keepId);
  if (!keep) return items;
  const { item } = mergeItems(
    keep,
    items.filter((i) => removeIds.has(i.id)),
  );
  return items.filter((i) => !removeIds.has(i.id)).map((i) => (i.id === keepId ? item : i));
}
