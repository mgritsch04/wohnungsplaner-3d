/**
 * One product search run over many placeholders (#350): it goes on by itself until every piece is
 * found or settled as „nicht gefunden“, instead of stopping after a fixed time and leaving the rest
 * to „Nachsuchen“. Round 1 searches every piece (`SEARCH_ATTEMPTS` attempts, search terms getting
 * more general); later rounds take only the pieces whose last attempt failed for a technical reason
 * (time-out, busy helper, unreadable answer) – one more attempt each, with more time. A piece Claude
 * did not find in the shop after all attempts is settled and not searched again in this run.
 */
import { runPool } from './pool';
import { SEARCH_ATTEMPTS, type RetryHint, type SearchOutcome } from './productSearch';

/** Rounds of one run: the first plus up to three for pieces with a technical failure. */
export const SEARCH_ROUNDS = 4;

/** Progress of a run: settled pieces of all, and the current round. */
export interface RunProgress {
  done: number;
  total: number;
  round: number;
}

/** How one piece is searched in a round: number of attempts, and for later rounds what went wrong before. */
export interface RoundRequest {
  round: number;
  attempts: number;
  after?: RetryHint;
}

/**
 * Searches all `targets` in rounds with at most `parallel` at once. `search` returns the outcome of
 * one piece, or null when it was not searched (piece gone, or the run is ending: stop, quota). The
 * run ends early when `stopped()` is true. Returns the last outcome per key and the rounds used.
 */
export async function runSearchRounds<T>(
  targets: readonly T[],
  {
    key,
    search,
    parallel,
    rounds = SEARCH_ROUNDS,
    stopped = () => false,
    onProgress,
  }: {
    key: (t: T) => string;
    search: (t: T, request: RoundRequest) => Promise<SearchOutcome | null>;
    parallel: number;
    rounds?: number;
    stopped?: () => boolean;
    onProgress?: (p: RunProgress) => void;
  },
): Promise<{ results: Map<string, SearchOutcome>; rounds: number }> {
  const results = new Map<string, SearchOutcome>();
  let open = targets.filter((t, i) => targets.findIndex((x) => key(x) === key(t)) === i);
  const total = open.length;
  let done = 0;
  let round = 0;
  while (open.length && round < rounds && !stopped()) {
    round++;
    const last = round === rounds;
    const current = round;
    onProgress?.({ done, total, round });
    await runPool(
      open,
      parallel,
      async (t) => {
        const before = results.get(key(t));
        const request: RoundRequest =
          current === 1 || !before || before.ok ? { round: current, attempts: SEARCH_ATTEMPTS } : { round: current, attempts: 1, after: { attempt: before.attempts + 1, previous: before.reason } };
        const r = await search(t, request);
        if (r) results.set(key(t), r);
        // settled: found, not in the shop, or the last round is over; a technical failure waits for the next round
        if (r ? r.ok || !r.error || last : !stopped()) done++;
        onProgress?.({ done, total, round: current });
      },
      stopped,
    );
    open = open.filter((t) => {
      const r = results.get(key(t));
      return !!r && !r.ok && r.error;
    });
  }
  return { results, rounds: round };
}

/** „12 von 45 fertig – Runde 2“: progress line of a run (the round only once there is a second one). */
export function runText(p: RunProgress): string {
  const base = p.done >= p.total ? `alle ${p.total} fertig` : `${p.done} von ${p.total} fertig`;
  return p.round > 1 ? `${base} – Runde ${p.round} (nochmal, was an Zeit oder Technik scheiterte)` : base;
}
