import { mkdirSync, writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { jsonFromText } from '../src/assistant/claude';
import { analyzeFlat } from '../src/design/analysis';
import { roomConceptOf } from '../src/design/concept/flatConcept';
import { FLAT_KEYS, TEST_FLATS, type FlatKey } from '../src/design/fixtures/flats';
import { roomPlanSvg, roomTextMap } from '../src/design/render';
import { asPlaced, type FurnishRunResult } from '../src/design/run';
import { existingPieces } from '../src/design/solver/solve';
import type { PlacedItem, RoomAnalysis, RoomResult } from '../src/design/types';
import type { PlacedRoom } from '../src/design/apply';

import type { RoomType } from '../src/suggest/furnishing';
import { derivePlan } from '../src/model/derived';
import { findNarrowPassages } from '../src/model/passages';
import { applyFurnishing } from '../src/suggest/furnishing';
import { layoutSuggestion } from '../src/design/apply';
import { placedRooms } from '../src/design/apply/proposal';

/** Engstellen laut Plan-Check (#68, unter der Mindestbreite des Projekts), wenn der Vorschlag übernommen ist. */
function narrowPassages(key: FlatKey, result: FurnishRunResult): string[] {
  const project = TEST_FLATS[key].build();
  const draft = structuredClone(project);
  applyFurnishing(draft, layoutSuggestion(project, placedRooms(result)));
  const names = new Map(draft.furniture.map((f) => [f.id, f.name.replace(/ \(Platzhalter\)$/, '')]));
  return findNarrowPassages(draft, derivePlan(draft)).map((p) => `${Math.round(p.width * 100)} cm: ${p.refs.map((r) => (r.type === 'furniture' ? names.get(r.id) : r.type === 'opening' ? 'Türöffnung' : 'Wand')).join(' / ')}`);
}

/**
 * Benchmark des neuen Einrichtens (mgritsch04/wohnungsplaner-3d#443) mit dem **echten** Claude, in
 * der echten App. Läuft nur mit `WP_BENCH=1` und laufendem lokalen Helfer (`npm run ikea-helper`),
 * nie in der CI – ein Lauf über alle sechs Testwohnungen dauert Stunden und kostet Nutzung.
 *
 *     npm run ikea-helper                      # eigenes Fenster, meldet „Claude Code gefunden“
 *     WP_BENCH=1 WP_APTS=D,B npx playwright test e2e/designBenchmark.spec.ts --workers=1
 *
 * Je Wohnung entsteht unter `WP_OUT` (Voreinstellung `local-analysis/benchmark/<Zeitstempel>`):
 * `<Wohnung>/lauf.json` (Analyse, Wohnkonzept, Raumprogramme, Aufstellung, Begehung, Aufrufe),
 * `<Wohnung>/programme.json` (nur die Raumprogramme, als Fixture für die CI-Regression),
 * `<Wohnung>/bericht.md`, je Raum `<Wohnung>/raum-<Name>.svg` und `.txt` sowie Bilder von Panel,
 * Plan und 3D-Ansicht. Alle Testwohnungen sind erfunden; es landen keine echten Daten im Bericht.
 */
const KEYS = (process.env.WP_APTS ?? FLAT_KEYS.join(',')).split(',').filter((k): k is FlatKey => (FLAT_KEYS as string[]).includes(k));
const OUT = process.env.WP_OUT ?? `local-analysis/benchmark/${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}`;
/** Ordner eines früheren Laufs: Claudes Antworten von dort statt echter Aufrufe (gleiche Antworten, neuer Code). */
const REPLAY = process.env.WP_REPLAY;

/** Eine Antwort von Claude, wie der Helfer sie zurückgab, mit Stufe und Raum aus dem Prompt. */
interface Answer {
  kind: 'konzept' | 'programm' | 'kritik';
  room: string;
  label: string;
  model?: string;
  ms: number;
  prompt: string;
  text: string;
}

/** Stufe und Raum am Prompt erkennen; die Laufzeit des Artefakts bekommt kein Etikett. */
const kindOf = (prompt: string): Answer['kind'] => (prompt.includes('Wohnkonzept für die ganze Wohnung') ? 'konzept' : prompt.includes('Dein bisheriges Programm') ? 'kritik' : 'programm');
const roomOf = (prompt: string) => /Raum „([^“]+)“/.exec(prompt)?.[1] ?? '';

/** Alle Anfragen an den Helfer mitschreiben (Prompt und Antworttext), für Wiederholung und Fixtures. */
function recordAnswers(page: Page) {
  const answers: Answer[] = [];
  const pending: Promise<void>[] = [];
  const started = new Map<object, number>();
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().endsWith('/claude')) started.set(req, Date.now());
  });
  page.on('requestfinished', (req) => {
    if (req.method() !== 'POST' || !req.url().endsWith('/claude')) return;
    pending.push(
      (async () => {
        const body = req.postDataJSON() as { prompt: string; label?: string; model?: string };
        const res = await req.response();
        const reply = (await res?.json().catch(() => null)) as { text?: string } | null;
        if (!reply?.text) return;
        answers.push({ kind: kindOf(body.prompt), room: roomOf(body.prompt), label: body.label ?? '', model: body.model, ms: Date.now() - (started.get(req) ?? Date.now()), prompt: body.prompt, text: reply.text });
      })(),
    );
  });
  return async () => {
    await Promise.all(pending);
    return answers;
  };
}

/**
 * Claude als Laufzeit des Artefakts, mit den Antworten eines früheren Laufs: je Stufe und Raum in
 * der Reihenfolge, in der sie kamen (Nachbesserungen und Kritikrunden eingeschlossen). Fehlt eine
 * Antwort, bekommt die Kritik das Programm unverändert zurück, sonst gibt es einen Fehler.
 */
async function replayClaude(page: Page, answers: Answer[]) {
  const queues: Record<string, unknown[]> = {};
  for (const a of answers) {
    let value: unknown;
    try {
      value = jsonFromText(a.text);
    } catch {
      value = { __invalid: true };
    }
    (queues[`${a.kind}:${a.kind === 'konzept' ? '' : a.room}`] ??= []).push(value);
  }
  await page.addInitScript((q) => {
    const kindOf = (prompt: string) => (prompt.includes('Wohnkonzept für die ganze Wohnung') ? 'konzept' : prompt.includes('Dein bisheriges Programm') ? 'kritik' : 'programm');
    const sample = {
      limits: async () => ({ images: true }),
      json: async (prompt: string) => {
        const kind = kindOf(prompt);
        const room = kind === 'konzept' ? '' : (/Raum „([^“]+)“/.exec(prompt)?.[1] ?? '');
        await new Promise((r) => setTimeout(r, 10));
        const next = q[`${kind}:${room}`]?.shift();
        if (next === undefined) throw { code: 'upstream_error', message: `keine aufgezeichnete Antwort für ${kind} ${room}` };
        if ((next as { __invalid?: boolean }).__invalid) throw { code: 'invalid_json', message: 'Antwort ist kein JSON.' };
        return next;
      },
    };
    (window as unknown as { claude: unknown }).claude = { use: async (name: string) => (name === 'sample' ? sample : null) };
  }, queues);
}
/** Ein Raum braucht mit Opus ein paar Minuten, dazu bis zu zwei Kritikrunden. */
const PER_ROOM_MS = 12 * 60_000;

const m1 = (v: number) => v.toFixed(1).replace('.', ',');

/** Der Lauf, wie ihn der Zustandsspeicher der Oberfläche hält. */
const runResult = (page: Page) => page.evaluate(() => (window as unknown as { __wp: { useDesignStore: { getState: () => { result: unknown } } } }).__wp.useDesignStore.getState().result as unknown);

function report(key: FlatKey, result: FurnishRunResult, ms: number): string {
  const flat = TEST_FLATS[key];
  const name = (id: string) => result.analysis.rooms.find((r) => r.roomId === id)?.name ?? id;
  const rows = result.rooms.map((r) => {
    const f = r.review.findings;
    const count = (s: 'S' | 'M' | 'L') => f.filter((x) => x.severity === s).length;
    return `| ${name(r.roomId)} | ${r.review.score} | ${r.review.passed ? 'ja' : '**nein**'} | ${count('S')} | ${count('M')} | ${count('L')} | ${r.layout.items.length} | ${r.layout.dropped.length} | ${r.rounds} |`;
  });
  const findings = result.rooms.flatMap((r) => r.review.findings.map((f) => `- **${name(r.roomId)}** ${f.severity}: ${f.text} _(${f.rule})_`));
  const ways = result.rooms.map((r) => {
    const w = r.review.metrics;
    const way = w.walkEmpty ? `Weg leer ${m1(w.walkEmpty)} m, eingerichtet ${m1(w.walkFurnished)} m` : 'nur eine Tür, kein Durchgangsweg';
    return `- ${name(r.roomId)}: Belegung ${Math.round(w.occupancy * 100)} %, ${way}`;
  });
  return `# Benchmark ${key} – ${flat.title}

_Lauf vom ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, echter Claude, ${Math.round(ms / 1000)} s, ${result.calls.length} Claude-Aufrufe._

Prüft vor allem: ${flat.tests}

## Wohnkonzept

${result.concept.living}

Stil: ${result.concept.style.idea} Palette: ${result.concept.style.palette.map((c) => `${c.name} ${c.hex}`).join(', ')}.

${result.conceptProblems.length ? `Offene Punkte der Prüfung: ${result.conceptProblems.join('; ')}\n` : ''}
## Begehung

| Raum | Punkte | bestanden | S | M | L | Möbel | ausgelassen | Kritikrunden |
|---|---|---|---|---|---|---|---|---|
${rows.join('\n')}

Wohnung: **${result.review.score} Punkte**, schlechtester Raum ${result.review.minScore}, ${result.review.passed ? 'bestanden' : '**nicht bestanden**'}.
${result.failed.length ? `\nOhne verwertbare Antwort: ${result.failed.map((x) => `${x.roomId ? name(x.roomId) : 'Wohnung'} (${x.reason})`).join(', ')}\n` : ''}
## Befunde

${findings.length ? findings.join('\n') : 'Keine.'}

## Wege und Belegung

${ways.join('\n')}

## Engstellen laut Plan-Check

${(() => {
  const list = narrowPassages(key, result);
  return list.length ? `${list.length} Stellen unter der Mindestbreite:\n\n${list.map((x) => `- ${x}`).join('\n')}` : 'Keine.';
})()}

## Raumbilder

${result.rooms.map((r) => `- ${name(r.roomId)}: [Plan](raum-${fileOf(name(r.roomId))}.svg), [Textkarte](raum-${fileOf(name(r.roomId))}.txt), [3D](3d-${fileOf(name(r.roomId))}.png)`).join('\n')}
`;
}

const fileOf = (room: string) => room.replace(/[^\wÄÖÜäöüß-]+/g, '_');

type Wp = {
  useProjectStore: { getState: () => { apply: (fn: (d: { settings: { showNarrowPassages: boolean } }) => void) => void } };
  usePerformanceStore: { getState: () => { setCutaway: (v: boolean) => void } };
  useCameraRig: { getState: () => { orbit: { set: (p: object, t: object) => void } | null } };
};

/**
 * Je Raum ein Blick in 3D, wie man ihn beim Hereinkommen hat: von der Haupttür aus, schräg von
 * oben, die Wände in 1,20 m Höhe geschnitten. Das sind die Bilder für die Bildbewertung.
 */
async function roomShots(page: Page, dir: string, rooms: RoomAnalysis[]) {
  await page.evaluate(() => (window as unknown as { __wp: Wp }).__wp.usePerformanceStore.getState().setCutaway(true));
  // Fotos des Raums: ohne die roten Engstellen-Streifen des Plan-Checks (die zählt der Bericht)
  await page.evaluate(() => (window as unknown as { __wp: Wp }).__wp.useProjectStore.getState().apply((d) => (d.settings.showNarrowPassages = false)));
  await page.waitForTimeout(800);
  const canvas = page.getByTestId('scene3d');
  await canvas.screenshot({ path: `${dir}/3d-schnitt.png` });
  for (const room of rooms) {
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const radius = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
    // into the room from the main door; without one from the south
    const look = room.entryView?.dir ?? { x: 0, y: -1 };
    const dist = Math.max(3.5, (radius + 0.4) / Math.sin((25 * Math.PI) / 180));
    const up = (55 * Math.PI) / 180;
    const pos = { x: c.x - look.x * dist * Math.cos(up), y: dist * Math.sin(up), z: c.y - look.y * dist * Math.cos(up) };
    await page.evaluate(([p, t]) => (window as unknown as { __wp: Wp }).__wp.useCameraRig.getState().orbit?.set(p, t), [pos, { x: c.x, y: 0.3, z: c.y }] as const);
    await page.waitForTimeout(1500);
    await canvas.screenshot({ path: `${dir}/3d-${fileOf(room.name)}.png` });
    // zweiter Blickwinkel: fast senkrecht von oben, von der Gegenseite
    const high = (78 * Math.PI) / 180;
    const top = { x: c.x + look.x * dist * Math.cos(high), y: dist * Math.sin(high), z: c.y + look.y * dist * Math.cos(high) };
    await page.evaluate(([p, t]) => (window as unknown as { __wp: Wp }).__wp.useCameraRig.getState().orbit?.set(p, t), [top, { x: c.x, y: 0, z: c.y }] as const);
    await page.waitForTimeout(1500);
    await canvas.screenshot({ path: `${dir}/3d-${fileOf(room.name)}-oben.png` });
  }
}

/** Raumbild und Textkarte je Raum, wie Claude sie in der Kritik sieht. */
function writeRoomPictures(dir: string, key: FlatKey, result: FurnishRunResult) {
  const project = TEST_FLATS[key].build();
  const analysis = analyzeFlat(project, derivePlan(project));
  const roomNames = Object.fromEntries(analysis.rooms.map((r) => [r.roomId, r.name]));
  for (const r of result.rooms as RoomResult[]) {
    const room = analysis.rooms.find((a) => a.roomId === r.roomId);
    if (!room) continue;
    const input = { analysis: room, layout: r.layout, existing: asPlaced(existingPieces(project, room)), program: r.program, review: r.review, roomNames };
    const file = `raum-${fileOf(room.name)}`;
    writeFileSync(`${dir}/${file}.svg`, roomPlanSvg(input).svg);
    writeFileSync(`${dir}/${file}.txt`, roomTextMap(input));
  }
}

test.describe('Benchmark mit echtem Claude', () => {
  test.skip(!process.env.WP_BENCH, 'Nur lokal: WP_BENCH=1 und laufender Helfer (npm run ikea-helper).');
  // eine Wohnung nach der anderen (mit --workers=1), und eine misslungene hält die nächste nicht auf
  test.describe.configure({ mode: 'default', retries: 0 });

  for (const key of KEYS) {
    const flat = TEST_FLATS[key];
    test(`${key}: ${flat.title}`, async ({ page }) => {
      const project = flat.build();
      const rooms = project.rooms.length;
      test.setTimeout(rooms * PER_ROOM_MS + 10 * 60_000);
      const dir = `${OUT}/${key}`;
      mkdirSync(dir, { recursive: true });
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const replayFile = REPLAY ? `${REPLAY}/${key}/antworten.json` : null;
      if (replayFile) {
        test.skip(!existsSync(replayFile), `Kein früherer Lauf für ${key} in ${REPLAY}.`);
        await replayClaude(page, JSON.parse(readFileSync(replayFile, 'utf8')) as Answer[]);
      }
      const answers = recordAnswers(page);

      await page.goto('/?e2e');
      await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
      await page.evaluate((src) => {
        const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Record<string, unknown>) => void) => void } } } }).__wp;
        wp.useProjectStore.getState().apply((d) => {
          for (const k of ['nodes', 'walls', 'openings', 'rooms', 'furniture', 'zones']) d[k] = (src as Record<string, unknown>)[k] ?? [];
          d.groups = [];
        });
      }, project as unknown as Record<string, unknown>);

      await page.locator('.panel.left').getByRole('button', { name: 'Einrichten' }).click();
      const panel = page.getByTestId('design-panel');
      // ohne Helfer gibt es keinen echten Claude – dann hat der Lauf keinen Sinn
      if (!REPLAY) await expect(panel.getByTestId('design-method-hint')).toContainText('als Bild');
      await panel.getByLabel('Interessen / Hobbys').fill(flat.wishes.interests);
      await panel.getByLabel('Was du brauchst').fill(flat.wishes.needs);
      await panel.getByLabel('Was du dir wünschst').fill(flat.wishes.wants);
      await panel.getByLabel('Farben (optional)').fill(flat.wishes.colors);
      await panel.getByLabel('Stil').fill(flat.wishes.style);
      if (flat.wishes.budget) await panel.getByLabel(/Budget/).fill(String(flat.wishes.budget));

      const started = Date.now();
      await panel.getByRole('button', { name: 'Einrichten lassen' }).click();
      await expect(panel.getByTestId('design-proposal')).toBeVisible({ timeout: rooms * PER_ROOM_MS });
      const ms = Date.now() - started;

      const result = (await runResult(page)) as FurnishRunResult | null;
      expect(result, 'Der Lauf hat kein Ergebnis hinterlegt.').toBeTruthy();
      writeFileSync(`${dir}/lauf.json`, JSON.stringify(result, null, 1));
      if (!REPLAY) writeFileSync(`${dir}/antworten.json`, JSON.stringify(await answers(), null, 1));
      writeFileSync(`${dir}/programme.json`, JSON.stringify(Object.fromEntries(result!.rooms.map((r) => [result!.analysis.rooms.find((a) => a.roomId === r.roomId)?.name ?? r.roomId, r.program])), null, 1));
      writeFileSync(`${dir}/bericht.md`, report(key, result!, ms));
      writeRoomPictures(dir, key, result!);
      // Typ je Raum, wie das Wohnkonzept ihn gewählt hat – für den Vergleich mit dem alten Ablauf
      writeFileSync(
        `${dir}/raumtypen.json`,
        JSON.stringify(Object.fromEntries(result!.analysis.rooms.map((a) => [a.name, roomConceptOf(result!.concept, a).type as RoomType])), null, 1),
      );

      await panel.getByTestId('design-proposal').screenshot({ path: `${dir}/panel.png` });
      await panel.getByRole('button', { name: 'Vorschau im Plan' }).click();
      await panel.getByRole('button', { name: 'Übernehmen' }).click();
      await page.evaluate(() => (window as unknown as { __wp: { useUiStore: { getState: () => { setSelection: (s: null) => void } } } }).__wp.useUiStore.getState().setSelection(null));
      const setView = (viewMode: string) => page.evaluate((v) => (window as unknown as { __wp: { useUiStore: { setState: (s: object) => void } } }).__wp.useUiStore.setState({ viewMode: v }), viewMode);
      const size = page.viewportSize()!;
      await page.setViewportSize({ width: 2200, height: 1300 });
      await setView('2d');
      await page.getByRole('button', { name: /alles zeigen/ }).first().click();
      await page.waitForTimeout(500);
      await page.getByTestId('editor2d').screenshot({ path: `${dir}/plan.png` });
      await setView('3d');
      await page.getByRole('button', { name: /alles zeigen/ }).first().click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: `${dir}/3d.png` });
      await roomShots(page, dir, result!.analysis.rooms.filter((a) => result!.rooms.some((r) => r.roomId === a.roomId)));
      await page.setViewportSize(size);
      expect(errors).toEqual([]);
    });
  }
});

/**
 * Der Vorschlag des alten Ablaufs für A und B (src/design/review/fixtures/heute.json) in denselben
 * Bildern wie der neue: Ausgangswert für die Vorher/Nachher-Seite. Ohne Claude.
 *
 *     WP_HEUTE=1 npx playwright test e2e/designBenchmark.spec.ts --workers=1
 */
test.describe('Alter Ablauf als Vergleich', () => {
  test.skip(!process.env.WP_HEUTE, 'Nur lokal: WP_HEUTE=1.');
  const recorded = JSON.parse(readFileSync(new URL('../src/design/review/fixtures/heute.json', import.meta.url), 'utf8')) as Record<string, Record<string, { type: string; items: Omit<PlacedItem, 'id' | 'zone'>[] }>>;
  for (const key of ['A', 'B'] as const) {
    test(`heute ${key}`, async ({ page }) => {
      test.setTimeout(5 * 60_000);
      const dir = `${OUT}/heute-${key}`;
      mkdirSync(dir, { recursive: true });
      const project = TEST_FLATS[key].build();
      const analysis = analyzeFlat(project, derivePlan(project));
      const rooms = analysis.rooms.map((room) => ({
        analysis: room,
        type: recorded[key][room.name].type,
        layout: { roomId: room.roomId, items: recorded[key][room.name].items.map((i, n) => ({ ...i, id: `${room.roomId}-${n}`, zone: 'heute' })), dropped: [], cost: 0, unsolved: [], seed: 0 },
      })) as unknown as PlacedRoom[];
      const draft = structuredClone(project);
      applyFurnishing(draft, layoutSuggestion(project, rooms));
      await page.goto('/?e2e');
      await expect(page.getByText('Beispielwohnung').or(page.locator('input.project-name'))).toBeVisible();
      await page.evaluate((src) => {
        const wp = (window as unknown as { __wp: { useProjectStore: { getState: () => { apply: (fn: (d: Record<string, unknown>) => void) => void } } } }).__wp;
        wp.useProjectStore.getState().apply((d) => {
          for (const k of ['nodes', 'walls', 'openings', 'rooms', 'furniture', 'zones']) d[k] = (src as Record<string, unknown>)[k] ?? [];
          d.groups = [];
        });
      }, draft as unknown as Record<string, unknown>);
      const setView = (viewMode: string) => page.evaluate((v) => (window as unknown as { __wp: { useUiStore: { setState: (s: object) => void } } }).__wp.useUiStore.setState({ viewMode: v }), viewMode);
      await page.setViewportSize({ width: 2200, height: 1300 });
      await setView('2d');
      await page.getByRole('button', { name: /alles zeigen/ }).first().click();
      await page.waitForTimeout(500);
      await page.getByTestId('editor2d').screenshot({ path: `${dir}/plan.png` });
      await setView('3d');
      await page.waitForTimeout(1500);
      await roomShots(page, dir, analysis.rooms);
      writeFileSync(`${dir}/raumtypen.json`, JSON.stringify(Object.fromEntries(analysis.rooms.map((a) => [a.name, recorded[key][a.name].type])), null, 1));
      writeFileSync(`${dir}/lauf.json`, JSON.stringify({ analysis }, null, 1));
    });
  }
});
