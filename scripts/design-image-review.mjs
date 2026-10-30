#!/usr/bin/env node
/**
 * Unabhängige Bildprüfung des neuen Einrichtens (mgritsch04/wohnungsplaner-3d#443).
 *
 * Ein eigener Claude-Aufruf (Opus, über die lokale Claude-Code-Kommandozeile) bewertet jeden
 * Hauptraum (Wohnen, Schlafen, Küche/Essen, Kinder, Arbeiten) eines Benchmark-Laufs anhand der
 * beiden 3D-Bilder des Raums. Er kennt weder das Wohnkonzept noch das Raumprogramm noch die
 * Begehung; er bekommt Raumname, Raumtyp, Fläche, eine feste Checkliste, die Regeln seines
 * Raumtyps aus dem Regelwerk (`docs/EINRICHTUNG_REGELWERK.md`) und die Maße der Aufstellung
 * (Türen, Fenster, Möbel mit Größe, Mitte und Blickrichtung). Das ist ein zusätzliches Signal,
 * maßgeblich bleiben die Regeln der Begehung. Läuft lokal, nie in der CI.
 *
 * Note 1–10 je Raum (Eichung 30.10.: eine sorgfältige Handplanung bekam ohne Regelwerk auch nur 6,
 * die feste Note trennt gute und mittlere Pläne kaum):
 *
 *     node scripts/design-image-review.mjs local-analysis/benchmark/lauf1 [A,B,…]
 *
 * Paarvergleich (verlässlicher): welcher von zwei Läufen ist je Raum besser, in beiden
 * Reihenfolgen gefragt; nur wenn beide Antworten übereinstimmen, zählt ein Sieger.
 *
 *     node scripts/design-image-review.mjs --vergleich <Lauf X> <Lauf Y> [A,B,…]
 *
 * Schreibt je Wohnung `bildpruefung.json`/`.md` in ihren Ordner, beim Vergleich
 * `vergleich-<Y>.json`/`.md` in den Ordner von X.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runClaude } from './lib/claude-cli.mjs';

const MAIN = { living: 'Wohnzimmer', bedroom: 'Schlafzimmer', kitchen: 'Küche', dining: 'Esszimmer', kids: 'Kinderzimmer', office: 'Arbeitszimmer' };
const CHECKS = [
  ['wege', 'Wege frei: Man kommt von der Tür überall hin, Türen und Fenster bleiben frei, nichts versperrt den Durchgang.'],
  ['funktionen', 'Funktionen erkennbar: Man sieht sofort, wo man schläft, sitzt, isst, kocht oder arbeitet; jede Zone ist vollständig.'],
  ['blickfang', 'Blickfang: Es gibt einen klaren Mittelpunkt (Sofa mit Teppich, Bett mit Kopfteil, Esstisch mit Leuchte), auf den der Raum ausgerichtet ist.'],
  ['proportionen', 'Proportionen: Die Möbel passen in Größe und Menge zum Raum, weder leer noch vollgestellt; Abstände wirken bewusst. Ein freier Laufweg von der Tür zu den Zonen ist gewollt und keine leere Fläche.'],
  ['licht', 'Licht: Grundlicht und Leselicht oder Arbeitslicht sind da, wo man sie braucht; Fenster werden genutzt, nicht zugestellt.'],
  ['ordnung', 'Ordnung: Möbel stehen gerade an Wänden oder bewusst frei, Gruppen sind geschlossen, nichts steht zufällig herum.'],
  ['stil', 'Stil: Farben, Materialien und Formen passen zusammen (eine Hauptfarbe, eine Zweitfarbe, ein Akzent; wenige Holztöne, die sich wiederholen; Rundes zu Eckigem, Textur zu glatten Flächen); der Raum wirkt aus einem Guss, nicht zusammengewürfelt.'],
  ['abgabe', '„Würde eine Innenarchitektin das so abgeben?“ – als Ganzes stimmig, wohnlich und durchdacht.'],
];

const fileOf = (room) => room.replace(/[^\wÄÖÜäöüß-]+/g, '_');

/** Sections of the rulebook each room type is judged by. */
const SECTIONS = {
  living: ['Wohnen und Sitzgruppe', 'Essen', 'Küche', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stauraum', 'Stil und Gesamtbild'],
  bedroom: ['Schlafen', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stauraum', 'Stil und Gesamtbild'],
  kitchen: ['Küche', 'Essen', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stauraum', 'Stil und Gesamtbild'],
  dining: ['Essen', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stil und Gesamtbild'],
  kids: ['Kinderzimmer', 'Schlafen', 'Arbeiten', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stauraum', 'Stil und Gesamtbild'],
  office: ['Arbeiten', 'Wohnen und Sitzgruppe', 'Licht', 'Raum, Wege, Fenster, Proportion', 'Stauraum', 'Stil und Gesamtbild'],
};
const RULEBOOK = readFileSync(new URL('../docs/EINRICHTUNG_REGELWERK.md', import.meta.url), 'utf8');

/** „W2 (hart): Couchtisch 40–45 cm vor der Sofakante …“, one line per rule of the room type. */
export function rulesFor(type, book = RULEBOOK) {
  const out = [];
  for (const part of book.split(/^## /m).slice(1)) {
    const [title, ...lines] = part.split('\n');
    if (!(SECTIONS[type] ?? []).includes(title.trim())) continue;
    out.push(`${title.trim()}:`);
    for (const l of lines) {
      const cells = l.split('|').map((c) => c.trim());
      if (cells.length < 5 || !/^[A-Z]+\d+$/.test(cells[1])) continue;
      out.push(`- ${cells[1]} (${{ H: 'hart', W: 'Profi', T: 'Tipp' }[cells[2]] ?? cells[2]}): ${cells[3]}`);
    }
  }
  return out.join('\n');
}

const SIDES = ['O', 'SO', 'S', 'SW', 'W', 'NW', 'N', 'NO'];
/** Which way a piece faces: rotation r looks along (−sin r, cos r), y grows to the south. */
const facing = (r) => SIDES[(Math.round(Math.atan2(Math.cos(r), -Math.sin(r)) / (Math.PI / 4)) + 16) % 8];
const cmOf = (m) => Math.round(m * 100);

/** The plan in numbers: doors, windows and every piece with size, middle and facing, in cm from the north-west corner. */
export function roomFacts(run, roomName) {
  const a = run.analysis?.rooms?.find((x) => x.name === roomName);
  const room = a && run.rooms?.find((x) => x.roomId === a.roomId);
  if (!a || !room) return '';
  const at = (p) => `${cmOf(p.x - a.origin.x)},${cmOf(p.y - a.origin.y)}`;
  const openings = a.walls.flatMap((w) =>
    (w.openings ?? []).map((o) => {
      const p = (t) => ({ x: w.a.x + w.dir.x * t, y: w.a.y + w.dir.y * t });
      return `- ${o.kind === 'door' ? 'Tür' : 'Fenster'} ${o.id} in der ${w.side ?? w.id}-Wand von (${at(p(o.t0))}) bis (${at(p(o.t1))})`;
    }),
  );
  const labels = new Map((room.program?.items ?? []).map((i) => [i.id, (i.label ?? '').split(',')[0]]));
  const pieces = room.layout.items.map((i) => {
    const name = labels.get(i.id) || i.catalogId.replace('generic-', '');
    const up = i.elevation > 0.05 ? `, ${cmOf(i.elevation)} cm über dem Boden` : '';
    const ex = (Math.abs(Math.cos(i.rotation)) * i.width + Math.abs(Math.sin(i.rotation)) * i.depth) / 2;
    const ey = (Math.abs(Math.sin(i.rotation)) * i.width + Math.abs(Math.cos(i.rotation)) * i.depth) / 2;
    const x = i.x - a.origin.x, y = i.y - a.origin.y;
    return `- ${name}: ${cmOf(i.width)} × ${cmOf(i.depth)} cm, belegt x ${cmOf(x - ex)}–${cmOf(x + ex)}, y ${cmOf(y - ey)}–${cmOf(y + ey)}, Front nach ${facing(i.rotation)}${up}`;
  });
  return [`Raum ${cmOf(a.size.x)} × ${cmOf(a.size.y)} cm (x nach Osten, y nach Süden, ab der Nordwest-Ecke).`, ...openings, 'Möbel:', ...pieces].join('\n');
}

const PLACEHOLDER = 'Die Möbel sind einfache Platzhalter-Modelle ohne Kissen, Plaids, Bettwäsche, Deko und Stoffstruktur. Bewerte Anordnung, Auswahl, Größe, Menge und die Farben der Möbel, nicht was Platzhalter nicht zeigen können; bemängle also keine fehlenden Kissen, Plaids oder Accessoires.';
const VIEWS = `Bild 1 zeigt den Raum schräg von oben, so wie man ihn beim Hereinkommen sieht. Es ist in 1,20 m Höhe waagrecht aufgeschnitten: Alles darüber fehlt dort (Hängeleuchten, Deckenleuchten, Oberschränke, Vorhänge, Bilder und die oberen Teile von Kühlschrank, Hochschrank, Kleiderschrank und hohen Regalen); hohe Möbel sehen darin wie niedrige Kästen aus. Bild 2 zeigt denselben Raum ungeschnitten fast senkrecht von oben, mit allem, was hängt; dort verdecken die Wände den Rand des Raums ein wenig. Urteile über Licht, Oberschränke und hohe Möbel nach Bild 2. Andere Räume am Bildrand gehören nicht dazu.`;

function prompt(room, type, area, facts = '') {
  return `Du bist eine erfahrene Innenarchitektin und prüfst einen Einrichtungsvorschlag unabhängig.

Raum: „${room}“, ${MAIN[type]}, ${area.toFixed(1).replace('.', ',')} m².
${VIEWS}
${PLACEHOLDER}
${facts ? `\nDie Aufstellung in Zahlen (gleicher Raum, so kannst du Abstände nachrechnen):\n${facts}\n` : ''}
Miss den Raum an diesen Regeln (Kennung, Stufe hart/Profi/Tipp). Ein Plan, der die harten und die Profi-Regeln einhält und die Checkliste erfüllt, verdient 8 oder mehr; eine Regel kann bewusst gebrochen sein, wenn der Raum es verlangt und das Ergebnis gut ist.
${rulesFor(type)}

Bewerte jeden Punkt der Checkliste mit 1 (sehr schlecht) bis 10 (hervorragend) und begründe kurz:
${CHECKS.map(([id, text]) => `- ${id}: ${text}`).join('\n')}

Gib dann eine Gesamtnote 1–10 (keine Durchschnittsrechnung, dein Urteil als Innenarchitektin), die zwei größten Stärken, die drei wichtigsten Mängel in Alltagssprache (was genau, wo, warum es stört) und die verletzten Regeln mit Kennung.

Antworte nur mit JSON in dieser Form:
{"punkte":{"wege":{"note":7,"warum":"…"},…},"gesamt":7,"staerken":["…"],"maengel":["…"],"regeln":[{"kennung":"W5","wo":"…"}]}`;
}

/** Both pictures of a room in a run, or null. */
function imagesOf(dir, room) {
  const files = [`3d-${fileOf(room)}.png`, `3d-${fileOf(room)}-oben.png`].map((f) => join(dir, f)).filter((f) => existsSync(f));
  return files.length < 2 ? null : files.map((f) => ({ data: readFileSync(f).toString('base64') }));
}

async function askJson(text, images) {
  for (let attempt = 1; ; attempt++) {
    try {
      const reply = await runClaude(text, { model: 'opus', images, maxTurns: 8 });
      return JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0] ?? '');
    } catch (e) {
      if (attempt === 2) throw e;
    }
  }
}

async function reviewRoom(dir, room, type, area, facts) {
  const images = imagesOf(dir, room);
  if (!images) return { room, type, error: 'Bilder fehlen' };
  const started = Date.now();
  try {
    return { room, type, area, ...(await askJson(prompt(room, type, area, facts), images)), ms: Date.now() - started };
  } catch (e) {
    return { room, type, error: String(e?.message ?? e) };
  }
}

function comparePrompt(room, type, area, facts) {
  return `Du bist eine erfahrene Innenarchitektin und vergleichst zwei Einrichtungsvorschläge für denselben Raum.

Raum: „${room}“, ${MAIN[type]}, ${area.toFixed(1).replace('.', ',')} m².
Bild 1 und 2 zeigen Plan 1, Bild 3 und 4 zeigen Plan 2, jeweils zuerst den Blick beim Hereinkommen und dann den Blick von oben. ${VIEWS.replace(/^Bild 1 zeigt/, 'Der erste Blick zeigt').replace(/Bild 2 zeigt/, 'Der zweite zeigt').replace(/nach Bild 2/, 'nach dem Blick von oben')}
${PLACEHOLDER}

Plan 1 in Zahlen:
${facts[0]}

Plan 2 in Zahlen:
${facts[1]}

Regeln (Kennung, Stufe hart/Profi/Tipp):
${rulesFor(type)}

Vergleiche die beiden Pläne in jedem Punkt der Checkliste und als Ganzes: Welchen würdest du so abgeben, in welchem lebt man besser? Wenn beide praktisch gleich sind, sag „gleich“. Nenne die Unterschiede, die den Ausschlag geben, und die verletzten Regeln je Plan.
${CHECKS.map(([id, text]) => `- ${id}: ${text}`).join('\n')}

Antworte nur mit JSON in dieser Form:
{"punkte":{"wege":{"besser":"1|2|gleich","warum":"…"},…},"besser":"1|2|gleich","abstand":"knapp|deutlich","warum":"…","regeln1":[{"kennung":"W5","wo":"…"}],"regeln2":[…]}`;
}

/** Plan X against plan Y for one room, asked in both orders; a winner only if both answers agree. */
async function compareRoom(dirs, runs, room, type, area) {
  const images = dirs.map((d) => imagesOf(d, room));
  if (images.some((i) => !i)) return { room, type, error: 'Bilder fehlen' };
  const facts = runs.map((r) => roomFacts(r, room));
  try {
    const [xy, yx] = await Promise.all([
      askJson(comparePrompt(room, type, area, facts), [...images[0], ...images[1]]),
      askJson(comparePrompt(room, type, area, [facts[1], facts[0]]), [...images[1], ...images[0]]),
    ]);
    const swap = { 1: '2', 2: '1', gleich: 'gleich' };
    const a = String(xy.besser), b = swap[String(yx.besser)] ?? 'gleich';
    const verdict = a === b ? { 1: 'X', 2: 'Y', gleich: 'gleich' }[a] : 'uneinig';
    return { room, type, verdict, xy, yx: { ...yx, besser: b } };
  } catch (e) {
    return { room, type, error: String(e?.message ?? e) };
  }
}

function compareMarkdown(key, names, results) {
  const label = { X: names[0], Y: names[1], gleich: 'gleich', uneinig: 'uneinig (Reihenfolge entscheidet)' };
  const rows = results.map((r) => (r.error ? `| ${r.room} | – | ${r.error} |` : `| ${r.room} | **${label[r.verdict]}** | ${CHECKS.map(([id]) => `${r.xy.punkte?.[id]?.besser ?? '–'}/${r.yx.punkte?.[id]?.besser ?? '–'}`).join(' · ')} |`));
  const details = results
    .filter((r) => !r.error)
    .map((r) => `### ${r.room}: ${label[r.verdict]}\n\n- Reihenfolge X, Y: ${r.xy.besser} (${r.xy.abstand ?? ''}). ${r.xy.warum}\n- Reihenfolge Y, X (umgerechnet): ${r.yx.besser} (${r.yx.abstand ?? ''}). ${r.yx.warum}\n- Regeln ${names[0]}: ${(r.xy.regeln1 ?? []).map((x) => x.kennung).join(', ') || 'keine'} · ${names[1]}: ${(r.xy.regeln2 ?? []).map((x) => x.kennung).join(', ') || 'keine'}`);
  return `# Paarvergleich ${key}: ${names[0]} (X) gegen ${names[1]} (Y)\n\n_Je Raum zweimal gefragt (X zuerst, Y zuerst); ein Sieger nur, wenn beide Antworten übereinstimmen. Punkte als „X zuerst / Y zuerst“, 1 = X, 2 = Y._\n\n| Raum | Besser | ${CHECKS.map(([id]) => id).join(' · ')} |\n|---|---|---|\n${rows.join('\n')}\n\n${details.join('\n\n')}\n`;
}

function markdown(key, results) {
  const rows = results.map((r) => (r.error ? `| ${r.room} | – | ${r.error} |` : `| ${r.room} | **${r.gesamt}** | ${CHECKS.map(([id]) => r.punkte?.[id]?.note ?? '–').join(' / ')} |`));
  const details = results
    .filter((r) => !r.error)
    .map((r) => `### ${r.room} – ${r.gesamt}/10\n\nStärken: ${r.staerken.join(' ')}\n\nMängel:\n${r.maengel.map((m) => `- ${m}`).join('\n')}\n\n${CHECKS.map(([id]) => `- ${id} ${r.punkte?.[id]?.note}: ${r.punkte?.[id]?.warum}`).join('\n')}`);
  return `# Bildprüfung ${key}\n\n_Unabhängig, nur nach den beiden 3D-Bildern je Raum (Opus), ohne Konzept und Programm._\n\n| Raum | Gesamt | ${CHECKS.map(([id]) => id).join(' / ')} |\n|---|---|---|\n${rows.join('\n')}\n\n${details.join('\n\n')}\n`;
}

async function main() {
  const args = process.argv.slice(2);
  const compare = args[0] === '--vergleich';
  const [root, other, only] = compare ? args.slice(1) : [args[0], null, args[1]];
  if (!root || (compare && !other)) {
    console.error('Aufruf: node scripts/design-image-review.mjs <Ordner des Laufs> [A,B,…]\n       node scripts/design-image-review.mjs --vergleich <Lauf X> <Lauf Y> [A,B,…]');
    return process.exit(1);
  }
  const flatKeys = (dir) => readdirSync(dir).filter((k) => existsSync(join(dir, k, 'raumtypen.json')) && (!only || only.split(',').includes(k)));
  const read = (dir, file) => JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const key of flatKeys(root).filter((k) => !compare || existsSync(join(other, k, 'raumtypen.json')))) {
    const dir = join(root, key);
    const types = read(dir, 'raumtypen.json');
    const run = read(dir, 'lauf.json');
    const area = (room) => run.analysis.rooms.find((a) => a.name === room)?.area ?? 0;
    if (compare) {
      const odir = join(other, key);
      const otypes = read(odir, 'raumtypen.json');
      const rooms = Object.entries(types).filter(([room, t]) => t in MAIN && otypes[room]);
      const runs = [run, read(odir, 'lauf.json')];
      const results = await Promise.all(rooms.map(([room, type]) => compareRoom([dir, odir], runs, room, type, area(room))));
      const names = [basename(root), basename(other)];
      writeFileSync(join(dir, `vergleich-${names[1]}.json`), JSON.stringify(results, null, 1));
      writeFileSync(join(dir, `vergleich-${names[1]}.md`), compareMarkdown(key, names, results));
      console.log(`${key}: ${results.map((r) => `${r.room} ${r.error ? `Fehler (${r.error})` : r.verdict}`).join(', ')}`);
      continue;
    }
    const rooms = Object.entries(types).filter(([, t]) => t in MAIN);
    const results = await Promise.all(rooms.map(([room, type]) => reviewRoom(dir, room, type, area(room), roomFacts(run, room))));
    writeFileSync(join(dir, 'bildpruefung.json'), JSON.stringify(results, null, 1));
    writeFileSync(join(dir, 'bildpruefung.md'), markdown(key, results));
    console.log(`${key}: ${results.map((r) => `${r.room} ${r.error ? `Fehler (${r.error})` : `${r.gesamt}/10`}`).join(', ')}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
