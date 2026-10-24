#!/usr/bin/env node
/**
 * Unabhängige Bildprüfung des neuen Einrichtens (mgritsch04/wohnungsplaner-3d#443).
 *
 * Ein eigener Claude-Aufruf (Opus, über die lokale Claude-Code-Kommandozeile) bewertet jeden
 * Hauptraum (Wohnen, Schlafen, Küche/Essen, Kinder, Arbeiten) eines Benchmark-Laufs anhand der
 * beiden 3D-Bilder des Raums mit 1–10. Er kennt weder das Wohnkonzept noch das Raumprogramm noch
 * die Begehung; er bekommt nur Raumname, Raumtyp, Fläche und eine feste Checkliste. Das ist ein
 * zusätzliches Signal, maßgeblich bleiben die Regeln der Begehung. Läuft lokal, nie in der CI.
 *
 *     node scripts/design-image-review.mjs local-analysis/benchmark/lauf1 [A,B,…]
 *
 * Schreibt je Wohnung `bildpruefung.json` und `bildpruefung.md` in ihren Ordner.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runClaude } from './lib/claude-cli.mjs';

const MAIN = { living: 'Wohnzimmer', bedroom: 'Schlafzimmer', kitchen: 'Küche', dining: 'Esszimmer', kids: 'Kinderzimmer', office: 'Arbeitszimmer' };
const CHECKS = [
  ['wege', 'Wege frei: Man kommt von der Tür überall hin, Türen und Fenster bleiben frei, nichts versperrt den Durchgang.'],
  ['funktionen', 'Funktionen erkennbar: Man sieht sofort, wo man schläft, sitzt, isst, kocht oder arbeitet; jede Zone ist vollständig.'],
  ['blickfang', 'Blickfang: Es gibt einen klaren Mittelpunkt (Sofa mit Teppich, Bett mit Kopfteil, Esstisch mit Leuchte), auf den der Raum ausgerichtet ist.'],
  ['proportionen', 'Proportionen: Die Möbel passen in Größe und Menge zum Raum, weder leer noch vollgestellt; Abstände wirken bewusst.'],
  ['licht', 'Licht: Grundlicht und Leselicht oder Arbeitslicht sind da, wo man sie braucht; Fenster werden genutzt, nicht zugestellt.'],
  ['ordnung', 'Ordnung: Möbel stehen gerade an Wänden oder bewusst frei, Gruppen sind geschlossen, nichts steht zufällig herum.'],
  ['abgabe', '„Würde eine Innenarchitektin das so abgeben?“ – als Ganzes stimmig, wohnlich und durchdacht.'],
];

const fileOf = (room) => room.replace(/[^\wÄÖÜäöüß-]+/g, '_');

function prompt(room, type, area) {
  return `Du bist eine erfahrene Innenarchitektin und prüfst einen Einrichtungsvorschlag unabhängig, nur nach Bildern.

Raum: „${room}“, ${MAIN[type]}, ${area.toFixed(1).replace('.', ',')} m².
Bild 1 zeigt den Raum schräg von oben, so wie man ihn beim Hereinkommen sieht. Es ist in 1,20 m Höhe waagrecht aufgeschnitten: Alles darüber fehlt dort (Hängeleuchten, Deckenleuchten, Oberschränke, Vorhänge, Bilder und die oberen Teile von Kühlschrank, Hochschrank, Kleiderschrank und hohen Regalen); hohe Möbel sehen darin wie niedrige Kästen aus. Bild 2 zeigt denselben Raum ungeschnitten fast senkrecht von oben, mit allem, was hängt; dort verdecken die Wände den Rand des Raums ein wenig. Urteile über Licht, Oberschränke und hohe Möbel nach Bild 2. Andere Räume am Bildrand gehören nicht dazu. Die Möbel sind einfache Platzhalter-Modelle; beurteile Anordnung, Auswahl und Menge, nicht die Detailtreue der Modelle.

Bewerte jeden Punkt der Checkliste mit 1 (sehr schlecht) bis 10 (hervorragend) und begründe kurz:
${CHECKS.map(([id, text]) => `- ${id}: ${text}`).join('\n')}

Gib dann eine Gesamtnote 1–10 (keine Durchschnittsrechnung, dein Urteil als Innenarchitektin), die zwei größten Stärken und die drei wichtigsten Mängel in Alltagssprache (was genau, wo, warum es stört).

Antworte nur mit JSON in dieser Form:
{"punkte":{"wege":{"note":7,"warum":"…"},…},"gesamt":7,"staerken":["…"],"maengel":["…"]}`;
}

async function reviewRoom(dir, room, type, area) {
  const files = [`3d-${fileOf(room)}.png`, `3d-${fileOf(room)}-oben.png`].map((f) => join(dir, f)).filter((f) => existsSync(f));
  if (files.length < 2) return { room, type, error: 'Bilder fehlen' };
  const images = files.map((f) => ({ data: readFileSync(f).toString('base64') }));
  const started = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const text = await runClaude(prompt(room, type, area), { model: 'opus', images, maxTurns: 6 });
      const json = JSON.parse(/\{[\s\S]*\}/.exec(text)?.[0] ?? '');
      return { room, type, area, ...json, ms: Date.now() - started };
    } catch (e) {
      if (attempt === 2) return { room, type, error: String(e?.message ?? e) };
    }
  }
}

function markdown(key, results) {
  const rows = results.map((r) => (r.error ? `| ${r.room} | – | ${r.error} |` : `| ${r.room} | **${r.gesamt}** | ${CHECKS.map(([id]) => r.punkte?.[id]?.note ?? '–').join(' / ')} |`));
  const details = results
    .filter((r) => !r.error)
    .map((r) => `### ${r.room} – ${r.gesamt}/10\n\nStärken: ${r.staerken.join(' ')}\n\nMängel:\n${r.maengel.map((m) => `- ${m}`).join('\n')}\n\n${CHECKS.map(([id]) => `- ${id} ${r.punkte?.[id]?.note}: ${r.punkte?.[id]?.warum}`).join('\n')}`);
  return `# Bildprüfung ${key}\n\n_Unabhängig, nur nach den beiden 3D-Bildern je Raum (Opus), ohne Konzept und Programm._\n\n| Raum | Gesamt | ${CHECKS.map(([id]) => id).join(' / ')} |\n|---|---|---|\n${rows.join('\n')}\n\n${details.join('\n\n')}\n`;
}

const [root, only] = process.argv.slice(2);
if (!root) {
  console.error('Aufruf: node scripts/design-image-review.mjs <Ordner des Laufs> [A,B,…]');
  process.exit(1);
}
const keys = readdirSync(root).filter((k) => existsSync(join(root, k, 'raumtypen.json')) && (!only || only.split(',').includes(k)));
for (const key of keys) {
  const dir = join(root, key);
  const types = JSON.parse(readFileSync(join(dir, 'raumtypen.json'), 'utf8'));
  const run = JSON.parse(readFileSync(join(dir, 'lauf.json'), 'utf8'));
  const rooms = Object.entries(types).filter(([, t]) => t in MAIN);
  const results = await Promise.all(
    rooms.map(([room, type]) => reviewRoom(dir, room, type, run.analysis.rooms.find((a) => a.name === room)?.area ?? 0)),
  );
  writeFileSync(join(dir, 'bildpruefung.json'), JSON.stringify(results, null, 1));
  writeFileSync(join(dir, 'bildpruefung.md'), markdown(key, results));
  console.log(`${key}: ${results.map((r) => `${r.room} ${r.error ? `Fehler (${r.error})` : `${r.gesamt}/10`}`).join(', ')}`);
}
