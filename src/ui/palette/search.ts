/**
 * Search for the command palette: forgiving about case, umlauts (ä = a = ae) and word order.
 * Every word typed must be found in the command's name, keywords or group.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export interface Searchable {
  label: string;
  keywords?: string;
  group: string;
}

/** Score of one word against a text (higher = better, 0 = no match). */
function wordScore(word: string, label: string, rest: string): number {
  if (label.startsWith(word)) return 100;
  if (label.split(/[^a-z0-9]+/).some((w) => w.startsWith(word))) return 80;
  if (label.includes(word)) return 60;
  if (rest.split(/[^a-z0-9]+/).some((w) => w.startsWith(word))) return 40;
  if (rest.includes(word)) return 25;
  return 0;
}

/** Score of a command for a query; 0 = does not match. Empty query matches everything. */
export function scoreCommand(query: string, c: Searchable): number {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const label = normalize(c.label);
  const rest = normalize(`${c.keywords ?? ''} ${c.group}`);
  let total = 0;
  for (const w of words) {
    const s = wordScore(w, label, rest);
    if (!s) return 0;
    total += s;
  }
  return total;
}

/** Filters and sorts by score (stable: same score keeps the original order). */
export function searchCommands<T extends Searchable>(query: string, commands: readonly T[]): T[] {
  return commands
    .map((c, i) => ({ c, i, s: scoreCommand(query, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
