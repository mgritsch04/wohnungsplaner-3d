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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SHOP_FETCH = ['WebFetch(domain:www.ikea.com)', 'WebFetch(domain:www.moebelix.at)'];
const BLOCKED = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'Agent'];

/** Argumente für `claude`; die Anfrage selbst kommt über stdin (Längengrenze der Kommandozeile). */
export function claudeArgs({ web = false, maxTurns } = {}) {
  const args = ['-p', '--output-format', 'json', '--max-turns', String(maxTurns ?? (web ? 30 : 2))];
  args.push('--disallowedTools', BLOCKED.join(','));
  if (web) args.push('--allowedTools', ['WebSearch', ...SHOP_FETCH].join(','));
  if (process.env.WP_CLAUDE_MODEL) args.push('--model', process.env.WP_CLAUDE_MODEL);
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

/**
 * Führt eine Anfrage aus. `bin` (Standard: `claude` bzw. Umgebungsvariable `WP_CLAUDE_BIN`).
 * Löst mit dem Antworttext auf; wirft bei Fehler oder Zeitüberschreitung.
 */
export function runClaude(prompt, { web = false, maxTurns, timeoutMs = web ? 8 * 60_000 : 4 * 60_000, bin = process.env.WP_CLAUDE_BIN || 'claude', signal } = {}) {
  return new Promise((resolve, reject) => {
    const cwd = mkdtempSync(join(tmpdir(), 'wp-claude-'));
    const child = spawn(bin, claudeArgs({ web, maxTurns }), { cwd, shell: process.platform === 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
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
    child.on('error', (e) => done(new Error(`Claude Code nicht gefunden (${e.message}). Ist „claude“ installiert und angemeldet?`)));
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
export function claudeAvailable(bin = process.env.WP_CLAUDE_BIN || 'claude') {
  return new Promise((resolve) => {
    try {
      const child = spawn(bin, ['--version'], { shell: process.platform === 'win32', stdio: 'ignore', windowsHide: true });
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
