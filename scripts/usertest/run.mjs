#!/usr/bin/env node
/*
 * Automatische Vorprüfung eines [USERTEST]-Issues (wiederverwendbar für künftige User-Tests).
 *
 *   node scripts/usertest/run.mjs <issue-nr> [--port 4180] [--out usertest-reports] [--no-build] [--report-only] [--gpu]
 *                                 [--image-base <url>] [--plan]
 *
 * Baut die App (npm run build), startet `vite preview` auf einem eigenen Port, führt das Szenario
 * scripts/usertest/scenarios/<issue-nr>.mjs Schritt für Schritt in Chromium (Playwright) aus,
 * macht nach jedem Schritt einen Screenshot und vergleicht Erwartung und Ergebnis.
 * Ergebnis: <out>/<issue-nr>/report.json, report.md (Text für den Issue-Kommentar) und
 * report.html (Bilder eingebettet, nur zum lokalen Ansehen – wird nicht veröffentlicht).
 * Der Issue-Kommentar ist reiner Text; nur bei offenen Schritten nennt er deren Screenshots
 * (mit --image-base <url> als Bildlinks <url>/<datei>, sonst als Dateinamen zum Anhängen).
 *
 * Ein Szenario exportiert `default` = { issue, title, name, device: 'desktop' | 'phone', pc: boolean, realDevice: [..],
 * steps: [{ nr, action, expected, run: async (t) => ({ status, observed }) }] }.
 * pc: true, wenn ein Schritt die 3D-Optik beurteilt (Material, Licht, Realismus) – dann zählt nur ein Lauf mit --gpu.
 * status: 'ok' (Erwartung erfüllt) · 'fail' (nicht erfüllt) · 'look' (Screenshot zeigt es, Optik
 * beurteilt nur ein Mensch) · 'device' (nur auf einem echten Gerät prüfbar) · 'skip' (optional, nicht geprüft).
 * Urteil (report.json › verdict, Konsole, Kopf von report.md):
 *   bestanden – alle Schritte 'ok' (oder optional 'skip'), keine Konsolenfehler, nichts nur am echten Gerät
 *               prüfbar, und bei pc-Szenarien lief es mit echter Grafikkarte → Issue darf als bestätigt markiert werden.
 *   pc        – kein Fehler, aber pc-Szenario ohne echte Grafikkarte gelaufen → auf dem PC mit --gpu wiederholen.
 *   pruefen   – sonst: der Nutzer soll sich die aufgelisteten Punkte selbst anschauen.
 * --plan gibt nur aus, wo der Test laufen muss (cloud | pc), ohne ihn auszuführen.
 */
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { actions } from './issues.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const issue = args.find((a) => /^\d+$/.test(a));
if (!issue) {
  console.error('Aufruf: node scripts/usertest/run.mjs <issue-nr> [--port 4180] [--out usertest-reports] [--no-build] [--report-only] [--gpu] [--image-base <url>] [--plan]');
  process.exit(2);
}
const port = Number(opt('port', process.env.PW_PORT ?? 4180));
const outDir = resolve(root, opt('out', 'usertest-reports'), issue);
mkdirSync(outDir, { recursive: true });
const scenario = (await import(pathToFileURL(join(here, 'scenarios', `${issue}.mjs`)).href)).default;
if (args.includes('--plan')) {
  console.log(scenario.pc ? 'pc' : 'cloud');
  process.exit(0);
}
const imageBase = opt('image-base')?.replace(/\/$/, '');
const LABEL = { ok: '✅ erfüllt', fail: '❌ nicht erfüllt', look: '👁 bitte am Bild beurteilen', device: '📱 nur am echten Gerät prüfbar', skip: '⏭ nicht geprüft (optional)' };

// --report-only: rebuild report.md/report.html from an existing report.json (no browser run)
if (args.includes('--report-only')) {
  const r = { ...JSON.parse(readFileSync(join(outDir, 'report.json'), 'utf8')), name: scenario.name, pc: !!scenario.pc, realDevice: scenario.realDevice ?? [] };
  r.verdict = verdict(r);
  r.kind = kindOf(scenario);
  r.actions = actions(r.kind, r.verdict.result);
  writeFileSync(join(outDir, 'report.json'), JSON.stringify(r, null, 2));
  writeFileSync(join(outDir, 'report.md'), markdown(r));
  writeFileSync(join(outDir, 'report.html'), html(r));
  process.exit(0);
}

if (!args.includes('--no-build')) execSync('npm run build', { cwd: root, stdio: 'inherit' });
const win = process.platform === 'win32';
// Windows: npx is a .cmd (needs a shell) and process groups do not exist (taskkill /T instead)
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore', detached: !win, shell: win });
const stopServer = () => {
  try {
    if (win) execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-server.pid);
  } catch {
    /* already gone */
  }
};
process.on('exit', stopServer);
const baseURL = `http://localhost:${port}`;
for (let i = 0; ; i++) {
  try {
    if ((await fetch(baseURL)).ok) break;
  } catch {
    /* not up yet */
  }
  if (i > 120) throw new Error(`Vorschau-Server auf Port ${port} startet nicht`);
  await new Promise((r) => setTimeout(r, 500));
}

const localChromium = process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
// --gpu: use the real graphics card (e.g. on a PC); default is software rendering as in the cloud
const gpu = args.includes('--gpu');
const browser = await chromium.launch({
  executablePath: existsSync(localChromium) ? localChromium : undefined,
  // headless Chromium falls back to SwiftShader unless the ANGLE backend is named (Windows: D3D11)
  args: gpu
    ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', ...(win ? ['--use-angle=d3d11'] : process.platform === 'darwin' ? ['--use-angle=metal'] : [])]
    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const devices = {
  desktop: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 664 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: IPHONE_UA },
};
const context = await browser.newContext({ baseURL, acceptDownloads: true, ...devices[scenario.device ?? 'desktop'] });
const page = await context.newPage();
const errors = [];
const IGNORED = [/THREE\.Clock/, /GPU stall/, /GL Driver Message/, /swiftshader/i, /WebGL/];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(m.text());
});

/** Helpers handed to every step. */
const t = {
  page,
  context,
  outDir,
  /** Same start as the E2E tests: empty storage, sample apartment, debug hooks via ?e2e. */
  async freshStart() {
    await page.goto('/?e2e');
    await page.evaluate(async () => {
      for (const name of ['wohnungsplaner-projects', 'wohnungsplaner-assets', 'wohnungsplaner-meta']) {
        await new Promise((r) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = req.onerror = req.onblocked = () => r(null);
        });
      }
    });
    await page.goto('/?e2e');
    await page.locator('input.project-name').waitFor();
    await page.waitForTimeout(800);
  },
  project: () => page.evaluate(() => window.__wp.useProjectStore.getState().project),
  ui: () => page.evaluate(() => window.__wp.useUiStore.getState()),
  selection: () => page.evaluate(() => window.__wp.useUiStore.getState().selection),
  furniture: async (pred) => (await t.project()).furniture.find(pred),
  /** Screen position of a plan point (metres) in the 2D editor. */
  planToScreen: (x, y) =>
    page.evaluate(
      ([px, py]) => {
        const v = window.__wp.useUiStore.getState().view2d;
        const svg = document.querySelector('[data-testid="editor2d"] svg').getBoundingClientRect();
        return { x: svg.left + (px - v.cx) * v.zoom + svg.width / 2, y: svg.top + (py - v.cy) * v.zoom + svg.height / 2 };
      },
      [x, y],
    ),
  /** Screen position of a 3D world point (Y up). */
  worldToScreen: (x, y, z) =>
    page.evaluate(
      ([wx, wy, wz]) => {
        const th = window.__wp.three;
        const v = th.camera.position.clone().set(wx, wy, wz).project(th.camera);
        const r = th.canvas.getBoundingClientRect();
        return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
      },
      [x, y, z],
    ),
  /** Point the 3D overview camera (orbit mode) from `position` at `target` (world coordinates, Y up). */
  async lookAt(position, target) {
    await page.evaluate(
      ([p, q]) => {
        const rig = window.__wp.useCameraRig;
        rig.setState({ suppressFitUntil: performance.now() + 1e9 });
        rig.getState().orbit?.set(p, q);
      },
      [position, target],
    );
    await page.mouse.move(2, 2); // no hover tooltip in the picture
  },
  /** Wait until `fn()` returns something truthy (or the timeout passes); returns the last value. */
  async poll(fn, timeout = 8000) {
    const end = Date.now() + timeout;
    let v;
    while (Date.now() < end) {
      v = await fn().catch(() => undefined);
      if (v) return v;
      await page.waitForTimeout(200);
    }
    return v;
  },
  /** Real touch input through the DevTools protocol (fingers as arrays of points). */
  async touch(from, to, steps = 8) {
    const cdp = (t._cdp ??= await context.newCDPSession(page));
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    await send('touchStart', from);
    for (let i = 1; i <= steps; i++) await send('touchMove', from.map((p, k) => ({ x: p.x + (to[k].x - p.x) * (i / steps), y: p.y + (to[k].y - p.y) * (i / steps) })));
    await send('touchEnd', []);
  },
  extraShots: [],
  /** Additional screenshot inside a step (e.g. before/after); the step's final shot is automatic. */
  async shot(caption, clip) {
    const file = `step-${t._step}-${t.extraShots.length + 1}.jpg`;
    await page.screenshot({ path: join(outDir, file), type: 'jpeg', quality: 72, clip });
    t.extraShots.push({ file, caption });
  },
};

/** WebGL renderer actually used (proves real GPU vs. software rendering). */
const renderer = await page
  .evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'kein WebGL';
  })
  .catch(() => 'unbekannt');
const software = /swiftshader|llvmpipe|software/i.test(renderer);
if (gpu && software) console.warn(`Achtung: --gpu gesetzt, aber der Browser rechnet mit Software-Grafik (${renderer}).`);

const results = [];
for (const step of scenario.steps) {
  t._step = step.nr;
  t.extraShots = [];
  const errBefore = errors.length;
  let res;
  const started = Date.now();
  try {
    res = await step.run(t);
  } catch (e) {
    res = { status: 'fail', observed: `Abbruch: ${String(e.message ?? e).split('\n')[0]}` };
  }
  if (errors.length > errBefore && res.status === 'ok') {
    res = { status: 'fail', observed: `${res.observed} – aber Fehler in der Konsole: ${errors.slice(errBefore).join(' | ')}` };
  }
  const shots = [...t.extraShots];
  if (!res.noFinalShot) {
    if (!(scenario.device === 'phone')) await page.mouse.move(1, 1).catch(() => undefined); // no hover tooltip in the picture
    const file = `step-${step.nr}.jpg`;
    await page.screenshot({ path: join(outDir, file), type: 'jpeg', quality: 72, clip: res.clip }).catch(() => undefined);
    shots.push({ file, caption: res.caption ?? 'Nach dem Schritt' });
  }
  results.push({ nr: step.nr, action: step.action, expected: step.expected, status: res.status, observed: res.observed, shots, ms: Date.now() - started });
  console.log(`Schritt ${step.nr}: ${res.status} – ${res.observed}`);
}
await browser.close();
stopServer();

const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim();
const report = {
  issue: Number(issue),
  title: scenario.title,
  name: scenario.name,
  device: scenario.device ?? 'desktop',
  viewport: devices[scenario.device ?? 'desktop'].viewport,
  commit,
  branch,
  date: new Date().toISOString(),
  gpu: gpu && !software,
  renderer,
  pc: !!scenario.pc,
  realDevice: scenario.realDevice ?? [],
  results,
  consoleErrors: errors,
};
report.verdict = verdict(report);
report.kind = kindOf(scenario);
report.actions = actions(report.kind, report.verdict.result);
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(outDir, 'report.md'), markdown(report));
writeFileSync(join(outDir, 'report.html'), html(report));
console.log(`Bericht: ${join(outDir, 'report.html')}`);
console.log(`Urteil: ${report.verdict.result}${report.verdict.reasons.length ? `\n- ${report.verdict.reasons.join('\n- ')}` : ''}`);
console.log(`Danach auf GitHub (#${issue}, ${report.kind === 'feature' ? 'Feature-Issue' : 'altes [USERTEST]-Issue'}):\n- ${report.actions.join('\n- ')}`);
process.exit(0);

/** Old model: a separate [USERTEST] issue; new model: the feature issue itself (label auto-user-test). */
function kindOf(sc) {
  return /^\[USERTEST\]/i.test(sc.title ?? '') ? 'usertest' : 'feature';
}

/** Automatic verdict: only an unambiguous pass may be marked as confirmed. */
function verdict(r) {
  const fails = r.results.filter((s) => s.status === 'fail');
  if (!fails.length && r.pc && !r.gpu)
    return { result: 'pc', reasons: ['Der Test beurteilt die 3D-Optik und lief ohne echte Grafikkarte: auf dem PC mit --gpu wiederholen.'] };
  const reasons = [
    ...fails.map((s) => `Schritt ${s.nr} nicht erfüllt: ${s.observed}`),
    ...r.results.filter((s) => s.status === 'look').map((s) => `Schritt ${s.nr} bitte am Bild beurteilen: ${s.expected}`),
    ...r.results.filter((s) => s.status === 'device').map((s) => `Schritt ${s.nr} nur am echten Gerät prüfbar: ${s.expected}`),
    ...r.realDevice.map((d) => `Am echten Gerät: ${d}`),
    ...(r.consoleErrors.length ? [`${r.consoleErrors.length} Fehler in der Browser-Konsole (siehe unten).`] : []),
  ];
  return { result: reasons.length ? 'pruefen' : 'bestanden', reasons };
}

function counts(r) {
  const c = { ok: 0, fail: 0, look: 0, device: 0, skip: 0 };
  for (const s of r.results) c[s.status]++;
  return c;
}


function markdown(r) {
  const c = counts(r);
  const v = r.verdict ?? verdict(r);
  const head = {
    bestanden: ['**Automatisch BESTANDEN** – jeder Schritt wurde im Browser nachweislich erfüllt (Zustand im Projekt bzw. auf der Seite geprüft).'],
    pruefen: ['**Automatische Vorprüfung – bitte selbst anschauen:**', ...v.reasons.map((x) => `- ${x}`)],
    pc: ['**Automatische Vorprüfung (Cloud) – noch nicht aussagekräftig:**', ...v.reasons.map((x) => `- ${x}`)],
  }[v.result];
  const lines = [
    ...head,
    '',
    `Stand: \`${r.commit}\` (${r.branch}) · Browser: Chromium ${r.gpu ? 'lokal' : 'in der Cloud'}, ${r.device === 'phone' ? `iPhone-Emulation ${r.viewport.width}×${r.viewport.height}` : `Desktop ${r.viewport.width}×${r.viewport.height}`}, ${r.gpu ? 'echte Grafikkarte' : 'Software-Grafik'}${r.renderer ? ` (${r.renderer})` : ''} · ${r.date.slice(0, 16).replace('T', ' ')} UTC`,
    '',
    `Ergebnis: ${c.ok} erfüllt · ${c.fail} nicht erfüllt · ${c.look} nur am Bild beurteilbar · ${c.device} nur am echten Gerät prüfbar${c.skip ? ` · ${c.skip} optional übersprungen` : ''}`,
    '',
    '| Schritt | Ergebnis | Beobachtet |',
    '|---|---|---|',
    ...r.results.map((s) => `| ${s.nr} | ${LABEL[s.status]} | ${s.observed.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`),
  ];
  // pictures only where something is open (not fulfilled, judge from the picture, real device)
  const open = v.result === 'bestanden' ? [] : r.results.filter((s) => ['fail', 'look', 'device'].includes(s.status) && s.shots.length);
  if (open.length) {
    lines.push('', imageBase ? '**Bilder zu den offenen Schritten:**' : '**Screenshots zu den offenen Schritten (zum Anhängen):**');
    for (const s of open)
      for (const sh of s.shots) lines.push(imageBase ? `- Schritt ${s.nr}, ${sh.caption}:\n\n  ![Schritt ${s.nr}: ${sh.caption}](${imageBase}/${sh.file})` : `- Schritt ${s.nr}, ${sh.caption}: \`${sh.file}\``);
  }
  if (r.consoleErrors.length) lines.push('', `**Fehler in der Browser-Konsole:** ${r.consoleErrors.slice(0, 5).map((e) => `\`${e.slice(0, 160)}\``).join(', ')}`);
  return lines.join('\n') + '\n';
}

function html(r) {
  const c = counts(r);
  const v = r.verdict ?? verdict(r);
  const VERDICT = { bestanden: 'Automatisch bestanden', pruefen: 'Bitte selbst anschauen', pc: 'Noch auf dem PC mit Grafikkarte wiederholen' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
  const img = (f) => `data:image/jpeg;base64,${readFileSync(join(outDir, f)).toString('base64')}`;
  const steps = r.results
    .map(
      (s) => `<section class="step ${s.status}" id="s${s.nr}">
  <header><span class="nr">${s.nr}</span><span class="badge ${s.status}">${esc(LABEL[s.status])}</span></header>
  <dl><dt>Schritt</dt><dd>${esc(s.action)}</dd><dt>Erwartet</dt><dd>${esc(s.expected)}</dd><dt>Beobachtet</dt><dd>${esc(s.observed)}</dd></dl>
  <div class="shots">${s.shots.map((sh) => `<figure><img loading="lazy" src="${img(sh.file)}" alt="${esc(sh.caption)}"><figcaption>${esc(sh.caption)}</figcaption></figure>`).join('')}</div>
</section>`,
    )
    .join('\n');
  // page body only: the artifact host wraps it in its own document skeleton (doctype, head, body)
  return `<title>Vorprüfung #${r.issue} ${esc(r.name ?? '')}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Prüfprotokoll: Zusammenfassung oben, dann ein Block pro Schritt mit Statusstreifen und Bildern */
:root{color-scheme:light;--bg:#f6f6f4;--card:#fff;--text:#1d1d1b;--muted:#6b6b66;--line:#e2e1dc;--ok:#1f7a3f;--fail:#b3261e;--look:#8a5a00;--device:#3b5bab;--skip:#8a8a84}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#171716;--card:#222220;--text:#ecebe6;--muted:#a3a29b;--line:#383733;--ok:#5cc47f;--fail:#f08079;--look:#e0b25a;--device:#8fa9ec;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#171716;--card:#222220;--text:#ecebe6;--muted:#a3a29b;--line:#383733;--ok:#5cc47f;--fail:#f08079;--look:#e0b25a;--device:#8fa9ec;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding-block:24px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}h1{font-size:22px;margin:0 0 4px}.meta{color:var(--muted);font-size:13px;margin:0 0 16px}
.note{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin:0 0 16px}
.verdict{border-left:4px solid var(--look)}.verdict.bestanden{border-left-color:var(--ok)}
.sum{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 20px}.sum span{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:13px}
.step{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--line);border-radius:10px;padding:14px;margin:0 0 14px}
.step.ok{border-left-color:var(--ok)}.step.fail{border-left-color:var(--fail)}.step.look{border-left-color:var(--look)}.step.device{border-left-color:var(--device)}.step.skip{border-left-color:var(--skip)}.badge.skip{color:var(--muted)}
.step header{display:flex;align-items:center;gap:10px;margin-bottom:8px}.nr{font-weight:700;font-size:18px}
.badge{font-size:13px;font-weight:600}.badge.ok{color:var(--ok)}.badge.fail{color:var(--fail)}.badge.look{color:var(--look)}.badge.device{color:var(--device)}
dl{display:grid;grid-template-columns:90px 1fr;gap:4px 12px;margin:0 0 10px}dt{color:var(--muted);font-size:13px}dd{margin:0}
.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}figure{margin:0}img{width:100%;border:1px solid var(--line);border-radius:6px;display:block}
figcaption{color:var(--muted);font-size:12px;margin-top:4px}ul{margin:6px 0 0;padding-left:20px}
@media (max-width:560px){dl{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Automatische Vorprüfung · #${r.issue} ${esc(r.name ?? '')}</h1>
<p class="meta">${esc(r.title)}<br>Stand ${esc(r.commit)} (${esc(r.branch)}) · Chromium ${r.gpu ? 'lokal' : 'in der Cloud'}, ${r.device === 'phone' ? `iPhone-Emulation ${r.viewport.width}×${r.viewport.height}` : `Desktop ${r.viewport.width}×${r.viewport.height}`}, ${r.gpu ? 'echte Grafikkarte' : 'Software-Grafik'}${r.renderer ? ` (${esc(r.renderer)})` : ''} · ${esc(r.date.slice(0, 16).replace('T', ' '))} UTC</p>
<div class="note verdict ${v.result}"><strong>${esc(VERDICT[v.result])}.</strong> Die Vorprüfung klickt die Schritte aus dem Issue automatisch durch und vergleicht Erwartung und Ergebnis. Als bestätigt gilt der Test nur, wenn jeder Schritt nachweislich erfüllt ist.${v.reasons.length ? `<ul>${v.reasons.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}</div>
<div class="sum"><span>${c.ok} erfüllt</span><span>${c.fail} nicht erfüllt</span><span>${c.look} am Bild beurteilen</span><span>${c.device} nur am Gerät</span>${r.consoleErrors.length ? `<span>${r.consoleErrors.length} Konsolenfehler</span>` : ''}</div>
${steps}
</main>
`;
}
