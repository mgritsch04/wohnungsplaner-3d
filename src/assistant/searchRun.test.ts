// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SEARCH_ATTEMPTS, searchWithRetry, type AttemptResult, type RetryHint, type SearchOutcome } from './productSearch';
import { runSearchRounds, runText, SEARCH_ROUNDS, type RoundRequest, type RunProgress } from './searchRun';

const key = (t: string) => t;
const fast = { busyWaitMs: 1 };

/** Helper mocked per piece: a list of answers, one per attempt (true = found, 'none' = not in the shop, else an error code). */
function mockHelper(plan: Record<string, (true | 'none' | string)[]>) {
  const calls: { piece: string; retry: RetryHint | null; round: number }[] = [];
  const search = async (piece: string, req: RoundRequest): Promise<SearchOutcome | null> => {
    const attempt = async (retry: RetryHint | null): Promise<AttemptResult> => {
      calls.push({ piece, retry, round: req.round });
      const next = plan[piece].shift() ?? 'none';
      if (next === true) return { ok: true };
      if (next === 'none') return { ok: false, reason: 'kein passendes Produkt im Shop gefunden' };
      throw { code: next };
    };
    return searchWithRetry(attempt, { ...fast, attempts: req.attempts, ...(req.after ? { after: req.after } : {}) });
  };
  return { calls, search };
}

describe('Produktsuche läuft von selbst durch (#350)', () => {
  it('ein Lauf: Zeitlimits werden in weiteren Runden nachgeholt, bis alles gefunden ist', async () => {
    // 45 Stück wie bei G: jedes dritte läuft zuerst dreimal ins Zeitlimit, findet aber in Runde 2 etwas
    const pieces = Array.from({ length: 45 }, (_, i) => `Stück ${i + 1}`);
    const plan = Object.fromEntries(pieces.map((p, i) => [p, i % 3 === 0 ? ['timeout', 'timeout', 'timeout', true as const] : [true as const]]));
    const { calls, search } = mockHelper(plan);
    const seen: RunProgress[] = [];
    const { results, rounds } = await runSearchRounds(pieces, { key, search, parallel: 3, onProgress: (p) => seen.push(p) });
    expect(rounds).toBe(2);
    expect([...results.values()].every((r) => r.ok)).toBe(true);
    expect(seen.at(-1)).toEqual({ done: 45, total: 45, round: 2 });
    // progress never goes backwards
    for (let i = 1; i < seen.length; i++) expect(seen[i].done).toBeGreaterThanOrEqual(seen[i - 1].done);
    // round 2 is one more attempt with the history (attempt 4, previous reason)
    const late = calls.filter((c) => c.round === 2);
    expect(late).toHaveLength(15);
    expect(late[0].retry).toEqual({ attempt: SEARCH_ATTEMPTS + 1, previous: `Zeitlimit von 5 Minuten überschritten – nach ${SEARCH_ATTEMPTS} Versuchen` });
  });

  it('„nicht im Shop“ ist nach den Versuchen der ersten Runde erledigt und wird nicht wiederholt', async () => {
    const { calls, search } = mockHelper({ Monstera: ['none', 'none', 'none'], Sofa: [true] });
    const { results, rounds } = await runSearchRounds(['Monstera', 'Sofa'], { key, search, parallel: 3 });
    expect(rounds).toBe(1);
    expect(calls.filter((c) => c.piece === 'Monstera')).toHaveLength(SEARCH_ATTEMPTS);
    expect(results.get('Monstera')).toMatchObject({ ok: false, error: false });
  });

  it('dauerhafter technischer Fehler: höchstens SEARCH_ROUNDS Runden, dann erledigt', async () => {
    const { calls, search } = mockHelper({ Lampe: Array(20).fill('invalid_json') });
    const seen: RunProgress[] = [];
    const { results, rounds } = await runSearchRounds(['Lampe'], { key, search, parallel: 1, onProgress: (p) => seen.push(p) });
    expect(rounds).toBe(SEARCH_ROUNDS);
    expect(calls).toHaveLength(SEARCH_ATTEMPTS + SEARCH_ROUNDS - 1);
    expect(results.get('Lampe')).toMatchObject({ ok: false, error: true, attempts: SEARCH_ATTEMPTS + SEARCH_ROUNDS - 1 });
    expect(seen.at(-1)).toEqual({ done: 1, total: 1, round: SEARCH_ROUNDS });
  });

  it('Stopp (Nutzer oder Kontingent) beendet den Lauf ohne weitere Runden', async () => {
    let halt = false;
    const tried: string[] = [];
    const search = async (piece: string): Promise<SearchOutcome | null> => {
      tried.push(piece);
      if (piece === 'B') {
        halt = true;
        return null;
      }
      return { ok: false, attempts: 3, reason: 'Zeitlimit', error: true };
    };
    const { rounds } = await runSearchRounds(['A', 'B', 'C', 'D'], { key, search, parallel: 1, stopped: () => halt });
    expect(tried).toEqual(['A', 'B']);
    expect(rounds).toBe(1);
  });

  it('doppelte Einträge werden nur einmal gesucht', async () => {
    const { calls, search } = mockHelper({ Sofa: [true] });
    const { results } = await runSearchRounds(['Sofa', 'Sofa'], { key, search, parallel: 2 });
    expect(calls).toHaveLength(1);
    expect(results.size).toBe(1);
  });

  it('Fortschrittstext: x von y, Runde n', () => {
    expect(runText({ done: 12, total: 45, round: 1 })).toBe('12 von 45 fertig');
    expect(runText({ done: 40, total: 45, round: 2 })).toBe('40 von 45 fertig – Runde 2 (nochmal, was an Zeit oder Technik scheiterte)');
    expect(runText({ done: 45, total: 45, round: 1 })).toBe('alle 45 fertig');
  });
});
