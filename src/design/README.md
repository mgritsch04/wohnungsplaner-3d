# Einrichtung neu (`src/design/`)

Neuer Ablauf für den Claude-Einrichtungsvorschlag (mgritsch04/wohnungsplaner-3d#436): erst ein Konzept wie von einer Innenarchitektin, dann genau aufstellen und mit Plausibilitätsregeln prüfen. Entwurf mit Mängelliste, Regeln und Abnahme: [`docs/EINRICHTUNG_NEU.md`](../../docs/EINRICHTUNG_NEU.md). Der bisherige Ablauf (`src/assistant/design*.ts`, `src/suggest/furnishing.ts`) bleibt unverändert, bis der neue die Abnahme besteht.

## Stufen und Ordner

| Stufe | Ordner | Ergebnis (`types.ts`) | Issue |
|---|---|---|---|
| 0 Raum lesen | `analysis/` | `RoomAnalysis`, `FlatAnalysis`, Raumskizze als Text für Claude | mgritsch04/wohnungsplaner-3d#438 |
| 1 Wohnkonzept (Claude, ein Aufruf) | `concept/` | `FlatConcept` | mgritsch04/wohnungsplaner-3d#439 |
| 2 Raumprogramm (Claude, je Raum) | `concept/` | `RoomProgram` | mgritsch04/wohnungsplaner-3d#439 |
| 3 Aufstellen | `solver/` | `Layout` | mgritsch04/wohnungsplaner-3d#440 |
| 4 Begehung | `review/` | `RoomReview`, `Review` | mgritsch04/wohnungsplaner-3d#441 |
| 5 Kritik: Raumbild und Textkarte | `render/` | Bild (SVG, PNG) und Text des eingerichteten Raums | mgritsch04/wohnungsplaner-3d#442 |
| 5 Kritik (Claude, je Raum mit Befund) | `critique.ts` | nachgebessertes `RoomProgram` | mgritsch04/wohnungsplaner-3d#442 |
| Ablauf über alle Stufen | `run.ts` | `FurnishRunResult` | mgritsch04/wohnungsplaner-3d#442 |
| 6 Produkte, Übernahme, Oberfläche | `apply/`, `src/assistant/` | `DesignProposal`, Möbel im Projekt | mgritsch04/wohnungsplaner-3d#442 |
| Benchmark, Vorher/Nachher | `scripts/`, `e2e/` | Bericht | mgritsch04/wohnungsplaner-3d#443 |

Gemeinsam: `types.ts` (Schnittstellen aller Stufen), `coords.ts` (Raumkoordinaten und Himmelsrichtungen für Claude), `score.ts` (Punkte der Begehung), `fixtures/` (Testwohnungen und aufgezeichnete Claude-Antworten).

## Stufe 0 benutzen (`analysis/`)

- `analyzeFlat(project)` liefert je Raum:
  - Wände W1 … im Uhrzeigersinn, über T-Stöße zusammengefasst, mit Dicke, Höhe und dem, was dahinter liegt
  - Öffnungen mit Ziel-Raum, Aufschlag und Schwenkfläche
  - Ecken, Wege zwischen den Türen, Durchgangszimmer, Haupttür und Blick beim Eintreten
  - Bestand, Anschlüsse (Heizkörper, Wasser …) und markierte Bereiche
- `roomSketch(ctx, room)` und `flatSketch(ctx)` schreiben das als Text für Claude. Beispiele: `analysis/__snapshots__/sketch-*.txt`.
- `checkWalkways(room, hindernisse)` misst die Wege im eingerichteten Raum nach (B1–B3): Passt noch ein Weg der verlangten Breite, wie breit höchstens, wie lang?
  - Hindernisse sind die Grundflächen aller Teile, durch die man nicht gehen kann, der Bestand eingeschlossen.
  - Teppiche, Vorhänge und Hängendes zählen nicht.
- Ein Raum mit mehr als vier Türen (Gang, Vorraum) bekommt Wege von der Haupttür zu jeder anderen Tür. Bleiben die frei, erreicht jede Tür jede andere.

## Stufe 1 und 2 benutzen (`concept/`)

- `runConcept({ sample, project, analysis, flatSketch, roomSketch, wishes })` fragt das Wohnkonzept und danach je Raum das Raumprogramm, drei Räume gleichzeitig. Ergebnis: `FlatConcept`, `RoomProgram[]`, je Raum die offenen Probleme und Hinweise, ausgefallene Räume mit Grund.
- Jede Antwort wird geprüft. Findet die Prüfung Probleme, fragt der Ablauf einmal nach (`repairPrompt`: Aufgabe, letzte Antwort, Fehlerliste) und nimmt die bessere der beiden Antworten.
- Zeitlimit je Anfrage: Opus 12, Sonnet 5 Minuten. Nach Zeitüberschreitung oder unlesbarer Antwort wird einmal neu gefragt, nach Nutzungslimit oder Abbruch nicht.
- Modell: „gründlich“ nimmt Opus für Wohn-, Schlaf-, Kinder-, Arbeits-, Ess- und Küchenräume und für größere Durchgangszimmer, Sonnet für kleine Räume; „schnell“ nimmt überall Sonnet (`programModel`).
- Prüfung Wohnkonzept (`parseFlatConcept`):
  - jeder Raum genau einmal, mit gültigem Typ
  - jeder Wunsch hat eine Funktion
  - Esstisch, Gästeschlafplatz und Küchenzeile nur in einem Raum
  - Schlafzimmer mit „Schlafen“, Kochen irgendwo
  - kein neues Sanitär außer dem Handwaschbecken im WC ohne Becken
- Prüfung Raumprogramm (`parseRoomProgram`):
  - catalogIds aus der Liste, Zonen und Startplätze im Raum, Blickrichtung lesbar
  - Pflichtteile von Raumtyp und Funktionen da (`needs.ts`); sie bekommen `required`
  - kein Esstisch oder Gästebett, das laut Konzept in einen anderen Raum gehört
  - Küchenzeile nur, wo gekocht wird und noch keine Küche steht, mit Spüle und Kühlschrank, passend zur Wand
  - Bestand, den Claude noch einmal aufschreibt, fällt still heraus. Beziehungen zu ihm (Spiegel über dem Waschtisch) werden zu `wall` an seiner Wand.
- Beziehungen (`relations.ts`): Claude schreibt `[teil, wort, ziel, wert in cm]`. Wörter außerhalb des Vokabulars werden nach dem Ziel zugeordnet:
  - Stuhl `next-to` Tisch wird `around`, sonst `left-of`/`right-of` aus den Startplätzen
  - `on` einer Wand mit Fenster wird die Fensterbank, ein Vorhang an der Wand wird `window … over`
  - `against` wird `wall`, Ecke `E3` wird `corner`
  - Was nicht passt (Türen als Ziel), fällt mit Hinweis weg; der Startplatz trägt die Idee weiter.
- Tests mit den aufgezeichneten Antworten (`fixtures/recorded/`) und einer Fake-Antwort-Funktion; `concept/testFlats.ts` baut die Eingaben der Testwohnungen.

## Stufe 4 benutzen (`review/`)

- `reviewRoom({ analysis, type, layout, existing?, program?, palette?, catalog?, options? })` gibt ein `RoomReview` zurück: Befunde (Regel A1 … E5, Schwere, Text in Alltagssprache, betroffene Teile, Ort im Plan), Punkte nach `score.ts`, `passed` und die Kennzahlen (Belegung, Weglänge leer und eingerichtet, nicht aufgestellte Teile).
- `reviewFlat(inputs)` prüft alle Räume und liefert zusätzlich die Befunde der ganzen Wohnung (A2, eine Funktion doppelt) und `Review.score`/`minScore`/`passed`.
- Eingabe ist `Layout` von Stufe 3. Bestand im Raum (`RoomAnalysis.existing`) wird als `existing` mitgegeben: Er zählt für A1, blockiert Wege und löst keine Befunde über Neuplanung aus; was nur Bestand und Wand betrifft (eingebautes WC gegenüber der eingebauten Dusche, Bestand im Türaufschwung), meldet die Begehung nicht, weil der Vorschlag es nicht ändern kann.
- Wege (B1–B3) misst `checkWalkways` aus Stufe 0, also dasselbe wie der Solver. Alles andere (Bewegungsflächen, Erreichbarkeit, Schwenkflächen) rechnet `review/` auf einem Raster von 5 cm (10 cm ab 45 m²).
- Ohne `program` entfallen nur die Regeln, die Claudes Zonen brauchen (A5, E2, die Leseecke in D4, Farben E4, Raumteiler in C6/C8). `options` hält Ausnahmen, die der Nutzer bewusst wollte: neue Sanitärobjekte, Verdunkelung, erlaubte Doppelungen.
- Tests: `review/rules*.test.ts` (je Regel ein gutes und ein schlechtes Beispiel mit `review/testkit.ts`), `review/heute.test.ts` (der Vorschlag des alten Ablaufs für A und B liefert die bekannten Mängel), `review/flats.test.ts` (alle sechs Testwohnungen leer, unter 100 ms je Raum).

## Raumbild und Textkarte benutzen (`render/`)

Für die Kritik (Stufe 5) sieht Claude den eingerichteten Raum von oben.

- `roomPlanSvg({ analysis, layout?, existing?, program?, review?, roomNames?, catalog? }, { size?, labels?, legend? })` zeichnet den Raum als SVG und gibt `{ svg, width, height, ways }` zurück. Zu sehen sind:
  - Wände mit denselben Kürzeln wie in der Raumskizze: W1 …, Türen T1 … mit dem Raum dahinter und dem Aufschlag, Fenster F1 …
  - ein 50-cm-Raster mit Raumkoordinaten in cm am Rand und die Haupttür als Pfeil
  - die Zonen des Programms und jedes Teil mit seiner Kennung aus dem Programm (ohne Programm mit dem Namen), seiner Vorderseite und einem Symbol wie im 2D-Plan; Hängendes und Teile auf anderen Teilen gestrichelt, Bestand schraffiert
  - die Wege zwischen den Türen, wie sie im eingerichteten Raum laufen: grün frei, orange zu schmal, rot gestrichelt versperrt
  - die Befunde der Begehung als Marken an ihrem Ort und die Punktzahl im Titel
- `svgToPng(plan)` macht daraus im Browser ein PNG (`{ mediaType, data, width, height }`, `data` in Base64, höchstens 1568 px). Das geht an `sample` mit Bildern oder als Datei an den lokalen Helfer.
- `roomTextMap(input)` schreibt dasselbe als Text, für die Kritik ohne Bild (zusammen mit `roomSketch`) und als Liste neben dem Bild. Er enthält Zonen, Teile mit Mitte, Wand und Blickrichtung, die Küchenzeile, nicht aufgestellte Teile, Wege und Befunde.
- Beispiele: `render/__snapshots__/plan-*.svg` (auf GitHub direkt als Bild zu sehen) und `textmap-*.txt`.

## Stufe 5 benutzen (`critique.ts`)

Ein Raum, den die Begehung nicht besteht (ein schwerer Befund oder unter 85 Punkten), geht noch einmal an Claude.

- `buildCritiquePrompt({ base, program, layout, review, round, image?, textMap? })` stellt die Aufgabe von Stufe 2 noch einmal (`buildRoomProgramPrompt`), dazu das bisherige Programm in der Form der eigenen Antwort (`programAsAnswer`), das Bild oder die Textkarte und den Bericht der Begehung (`critiqueReport`: Befunde mit Ort, nicht aufgestellte Teile, weit verschobene Teile, Belegung).
- Verlangt ist wieder das vollständige Programm: dieselben ids und Plätze, wo nichts zu beanstanden war. `parseCritique` prüft es wie Stufe 2.
- Der Text sagt ausdrücklich, dass Claude keine Koordinaten nachrechnen soll – die App stellt millimetergenau auf, Claude gibt die Absicht vor.

## Ganzer Ablauf benutzen (`run.ts`)

`runFurnishing({ sample, project, roomIds, wishes, roomTypes?, products?, toImage?, seed?, timeouts?, signal?, onProgress? })` führt durch alle Stufen und gibt ein `FurnishRunResult` zurück (`FlatResult` plus Begehung der Wohnung, ausgefallene Räume, Aufrufprotokoll).

- Reihenfolge: Wohnung lesen → Wohnkonzept → Raumprogramme (drei Räume gleichzeitig) → Aufstellen → Begehung → Kritik → Begehung der ganzen Wohnung. `onProgress` meldet jede Stufe mit Raumnamen, `signal` bricht ab.
- Kritik höchstens zweimal je Raum, Schluss sobald der Raum besteht. Es gewinnt die bessere Runde, nicht die letzte (`better`): eine Antwort, die den Raum leert oder mehr Teile verliert, wird verworfen; eine fehlgeschlagene Runde lässt den Raum so, wie er stand.
- `toImage` zeichnet das Raumbild (im Browser `svgToPng`). Gefragt wird nur, wenn dieser Claude Bilder ansehen kann (`sample.images`); sonst geht die Textkarte mit. Im Claude-Artefakt braucht das die Fähigkeit `{ sample: { images: true } }`, lokal den Helfer ab Version 4 (`npm run ikea-helper`, Bilder als Dateien im Arbeitsordner).
- Ein Raum ohne verwertbare Antwort hält die anderen nicht auf; er steht am Ende in `failed`.
- Tests: `run.test.ts` mit nachgestelltem Claude auf den aufgezeichneten Antworten, `e2e/furnishConcept.spec.ts` in der echten Oberfläche (dort auch das Raumbild, das nur ein Browser zeichnen kann).

## Stufe 6 und Oberfläche benutzen (`apply/`)

- `proposalFrom(result, project, roomTypes?, catalog?)` macht aus dem Lauf den `DesignProposal`, den das Panel kennt: je Raum die Lesart des Programms, der Leitfaden aus dem Wohnkonzept, die Befunde der Planprüfung und die Möbel. Gleiche Teile in derselben Zone sind eine Zeile mit Anzahl; `pickItems(pick)` nennt die Programmteile dahinter.
- `placedRooms(result, roomTypes?)` gibt die aufgestellten Räume für Vorschau und Übernahme; `layoutSuggestion` daraus die Möbel fürs Projekt.
- `withProduct(result, project, swap, catalog, roomTypes?, seed?)` ist Stufe 6: Das gefundene Produkt kommt ins Raumprogramm, der Raum wird damit neu aufgestellt und neu begangen. Bringt das einen neuen schweren Befund oder verliert ein Teil seinen Platz, wird das Produkt nicht genommen (`taken: false`, `why`) – ein echter Schrank ist tiefer als sein Platzhalter und kann eine Tür blockieren.
- Im Panel (`src/assistant/DesignPanel.tsx`) steht der neue Weg unter „Verfahren“ als **Wohnkonzept** (Voreinstellung); **Möbelliste** ist der bisherige Weg und bleibt als Rückfall. Während des Laufs zeigt der Knopf die Stufe, je Raum stehen Lesart, Leitfaden, Begehung mit Punkten und die Begründung an jedem Möbel; die Vorschau zeigt die Zonen des Programms im 2D-Plan.

## Konventionen

- **Intern** Plankoordinaten in Metern wie im Modell: x nach Osten, y nach Süden, Norden ist oben im 2D-Plan. Drehung wie `Furniture.rotation`; die Vorderseite eines Möbels ist lokal +y (`rotationFacing`, `frontOf` in `suggest/roomGeometry.ts`).
- **Für Claude** Raumkoordinaten in ganzen cm ab der Nordwest-Ecke des umschließenden Rechtecks (`RoomAnalysis.origin`), Richtungen N, O, S, W. Umgerechnet wird nur beim Schreiben der Raumskizze und beim Lesen der Antwort (`coords.ts`).
- **Kürzel je Raum:** Wände W1, W2 … im Uhrzeigersinn, beginnend mit der Wand, die an der Nordwest-Ecke anfängt; Türen und Durchgänge T1 …, Fenster F1 … in Wandreihenfolge; Ecken E1 … (Ek ist das Ende von Wk); markierte Bereiche Z1 … wie im Plan. Eine Tür zwischen zwei Räumen hat in jedem Raum ihr eigenes Kürzel, `openingId` verbindet beide.
- **Seite einer Wand** = wo sie im Raum liegt: Die Nordwand ist oben, der Raum liegt südlich von ihr. **Blickrichtung** = wohin die Vorderseite zeigt: Ein Sofa an der Südwand schaut nach N.
- **Beziehungen** nur aus dem festen Vokabular (`Relation`). Abweichende Wörter aus Claudes Antwort („next-to“, „beside“, „against“) ordnet der Parser von Stufe 2 zu oder lässt sie reparieren.
- **Durchgangszimmer:** liegt auf einem kürzesten Türweg vom Eingang zu einem anderen Raum, der Eingangsraum eingeschlossen. Dort und in Gang und Vorraum bleiben Wege 90 cm breit, sonst 70 cm.
- **Schwere** der Befunde: S 25, M 8, L 2 Punkte Abzug; bestanden heißt kein S und mindestens 85 Punkte (`score.ts`).

## Regeln

- Kein Claude-Aufruf in Unit-Tests oder in der CI. Tests arbeiten mit Fixtures (`fixtures/recorded/`, Fake-Antworten). Echte Läufe nur lokal per Skript (mgritsch04/wohnungsplaner-3d#443).
- Aufstellen und Begehung sind deterministisch (fester Seed) und laufen im Browser, Ziel unter 300 ms je Raum.
- Je Stufe ein eigener Ordner, damit die Teilaufgaben parallel laufen können. Bestehende Dateien fasst erst der Einbau an (mgritsch04/wohnungsplaner-3d#442); Ausnahme sind kleine Exporte im Modell, etwa die Türschwenkflächen aus `model/placement.ts`.
- Händler-Code bleibt in `src/catalog/providers`.
- Testwohnungen sind erfunden: keine echte Wohnung, keine persönlichen Daten.

## Testwohnungen (`fixtures/flats.ts`)

| | Wohnung | prüft vor allem |
|---|---|---|
| A | 3 Zimmer, langer Gang (~78 m²) | neutrale Zimmernamen, getrenntes WC ohne Handwaschbecken, Balkon nur über das Wohnzimmer, Gästeschlafplatz und Esstisch nur einmal |
| B | 2 Zimmer, Wohnküche als Durchgangszimmer (~49 m²) | drei Türen in der Wohnküche mit freien Wegen, Küchenzeile neben Fenster und Balkontür |
| C | Familie, 4 Zimmer (~116 m²) | L-förmiger Wohn-Essraum mit offener Küche dahinter, zwei Kinderzimmer, Esstisch für 6, L-förmiger Vorraum mit acht Türen |
| D | Garçonnière (~28 m²) | ein Raum für Schlafen, Wohnen, Kochen und Essen, Kochnische ohne vorhandene Küche, kleines Budget |
| E | Altbau (~100 m²) | Erker mit schrägen Wänden, vier Türen im Wohnzimmer, Arbeitszimmer nur durch das Wohnzimmer erreichbar, 45 cm dicke Außenmauern |
| F | Neubau (~92 m²) | vorhandene Einbauküche, Glaselement zur Loggia, Bereich „frei lassen“, Schlafzimmer als Durchgang zu Schrankraum und eigenem Bad |

- `TEST_FLATS[key].build()` liefert immer dasselbe Projekt mit festen Kennungen (`room_c_wohn_essraum`, `wall_c007` …). `wishes` sind die Wünsche der erfundenen Bewohner.
- `TEST_FLATS[key].rooms` hält fest, was im Plan steht (Raumtypen, Türen, Fenster, Ecken, Durchgangszimmer). `fixtures/flats.test.ts` prüft das am Modell nach; Stufe 0 prüft ihre Analyse daran.
- A und B sind die Wohnungen der ersten Analyse vom 23.10.2026 und bleiben unverändert, damit neue Läufe mit diesem Ausgangswert vergleichbar sind. `fixtures/recorded/` enthält Claudes unveränderte Antworten aus dem ersten Versuch „Konzept zuerst“ für A und B (Raumkoordinaten in cm, Beziehungen als Liste).
- Ansehen in der App: `JSON.stringify(TEST_FLATS.C.build())` als `.wohnplan.json` speichern und über „Projekt › Projekt importieren“ laden.
