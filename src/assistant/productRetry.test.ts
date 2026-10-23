// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { localSample } from './claude';
import { EMPTY_WISHES, parseDesignAnswer, PLACEHOLDERS } from './design';
import { summarizePlan } from './planSummary';
import { buildFindPrompt, notSold, openPlaceholders, SEARCH_ATTEMPTS, searchErrorReason, searchTerms, searchWithRetry, type RetryHint } from './productSearch';

const SOFA = PLACEHOLDERS.find((c) => c.id === 'generic-sofa-3')!;
const OPTION = { catalogId: 'generic-sofa-3', reason: '', placeholder: true, label: 'Graues 3er-Sofa', search: 'Sofa 3-Sitzer grau' };
const fast = { busyWaitMs: 1 };

describe('Produktsuche fasst automatisch nach (#350)', () => {
  it('nichts gefunden → neuer Versuch mit Hinweis; Erfolg im 2. Versuch', async () => {
    const hints: (RetryHint | null)[] = [];
    const attempt = vi.fn(async (retry: RetryHint | null) => {
      hints.push(retry);
      return hints.length < 2 ? { ok: false as const, reason: 'kein passendes Produkt im Shop gefunden' } : { ok: true as const };
    });
    expect(await searchWithRetry(attempt, fast)).toEqual({ ok: true, attempts: 2 });
    expect(hints).toEqual([null, { attempt: 2, previous: 'kein passendes Produkt im Shop gefunden' }]);
  });

  it('Zeitlimit, unlesbare Antwort und Helferfehler werden wiederholt', async () => {
    const errors = [{ code: 'timeout' }, { code: 'invalid_json' }];
    const attempt = vi.fn(async () => {
      const e = errors.shift();
      if (e) throw e;
      return { ok: true as const };
    });
    expect(await searchWithRetry(attempt, fast)).toEqual({ ok: true, attempts: 3 });
  });

  it('nach allen Versuchen: Grund mit Anzahl; technischer Fehler wird als solcher gemeldet', async () => {
    const none = await searchWithRetry(async () => ({ ok: false as const, reason: 'kein passendes Produkt im Shop gefunden' }), fast);
    expect(none).toEqual({ ok: false, attempts: SEARCH_ATTEMPTS, reason: `kein passendes Produkt im Shop gefunden – nach ${SEARCH_ATTEMPTS} Versuchen`, error: false });
    const err = await searchWithRetry(async () => Promise.reject({ code: 'timeout' }), fast);
    expect(err.ok).toBe(false);
    expect(err.ok === false && err.error).toBe(true);
    expect(err.ok === false && err.reason).toMatch(/Zeitlimit/);
  });

  it('ausgelasteter Helfer: warten, ohne einen Versuch zu verbrauchen', async () => {
    let calls = 0;
    const attempt = vi.fn(async () => {
      calls++;
      if (calls <= 4) throw { code: 'busy' };
      return { ok: true as const };
    });
    expect(await searchWithRetry(attempt, { ...fast, attempts: 1 })).toEqual({ ok: true, attempts: 1 });
    expect(calls).toBe(5);
  });

  it('Stopp, Kontingent und „nicht verfügbar“ beenden sofort (kein Wiederholen)', async () => {
    for (const code of ['cancelled', 'rate_limited', 'tools_unavailable', 'not_granted']) {
      const attempt = vi.fn(async () => Promise.reject({ code }));
      await expect(searchWithRetry(attempt, fast)).rejects.toMatchObject({ code });
      expect(attempt).toHaveBeenCalledTimes(1);
    }
  });

  it('weitere Runde (after): zählt weiter und gibt den Hinweis gleich mit', async () => {
    const hints: (RetryHint | null)[] = [];
    const r = await searchWithRetry(
      async (h) => {
        hints.push(h);
        return { ok: false, reason: 'x' };
      },
      { ...fast, attempts: 1, after: { attempt: 4, previous: 'Zeitlimit' } },
    );
    expect(hints).toEqual([{ attempt: 4, previous: 'Zeitlimit' }]);
    expect(r).toMatchObject({ ok: false, attempts: 4 });
  });

  it('Stopp von außen: kein weiterer Versuch', async () => {
    const attempt = vi.fn(async () => ({ ok: false as const, reason: 'x' }));
    await searchWithRetry(attempt, { ...fast, stopped: () => true });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('Suchbegriffe: Claudes Begriff, Beschreibung, Platzhaltername ohne Maße; Wiederholung nimmt den nächsten', () => {
    const terms = searchTerms(OPTION, SOFA);
    expect(terms[0]).toBe('Sofa 3-Sitzer grau');
    expect(terms).toContain('Graues 3er-Sofa');
    expect(new Set(terms.map((t) => t.toLowerCase())).size).toBe(terms.length);
    const bed = PLACEHOLDERS.find((c) => c.id === 'generic-bed-140')!;
    expect(searchTerms({ ...OPTION, label: '', search: '' }, bed)[0]).toBe('Doppelbett');
    const first = buildFindPrompt(OPTION, SOFA, EMPTY_WISHES, 'ikea', 'web', 'R');
    expect(first).toContain('q=Sofa%203-Sitzer%20grau');
    expect(first).not.toContain('Versuch');
    const second = buildFindPrompt(OPTION, SOFA, EMPTY_WISHES, 'ikea', 'web', 'R', { attempt: 2, previous: 'kein passendes Produkt im Shop gefunden' });
    expect(second).toContain('q=Graues%203er-Sofa');
    expect(second).toContain('Versuch 2');
    expect(second).toContain('kein passendes Produkt im Shop gefunden');
    expect(second).not.toContain('Letzter Versuch');
    expect(buildFindPrompt(OPTION, SOFA, EMPTY_WISHES, 'ikea', 'web', 'R', { attempt: 3, previous: 'x' })).toContain('Letzter Versuch');
  });

  it('Fernseher, Waschmaschine & Co. werden nicht gesucht', () => {
    expect(notSold('generic-tv')).toBe(true);
    expect(notSold('generic-sofa-3')).toBe(false);
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
    const plan = summarizePlan(p);
    const r = parseDesignAnswer({ rooms: [{ room: 'R1', items: [{ catalogId: 'generic-tv', label: 'TV', search: 'Fernseher' }, { catalogId: 'generic-sofa-3', label: 'Sofa', search: 'Sofa' }] }] }, plan, [p.rooms[0].id], []);
    expect(openPlaceholders(r).map((t) => r.rooms[0].picks[t.index].catalogId)).toEqual(['generic-sofa-3']);
  });

  it('Helfer ausgelastet (busy) ≠ Kontingent erreicht', async () => {
    const reply = (body: object) => vi.fn(async (url: string) => (url.endsWith('/status') ? new Response(JSON.stringify({ name: 'wohnungsplaner-ikea-helper', claude: true })) : new Response(JSON.stringify(body), { status: 429 })));
    const busy = await localSample('http://h', reply({ error: 'beschäftigt', busy: true }) as unknown as typeof fetch);
    await expect(busy!.json('x')).rejects.toMatchObject({ code: 'busy' });
    const quota = await localSample('http://h', reply({ error: 'usage limit' }) as unknown as typeof fetch);
    await expect(quota!.json('x')).rejects.toMatchObject({ code: 'rate_limited' });
    expect(searchErrorReason({ code: 'busy' })).toMatch(/ausgelastet/);
  });
});
