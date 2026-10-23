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
| 5 Kritik, 6 Produkte, Einbau | `src/assistant/` | `FlatResult` | mgritsch04/wohnungsplaner-3d#442 |
| Benchmark, Vorher/Nachher | `scripts/`, `e2e/` | Bericht | mgritsch04/wohnungsplaner-3d#443 |

Gemeinsam: `types.ts` (Schnittstellen aller Stufen), `coords.ts` (Raumkoordinaten und Himmelsrichtungen für Claude), `score.ts` (Punkte der Begehung), `fixtures/` (Testwohnungen und aufgezeichnete Claude-Antworten).

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
