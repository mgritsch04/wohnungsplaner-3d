/** Text matching of the feature search (#461): case-, accent- and umlaut-insensitive, every word must match. */

/** Lower case, umlauts as ae/oe/ue/ss and without accents, so „Kuche“, „küche“ and „kueche“ all match. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Same as normalize, but umlauts become plain vowels (a typed „kuche“ should find „Küche“). */
function plain(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');
}

export interface Searchable {
  title: string;
  group: string;
  keywords?: string;
}

/**
 * Score of one entry for the query (higher = better), or 0 if a word of the query is missing.
 * Title hits weigh more than group or keyword hits; word starts more than inner hits.
 */
export function scoreEntry(entry: Searchable, query: string): number {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  const fields = [
    { text: entry.title, weight: 10 },
    { text: entry.keywords ?? '', weight: 4 },
    { text: entry.group, weight: 3 },
  ].map((f) => ({ ...f, forms: [normalize(f.text), plain(f.text)] }));
  let total = 0;
  for (const raw of words) {
    const variants = [normalize(raw), plain(raw)];
    let best = 0;
    for (const f of fields) {
      for (const form of f.forms) {
        for (const w of variants) {
          const at = form.indexOf(w);
          if (at < 0) continue;
          const wordStart = at === 0 || /[^a-z0-9]/.test(form[at - 1]);
          const s = f.weight * (at === 0 ? 3 : wordStart ? 2 : 1);
          if (s > best) best = s;
        }
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Entries matching the query, best first; ties keep the original order. */
export function searchEntries<T extends Searchable>(entries: readonly T[], query: string, limit = 40): T[] {
  if (!query.trim()) return entries.slice(0, limit);
  return entries
    .map((e, i) => ({ e, i, s: scoreEntry(e, query) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((r) => r.e);
}
