/**
 * Claude über die lokal installierte Claude-Code-Kommandozeile (`claude -p`), für den
 * IKEA-Helfer (#350): So kann der lokal per `npm run dev` geöffnete Planer Claude fragen,
 * ohne dass ein Schlüssel in den Browser kommt – die Anfrage läuft über die Anmeldung von
 * Claude Code auf diesem Rechner (dein Claude-Kontingent).
 *
 * Werkzeuge: ohne `web` keine; mit `web` nur Websuche und Abruf von Seiten auf
 * www.ikea.com und www.moebelix.at (wie ein Mensch, der dort sucht; keine Konten, keine
 * internen Schnittstellen). Alles andere (Shell, Dateien schreiben …) ist gesperrt; Claude
 * läuft in einem leeren Arbeitsordner.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';

const { join } = path;

export const SHOP_FETCH = ['WebFetch(domain:www.ikea.com)', 'WebFetch(domain:www.moebelix.at)', 'WebFetch(domain:moebelix.at)'];
const BLOCKED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'Agent'];

/** Argumente für `claude`; die Anfrage selbst kommt über stdin (Längengrenze der Kommandozeile). */
/** Models the planner may ask for by name (#350, „gründlich“); anything else uses the Claude Code default. */
export const MODELS = ['opus', 'sonnet'];

export function claudeArgs({ web = false, maxTurns, model } = {}) {
  const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns ?? (web ? 40 : 2))];
  args.push('--disallowedTools', BLOCKED.join(','));
  if (web) args.push('--allowedTools', ['WebSearch', ...SHOP_FETCH].join(','));
  // WP_CLAUDE_MODEL fixes the model for every request; otherwise the planner's choice, else the Claude Code default
  const chosen = process.env.WP_CLAUDE_MODEL || (MODELS.includes(model) ? model : '');
  if (chosen) args.push('--model', chosen);
  return args;
}

/** Text der Antwort aus der JSON-Ausgabe von `claude -p --output-format json`. */
export function resultText(stdout) {
  let out;
  try {
    out = JSON.parse(stdout);
  } catch {
    throw new Error('Claude Code hat keine lesbare Antwort geliefert.');
  }
  // ältere Versionen liefern eine Liste von Nachrichten, deren letzte das Ergebnis ist
  const r = Array.isArray(out) ? out.findLast((m) => m?.type === 'result') : out;
  if (!r || typeof r.result !== 'string') throw new Error('Claude Code hat keine Antwort geliefert.');
  if (r.is_error) throw new Error(`Claude Code: ${r.result || r.subtype || 'Fehler'}`);
  return r.result;
}

/** Hinweis, wenn Claude Code fehlt (Terminal und Planer zeigen denselben Text). */
export const INSTALL_HELP =
  'Claude Code ist nicht installiert oder nicht auffindbar. Installation unter Windows: ' +
  '1) PowerShell öffnen und eingeben: irm https://claude.ai/install.ps1 | iex ' +
  '(oder, falls Node.js da ist: npm install -g @anthropic-ai/claude-code). ' +
  '2) Ein NEUES Terminal öffnen, „claude“ eingeben und einmal anmelden. ' +
  '3) „npm run ikea-helper“ neu starten (Prüfung: npm run ikea-helper -- --check).';

/**
 * Sucht Claude Code: `WP_CLAUDE_BIN`, dann PATH (mit PATHEXT unter Windows), dann die üblichen
 * Installationsorte. Liefert `{ file, prefix, shell }` oder null. `.cmd`-Starter von npm werden,
 * wenn möglich, auf die eigentliche Datei (`claude.exe` bzw. `cli.js`) aufgelöst, damit kein
 * Umweg über die Shell nötig ist; sonst `shell: true` (Befehl als eine sicher zitierte Zeichenkette).
 * Alle Systemzugriffe sind einstellbar (für Tests).
 */
export function findClaude({ platform = process.platform, env = process.env, exists = existsSync, home = homedir(), nodePath = process.execPath } = {}) {
  const win = platform === 'win32';
  const p = win ? path.win32 : path.posix;
  const list = (v) => (v ? v.split(win ? ';' : ':').map((d) => d.replace(/^"|"$/g, '')).filter(Boolean) : []);
  const user = win ? env.USERPROFILE || home : home;
  const dirs = [
    ...list(env.PATH ?? env.Path),
    p.join(user, '.local', 'bin'),
    p.join(user, '.claude', 'local'),
    ...(win ? [env.APPDATA && p.join(env.APPDATA, 'npm'), env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Programs', 'claude'), env.LOCALAPPDATA && p.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links')] : ['/usr/local/bin', p.join(user, '.npm-global', 'bin')]),
  ].filter(Boolean);
  const exts = win ? ['.exe', '.cmd', '.bat'] : [''];
  const resolveFile = (file) => {
    if (!win || !/\.(cmd|bat)$/i.test(file)) return { file, prefix: [], shell: false };
    const pkg = p.join(p.dirname(file), 'node_modules', '@anthropic-ai', 'claude-code');
    const exe = p.join(pkg, 'bin', 'claude.exe');
    if (exists(exe)) return { file: exe, prefix: [], shell: false };
    const cli = p.join(pkg, 'cli.js');
    if (exists(cli)) return { file: nodePath, prefix: [cli], shell: false };
    return { file, prefix: [], shell: true };
  };
  const override = env.WP_CLAUDE_BIN;
  if (override) {
    if (!p.isAbsolute(override)) return { file: override, prefix: [], shell: false };
    return exists(override) ? resolveFile(override) : null;
  }
  for (const dir of [...new Set(dirs)]) {
    for (const ext of exts) {
      const file = p.join(dir, `claude${ext}`);
      if (exists(file)) return resolveFile(file);
    }
  }
  return null;
}

/** Eine Zeichenkette für `cmd.exe` in Anführungszeichen setzen (nur für unsere eigenen festen Argumente). */
function cmdQuote(a) {
  if (/["%\r\n]/.test(a)) throw new Error('Unzulässiges Zeichen in Argument.');
  return `"${a}"`;
}

/** Startet Claude Code ohne `shell: true` mit Argumentliste (außer beim `.cmd`-Notfall, dort eine zitierte Zeile). */
function launch(found, args, opts) {
  if (found.shell) return spawn(`${cmdQuote(found.file)} ${args.map(cmdQuote).join(' ')}`, { ...opts, shell: true });
  return spawn(found.file, [...found.prefix, ...args], opts);
}

/** Wie `findClaude`, aber ein ausdrücklich übergebenes `bin` (Tests) wird unverändert gestartet. */
function locate(bin) {
  if (bin) return { file: bin, prefix: [], shell: false };
  return findClaude();
}

/**
 * Führt eine Anfrage aus. `bin` (Standard: `claude` bzw. Umgebungsvariable `WP_CLAUDE_BIN`).
 * Löst mit dem Antworttext auf; wirft bei Fehler oder Zeitüberschreitung.
 */
export function runClaude(prompt, { web = false, maxTurns, model, timeoutMs = web ? 8 * 60_000 : model === 'opus' ? 8 * 60_000 : 4 * 60_000, bin, signal } = {}) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'wp-claude-'));
    const found = locate(bin);
    if (!found) {
      rmSync(cwd, { recursive: true, force: true });
      reject(new Error(`Claude Code nicht gefunden. ${INSTALL_HELP}`));
      return;
    }
    const child = launch(found, claudeArgs({ web, maxTurns, model }), { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const done = (err, text) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      rmSync(cwd, { recursive: true, force: true });
      if (err) reject(err);
      else resolve(text);
    };
    const timer = setTimeout(() => {
      child.kill();
      done(new Error('Claude Code hat zu lange gebraucht.'));
    }, timeoutMs);
    const abort = () => {
      child.kill();
      done(new Error('abgebrochen'));
    };
    signal?.addEventListener('abort', abort);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('error', (e) => done(new Error(`Claude Code nicht gefunden (${e.message}). ${INSTALL_HELP}`)));
    child.on('close', (code) => {
      try {
        done(null, resultText(stdout));
      } catch (e) {
        done(code ? new Error(`${e.message} ${stderr.trim().slice(0, 300)}`.trim()) : e);
      }
    });
    child.stdin.end(prompt);
  });
}

/** True, wenn `claude --version` auf diesem Rechner läuft. */
export function claudeAvailable(bin) {
  return new Promise((resolve) => {
    try {
      const found = locate(bin);
      if (!found) return resolve(false);
      const child = launch(found, ['--version'], { stdio: 'ignore', windowsHide: true });
      const t = setTimeout(() => {
        child.kill();
        resolve(false);
      }, 10_000);
      child.on('error', () => (clearTimeout(t), resolve(false)));
      child.on('close', (code) => (clearTimeout(t), resolve(code === 0)));
    } catch {
      resolve(false);
    }
  });
}

/**
 * Selbsttest für `npm run ikea-helper -- --check`: gefunden? Version? Angemeldet (eine winzige
 * Testanfrage)? Liefert `{ ok, lines }`.
 */
export async function checkClaude(bin) {
  const found = locate(bin);
  if (!found) return { ok: false, lines: ['✗ Claude Code („claude“) nicht gefunden.', INSTALL_HELP] };
  const lines = [`✓ Claude Code gefunden: ${found.shell || !found.prefix.length ? found.file : found.prefix[0]}`];
  if (!(await claudeAvailable(bin))) return { ok: false, lines: [...lines, '✗ „claude --version“ lässt sich nicht ausführen – Installation beschädigt? Neu installieren:', INSTALL_HELP] };
  try {
    await runClaude('Antworte nur mit dem Wort OK.', { maxTurns: 1, timeoutMs: 90_000, bin });
    return { ok: true, lines: [...lines, '✓ Angemeldet, Anfrage funktioniert.'] };
  } catch (e) {
    return { ok: false, lines: [...lines, `✗ Testanfrage fehlgeschlagen: ${e instanceof Error ? e.message : e}`, 'Wahrscheinlich nicht angemeldet: im Terminal „claude“ eingeben und einmal anmelden, dann erneut prüfen.'] };
  }
}
