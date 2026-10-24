#!/usr/bin/env node
/**
 * Macht aus den mitgeschnittenen Antworten eines Benchmark-Laufs (mgritsch04/wohnungsplaner-3d#443)
 * eine Testdatei für die CI: je Anfrage Stufe, Raum und die Antwort als JSON, in der Reihenfolge,
 * in der Claude geantwortet hat (Raumprogramme, Nachbesserungen, Blick vor der Abgabe). Ohne
 * Prompts, damit die Datei klein bleibt; der Regressionstest `src/design/benchmark.test.ts` spielt
 * sie ohne echten Claude ab.
 *
 *     node scripts/design-bench-fixture.mjs local-analysis/benchmark/lauf2 A,B,C,D,E,F
 *
 * Schreibt `src/design/fixtures/benchmark/<Wohnung>.json`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Wie `jsonFromText` in src/assistant/claude.ts: Codeblock, ganzer Text oder der äußere {...}-Block. */
function jsonFromText(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  for (const candidate of [fenced, text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // nächster Versuch
    }
  }
  return null;
}

const [root, only] = process.argv.slice(2);
if (!root || !only) {
  console.error('Aufruf: node scripts/design-bench-fixture.mjs <Ordner des Laufs> A,B,…');
  process.exit(1);
}
const out = join('src', 'design', 'fixtures', 'benchmark');
mkdirSync(out, { recursive: true });
for (const key of only.split(',')) {
  const file = join(root, key, 'antworten.json');
  if (!existsSync(file)) {
    console.log(`${key}: keine Antworten`);
    continue;
  }
  const answers = JSON.parse(readFileSync(file, 'utf8'));
  const run = JSON.parse(readFileSync(join(root, key, 'lauf.json'), 'utf8'));
  const day = /_Lauf vom (\S+)/.exec(readFileSync(join(root, key, 'bericht.md'), 'utf8'))?.[1] ?? '';
  const fixture = {
    source: `Benchmark-Lauf ${day} mit echtem Claude (#443), Testwohnung ${key}; Antworten unverändert, nur als JSON gelesen.`,
    score: run.review.score,
    answers: answers.map((a) => ({ kind: a.kind, room: a.room, label: a.label, value: jsonFromText(a.text) })),
  };
  writeFileSync(join(out, `${key}.json`), `${JSON.stringify(fixture)}\n`);
  console.log(`${key}: ${fixture.answers.length} Antworten, Lauf ${run.review.score} Punkte`);
}
