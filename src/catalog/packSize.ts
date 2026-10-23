/**
 * Multipacks: many products are sold as a set ("3er-Set", "4 Stück", "Packung à 6"). The price on the
 * page is then the price of the pack, not of one piece. `Price.packSize` holds the pieces per pack.
 */

export const MAX_PACK_SIZE = 999;

/** Pieces per pack from a product name / page text, or null when nothing in it says "multipack". Only a hint – the user confirms. */
export function detectPackSize(text: string | null | undefined): number | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /\b(\d{1,3})\s*[- ]?\s*(?:er|x)[- ]?(?:set|pack|packung|pk)\b/i, // 3er-Set, 3er Pack, 4x-Set
    /\b(\d{1,3})\s*[- ]?\s*(?:pack|pk|pcs|pieces)\b/i, // 3-pack, 3 pcs
    /\b(\d{1,3})\s*(?:st(?:ü|ue)ck|stk\.?|teile|teilig)\b/i, // 3 Stück, 4 Stk.
    /\b(?:packung|pack|set)\s*(?:à|a|mit|of|x)\s*(\d{1,3})\b/i, // Packung à 6, Set mit 4
    /\b(\d{1,3})\s*[- ]?\s*er[- ]?(?:packung|set)\b/i,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 2 && n <= 100) return n;
    }
  }
  return null;
}

/** Validates a pack size entered by the user or reported by a source; 1 and invalid values mean "no multipack". */
export function normalizePackSize(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isInteger(n) && n >= 2 && n <= MAX_PACK_SIZE ? n : undefined;
}

/** Packs to buy for `pieces` pieces (rounded up). */
export function packsNeeded(pieces: number, packSize = 1): number {
  return Math.max(1, Math.ceil(pieces / Math.max(1, packSize)));
}
