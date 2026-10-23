// @vitest-environment node
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { checkClaude, claudeArgs, findClaude, INSTALL_HELP, resultText, runClaude } from '../../scripts/lib/claude-cli.mjs';
import { isIkeaItem, isMoebelixItem } from '../catalog/ikeaSelection';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { jsonFromText, localSample, type McpRuntime } from './claude';
import { EMPTY_WISHES, parseDesignAnswer, PLACEHOLDERS, realProducts, swapPick } from './design';
import { summarizePlan } from './planSummary';
import { browserTools, buildFindPrompt, foundId, foundToCatalog, parseFound, replaceWithFound, searchTargets, shopOf } from './productSearch';

const SOFA = PLACEHOLDERS.find((c) => c.id === 'generic-sofa-3')!;

describe('Produktsuche durch Claude (#350, Stufe 3)', () => {
  it('nur Seiten von IKEA Österreich und Möbelix', () => {
    expect(shopOf('https://www.ikea.com/at/de/p/testsofa-12345678/')).toBe('IKEA');
    expect(shopOf('https://www.moebelix.at/p/testsofa')).toBe('Möbelix');
    expect(shopOf('https://www.ikea.com/de/de/p/x/')).toBeNull();
    expect(shopOf('http://www.ikea.com/at/de/')).toBeNull();
    expect(shopOf('https://evil.example/at/')).toBeNull();
    expect(shopOf('kein link')).toBeNull();
  });

  it('Bericht von Claude wird geprüft: Shop, plausible Maße und Preis, höchstens drei, keine Doppelten', () => {
    const found = parseFound({
      products: [
        { name: 'TESTSOFA 3er', url: 'https://www.ikea.com/at/de/p/testsofa-12345678/', price: '499,00 €', width_cm: 228, depth_cm: 95, height_cm: 83, why: 'Passt.' },
        { name: 'Doppelt', url: 'https://www.ikea.com/at/de/p/testsofa-12345678/', price: 1, width_cm: 1, depth_cm: 1, height_cm: 1 },
        { name: 'Fremder Shop', url: 'https://example.com/sofa', price: 99, width_cm: 200, depth_cm: 90, height_cm: 80 },
        { name: 'Ohne Maße', url: 'https://www.moebelix.at/p/a', price: 99 },
        { name: 'Ohne Preis', url: 'https://www.moebelix.at/p/b', width_cm: 200, depth_cm: 90, height_cm: 80 },
        { name: 'TESTSOFA Möbelix', url: 'https://www.moebelix.at/p/c', price: 399, width_cm: 210, depth_cm: 92, height_cm: 85 },
        { name: 'Drittes', url: 'https://www.moebelix.at/p/d', price: 299, width_cm: 190, depth_cm: 88, height_cm: 80 },
        { name: 'Viertes', url: 'https://www.moebelix.at/p/e', price: 199, width_cm: 190, depth_cm: 88, height_cm: 80 },
      ],
    });
    expect(found.map((f) => f.name)).toEqual(['TESTSOFA 3er', 'TESTSOFA Möbelix', 'Drittes']);
    expect(found[0]).toMatchObject({ shop: 'IKEA', price: 499, width: 2.28, depth: 0.95, height: 0.83, why: 'Passt.' });
    expect(parseFound('Unsinn')).toEqual([]);
  });

  it('Fund wird Katalogeintrag des Händlers mit Quelle, Form des Platzhalters und bestätigtem Preis', () => {
    const [f] = parseFound({ products: [{ name: 'TESTSOFA Möbelix', url: 'https://www.moebelix.at/p/c', price: 399, width_cm: 210, depth_cm: 92, height_cm: 85 }] });
    const item = foundToCatalog(f, SOFA, '2026-10-23');
    expect(item).toMatchObject({ id: foundId('https://www.moebelix.at/p/c'), category: 'sofa', width: 2.1, retailer: 'Möbelix Österreich', productUrl: 'https://www.moebelix.at/p/c', price: { amount: 399, status: 'confirmed', recordedAt: '2026-10-23' }, source: 'imported' });
    expect(item.model).toEqual(SOFA.model);
    expect(isMoebelixItem(item)).toBe(true);
    expect(realProducts([item]).map((c) => c.id)).toEqual([item.id]);
    const [ik] = parseFound({ products: [{ name: 'TESTSOFA', url: 'https://www.ikea.com/at/de/p/x-12345678/', price: 499, width_cm: 228, depth_cm: 95, height_cm: 83 }] });
    expect(isIkeaItem(foundToCatalog(ik, SOFA))).toBe(true);
  });

  it('Platzhalter wird durch den Fund ersetzt; weitere Funde und Platzhalter werden Alternativen', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
    const plan = summarizePlan(p);
    const r = parseDesignAnswer({ rooms: [{ room: 'R1', items: [{ catalogId: 'generic-sofa-3', label: 'Graues Sofa', search: 'Sofa grau', reason: 'Gemütlich.' }] }] }, plan, [p.rooms[0].id], []);
    const next = replaceWithFound(r, p.rooms[0].id, 0, [
      { id: 'found-a', why: 'Grau, 3-sitzig.' },
      { id: 'found-b', why: '' },
    ]);
    const pick = next.rooms[0].picks[0];
    expect(pick).toMatchObject({ catalogId: 'found-a', placeholder: false, reason: 'Grau, 3-sitzig.', quantity: 1 });
    expect(pick.alternatives.map((a) => a.catalogId)).toEqual(['found-b', 'generic-sofa-3']);
    expect(pick.alternatives[0].reason).toBe('Gemütlich.');
    // back to the placeholder
    expect(swapPick(next, p.rooms[0].id, 0, 1).rooms[0].picks[0]).toMatchObject({ catalogId: 'generic-sofa-3', placeholder: true, label: 'Graues Sofa' });
    expect(replaceWithFound(r, p.rooms[0].id, 0, [])).toBe(r);
  });

  it('Suchauftrag nennt Wunsch, Größe, Stil und Suchseiten', () => {
    const prompt = buildFindPrompt({ catalogId: 'generic-sofa-3', reason: 'Für Gaming-Abende.', placeholder: true, label: 'Graues 3er-Sofa', search: 'Sofa grau' }, SOFA, { ...EMPTY_WISHES, style: 'skandinavisch' }, 'both', 'browser', 'Wohnzimmer');
    expect(prompt).toContain('Graues 3er-Sofa – Für Gaming-Abende.');
    expect(prompt).toContain('210×90×82 cm');
    expect(prompt).toContain('Stil: skandinavisch');
    expect(prompt).toContain('https://www.ikea.com/at/de/search/?q=Sofa%20grau');
    expect(prompt).toContain('open_page');
    expect(buildFindPrompt({ catalogId: 'x', reason: '', placeholder: true, label: 'x', search: 'x' }, SOFA, EMPTY_WISHES, 'ikea', 'web', 'R')).toContain('Websuche');
    expect(prompt).toContain('BEIDEN Shops');
    expect(buildFindPrompt({ catalogId: 'x', reason: '', placeholder: true, label: 'x', search: 'x' }, SOFA, EMPTY_WISHES, 'ikea', 'web', 'R')).not.toContain('BEIDEN');
  });

  it('Browser-Werkzeuge öffnen nur Shop-Seiten und liefern gekürzten Text', async () => {
    const calls: [string, unknown][] = [];
    const mcp: McpRuntime = {
      callTool: async (_server, tool, input) => {
        calls.push([tool, input]);
        return { content: [{ type: 'text', text: tool === 'get_page_text' ? 'x'.repeat(20000) : 'ok' }] };
      },
      listTools: async () => ({ servers: [] }),
    };
    const [open, links] = browserTools(mcp);
    await expect(Promise.resolve(open.execute({ url: 'https://example.com/' }))).rejects.toThrow();
    expect(calls).toEqual([]);
    const out = (await open.execute({ url: 'https://www.ikea.com/at/de/search/?q=sofa' })) as string;
    expect(out.length).toBe(9000);
    expect(calls.map((c) => c[0])).toEqual(['navigate', 'get_page_text']);
    expect(calls[0][1]).toEqual({ url: 'https://www.ikea.com/at/de/search/?q=sofa' });
    expect(await links.execute({})).toBe('ok');
  });
});

describe('Claude im lokalen Planer über den Helfer (#350)', () => {
  it('JSON aus Antworttext (auch mit Codeblock oder Text drumherum)', () => {
    expect(jsonFromText('{"a":1}')).toEqual({ a: 1 });
    expect(jsonFromText('Hier:\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
    expect(jsonFromText('Ergebnis: {"a":3} fertig')).toEqual({ a: 3 });
    expect(() => jsonFromText('nichts')).toThrow();
  });

  it('nur verfügbar, wenn der Helfer Claude Code meldet; Anfrage geht an POST /claude', async () => {
    const fetchNo = vi.fn(async () => new Response(JSON.stringify({ ok: true, name: 'wohnungsplaner-ikea-helper', claude: false })));
    expect(await localSample('http://h', fetchNo as unknown as typeof fetch)).toBeNull();
    const fetchErr = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await localSample('http://h', fetchErr as unknown as typeof fetch)).toBeNull();

    const seen: { url: string; body?: string }[] = [];
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, body: init?.body as string | undefined });
      if (url.endsWith('/status')) return new Response(JSON.stringify({ ok: true, name: 'wohnungsplaner-ikea-helper', claude: true }));
      return new Response(JSON.stringify({ text: 'Antwort: {"products":[]}' }));
    });
    const s = await localSample('http://h', f as unknown as typeof fetch);
    expect(s?.kind).toBe('local');
    expect(await s!.json('Frage', { web: true })).toEqual({ products: [] });
    expect(seen[1]).toEqual({ url: 'http://h/claude', body: JSON.stringify({ prompt: 'Frage', web: true }) });

    const busy = vi.fn(async (url: string) => (url.endsWith('/status') ? new Response(JSON.stringify({ name: 'wohnungsplaner-ikea-helper', claude: true })) : new Response(JSON.stringify({ error: 'busy' }), { status: 429 })));
    const b = await localSample('http://h', busy as unknown as typeof fetch);
    await expect(b!.json('x')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('Kommandozeile: nur Websuche und die zwei Shops, Shell und Schreiben gesperrt', () => {
    const plain = claudeArgs();
    expect(plain).toContain('-p');
    expect(plain).not.toContain('--allowedTools');
    const web = claudeArgs({ web: true });
    const allowed = web[web.indexOf('--allowedTools') + 1];
    expect(allowed).toBe('WebSearch,WebFetch(domain:www.ikea.com),WebFetch(domain:www.moebelix.at),WebFetch(domain:moebelix.at)');
    expect(web[web.indexOf('--disallowedTools') + 1]).toContain('Bash');
    expect(resultText(JSON.stringify({ type: 'result', result: 'hallo', is_error: false }))).toBe('hallo');
    expect(resultText(JSON.stringify([{ type: 'system' }, { type: 'result', result: 'b' }]))).toBe('b');
    expect(() => resultText(JSON.stringify({ type: 'result', result: 'kaputt', is_error: true }))).toThrow('kaputt');
    expect(() => resultText('kein json')).toThrow();
  });

  it('Kommandozeile: Anfrage über stdin, Antwort aus der JSON-Ausgabe (nachgebildetes claude)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fake-claude-'));
    const bin = join(dir, 'claude');
    writeFileSync(
      bin,
      `#!/usr/bin/env node
let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: 'Echo: ' + input + ' | ' + process.argv.slice(2).join(' ') })));
`,
    );
    chmodSync(bin, 0o755);
    const text = await runClaude('Hallo Claude', { web: true, bin });
    expect(text).toContain('Echo: Hallo Claude');
    expect(text).toContain('--allowedTools WebSearch');
    await expect(runClaude('x', { bin: join(dir, 'gibt-es-nicht') })).rejects.toThrow('nicht gefunden');
  });

  describe('Claude Code finden (Windows-Pfade gemockt)', () => {
    const win = (files: string[], env: Record<string, string> = {}) => ({
      platform: 'win32',
      env: { USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming', PATH: 'C:\\Windows;C:\\nodejs', ...env },
      exists: (f: string) => files.includes(f),
      home: 'C:\\Users\\x',
      nodePath: 'C:\\nodejs\\node.exe',
    });
    it('nativer Installer: claude.exe in .local\\bin, ohne Shell', () => {
      expect(findClaude(win(['C:\\Users\\x\\.local\\bin\\claude.exe']))).toEqual({ file: 'C:\\Users\\x\\.local\\bin\\claude.exe', prefix: [], shell: false });
    });
    it('npm-Starter claude.cmd wird auf cli.js über node aufgelöst', () => {
      const dir = 'C:\\Users\\x\\AppData\\Roaming\\npm';
      const r = findClaude(win([`${dir}\\claude.cmd`, `${dir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`]));
      expect(r).toEqual({ file: 'C:\\nodejs\\node.exe', prefix: [`${dir}\\node_modules\\@anthropic-ai\\claude-code\\cli.js`], shell: false });
    });
    it('npm-Starter mit eingebauter claude.exe', () => {
      const dir = 'C:\\nodejs';
      const exe = `${dir}\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe`;
      expect(findClaude(win([`${dir}\\claude.cmd`, exe]))?.file).toBe(exe);
    });
    it('nur claude.cmd ohne Paketordner: Shell-Notlösung', () => {
      expect(findClaude(win(['C:\\nodejs\\claude.cmd']))?.shell).toBe(true);
    });
    it('nicht installiert: null; Hilfetext nennt die Installation', () => {
      expect(findClaude(win([]))).toBeNull();
      expect(INSTALL_HELP).toContain('install.ps1');
      expect(INSTALL_HELP).toContain('claude');
    });
    it('Linux: PATH und ~/.local/bin', () => {
      const env = { PATH: '/usr/bin' };
      expect(findClaude({ platform: 'linux', env, exists: (f) => f === '/home/u/.local/bin/claude', home: '/home/u' })?.file).toBe('/home/u/.local/bin/claude');
    });
    it('Selbsttest meldet fehlendes Claude mit Anleitung', async () => {
      const old = process.env.WP_CLAUDE_BIN;
      process.env.WP_CLAUDE_BIN = '/gibt/es/nicht/claude';
      try {
        const r = await checkClaude();
        expect(r.ok).toBe(false);
        expect(r.lines.join('\n')).toContain('nicht gefunden');
      } finally {
        if (old === undefined) delete process.env.WP_CLAUDE_BIN;
        else process.env.WP_CLAUDE_BIN = old;
      }
    });
  });

  it('einstufige Suche: größte Platzhalter zuerst, Obergrenze, Rest bleibt Platzhalter', () => {
    const p = createEmptyProject();
    addRectRoom(p, { x: 0, y: 0, width: 4, depth: 4, name: 'Wohnzimmer', thickness: 0.12, height: 2.6 });
    const plan = summarizePlan(p);
    const r = parseDesignAnswer(
      { rooms: [{ room: 'R1', items: [{ catalogId: 'generic-plant', label: 'Pflanze', search: 'Pflanze' }, { catalogId: 'generic-sofa-3', label: 'Sofa', search: 'Sofa' }, { catalogId: 'generic-armchair', label: 'Sessel', search: 'Sessel' }] }] },
      plan,
      [p.rooms[0].id],
      [],
    );
    const size = (id: string) => {
      const c = PLACEHOLDERS.find((x) => x.id === id)!;
      return c.width * c.depth * c.height;
    };
    const all = searchTargets(r, size);
    expect(all.skipped).toBe(0);
    expect(all.targets.map((t) => r.rooms[0].picks[t.index].label)).toEqual(['Sofa', 'Sessel', 'Pflanze']);
    const capped = searchTargets(r, size, 2);
    expect(capped.targets.map((t) => r.rooms[0].picks[t.index].label)).toEqual(['Sofa', 'Sessel']);
    expect(capped.skipped).toBe(1);
  });
});
