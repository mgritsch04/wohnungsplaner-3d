#!/usr/bin/env node
/*
 * Testschritte und Warteschlange der automatischen User-Tests aus GitHub lesen (nur lesen, nie schreiben).
 *
 *   node scripts/usertest/issues.mjs          # Warteschlange: Issues mit Label auto-user-test, dazu alte [USERTEST]-Issues
 *   node scripts/usertest/issues.mjs <nr>     # Testschritte eines Issues als JSON (Vorlage für scenarios/<nr>.mjs)
 *
 * Neues Modell: Das Feature-Issue trägt die Testschritte in einem Kommentar, der mit „**Testschritte**“
 * (oder einer Überschrift „Testschritte“) beginnt; es gilt der neueste solche Kommentar. Alte [USERTEST]-Issues
 * tragen die Schritte im Issue-Text. Öffentliches Repo: Abfragen ohne Token. Hinter einem Proxy (Cloud: HTTPS_PROXY)
 * startet sich das Skript mit NODE_USE_ENV_PROXY=1 neu, damit fetch() den Proxy nimmt.
 * Kommentieren, Labels und Schließen erledigt die Session mit ihren GitHub-Werkzeugen (siehe actions()).
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO = process.env.USERTEST_REPO ?? 'mgritsch04/wohnungsplaner-3d';
export const AUTO = 'auto-user-test';
const here = dirname(fileURLToPath(import.meta.url));

async function gh(path) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'wohnungsplaner-usertest' };
  const res = await fetch(`https://api.github.com/repos/${REPO}/${path}`, { headers });
  if (!res.ok) throw new Error(`GitHub ${res.status} für ${path}`);
  return res.json();
}

/** Comment that carries the test steps: starts with **Testschritte** or a heading „Testschritte“. */
export const isStepsComment = (body) => /^\s*(\*\*Testschritte\*\*|#{1,4}\s*Testschritte\b)/i.test(body ?? '');
/** Comment written by the automatic run (so the queue can tell tested from untested). */
export const isAutoComment = (body) => /^\s*\*\*(Automatisch BESTANDEN|Automatische Vorprüfung)/.test(body ?? '');

/** Numbered steps with their expectation („→ Erwartet: …“, „*Erwartet:* …“, „→ …“ or a separate „Zu N: …“ list). */
export function parseSteps(text) {
  const steps = [];
  const zu = {};
  let cur = null;
  for (const raw of (text ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const z = line.match(/^\s*[-*]\s*Zu\s+(\d+):\s*(.+)$/i);
    if (z) {
      zu[z[1]] = z[2].trim();
      cur = null;
      continue;
    }
    const m = line.match(/^(\d+)\.\s+(.+)$/);
    if (m) {
      cur = { nr: Number(m[1]), action: m[2].trim(), expected: '' };
      steps.push(cur);
    } else if (cur && /^\s+\S/.test(line)) {
      cur.action += ` ${line.trim()}`;
    } else if (cur && !line.trim()) {
      continue;
    } else cur = null;
  }
  for (const s of steps) {
    const split = s.action.match(/^(.*?)\s*(?:→\s*)?(?:\*{0,2}Erwartet:?\*{0,2}:?\s*|→\s*)(.+)$/);
    if (split) [s.action, s.expected] = [split[1].trim(), split[2].trim()];
    if (!s.expected && zu[s.nr]) s.expected = zu[s.nr];
    s.action = s.action.replace(/\*\*/g, '');
    s.expected = s.expected.replace(/\*\*/g, '');
    s.optional = /^optional\b/i.test(s.action);
  }
  return steps;
}

/** One test: where its steps come from and what kind of issue it is. */
export async function fetchTest(nr) {
  const issue = await gh(`issues/${nr}`);
  const comments = await gh(`issues/${nr}/comments?per_page=100`);
  const labels = issue.labels.map((l) => l.name);
  const legacy = /^\[USERTEST\]/i.test(issue.title);
  const stepsComment = [...comments].reverse().find((c) => isStepsComment(c.body));
  const source = legacy ? { kind: 'body', url: issue.html_url, text: issue.body } : stepsComment ? { kind: 'comment', url: stepsComment.html_url, text: stepsComment.body } : null;
  const lastAuto = [...comments].reverse().find((c) => isAutoComment(c.body));
  return {
    nr: Number(nr),
    title: issue.title,
    state: issue.state,
    labels,
    kind: legacy ? 'usertest' : 'feature',
    source: source && { kind: source.kind, url: source.url },
    steps: parseSteps(source?.text),
    autoTestedAt: lastAuto?.created_at ?? null,
    stepsAt: stepsComment?.created_at ?? null,
    scenario: existsSync(join(here, 'scenarios', `${nr}.mjs`)),
  };
}

/** What the session does on GitHub after a run, by issue kind and verdict. */
export function actions(kind, verdict) {
  const comment = 'Kommentar mit report.md (Link zum Bildbericht per --report-url)';
  if (verdict === 'pc') return ['Nichts ins Issue schreiben: auf dem PC mit --gpu wiederholen.'];
  if (kind === 'feature')
    return verdict === 'bestanden'
      ? [comment, `Label ${AUTO} entfernen, Label done setzen`, 'Issue schließen (completed)', 'Haupt-Thread: PROJECT_STATUS „automatisch bestätigt (Datum)“']
      : [comment, `Label ${AUTO} durch user-test ersetzen`, 'Issue bleibt offen'];
  return verdict === 'bestanden'
    ? [comment, 'Label user-test durch done ersetzen', '[USERTEST]-Issue schließen (completed), danach das Feature-Issue wie bei BESTANDEN abschließen', 'Haupt-Thread: PROJECT_STATUS „automatisch bestätigt (Datum)“']
    : [comment, 'Label user-test bleibt, Issue bleibt offen'];
}

async function queue() {
  const auto = await gh(`issues?state=open&labels=${AUTO}&per_page=100`);
  const legacy = (await gh('issues?state=open&labels=user-test&per_page=100')).filter((i) => /^\[USERTEST\]/i.test(i.title));
  const rows = [];
  for (const i of [...auto, ...legacy]) {
    const t = await fetchTest(i.number);
    let plan = '–';
    let mismatch = '';
    if (t.scenario) {
      const sc = (await import(pathToFileURL(join(here, 'scenarios', `${t.nr}.mjs`)).href)).default;
      plan = sc.pc ? 'pc' : 'cloud';
      if (t.steps.length && sc.steps.length !== t.steps.length) mismatch = ` · Szenario ${sc.steps.length} Schritte, Issue ${t.steps.length}`;
    }
    const stale = t.autoTestedAt && t.stepsAt && t.stepsAt > t.autoTestedAt ? ' · Schritte nach letztem Lauf geändert' : '';
    const todo = !t.source ? 'Testschritte fehlen' : !t.scenario ? 'Szenario schreiben' : t.autoTestedAt && !stale ? 'schon automatisch geprüft' : 'bereit';
    rows.push({ ...t, plan, todo });
    console.log(`#${t.nr} ${t.kind === 'feature' ? AUTO : '[USERTEST] alt'} · ${t.title} · ${t.steps.length} Schritte · ${plan} · ${todo}${mismatch}${stale}`);
  }
  if (!rows.length) console.log(`Keine offenen Issues mit Label ${AUTO} oder [USERTEST].`);
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
    const r = spawnSync(process.execPath, ['--no-warnings', ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } });
    process.exit(r.status ?? 1);
  }
  const nr = process.argv.slice(2).find((a) => /^\d+$/.test(a));
  if (nr) console.log(JSON.stringify(await fetchTest(nr), null, 2));
  else await queue();
}
