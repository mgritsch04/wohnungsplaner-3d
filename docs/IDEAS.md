# Ideen-Backlog (Arbeitsplan der Hauptsession)

Kuratierter Arbeitsplan. **Neue Ideen bitte als GitHub-Issue mit Label `idea-inbox` erfassen** (Anleitung: [`IDEA_CAPTURE.md`](IDEA_CAPTURE.md)); die Hauptsession übernimmt sie hierher. Nur die Hauptsession bearbeitet diese Datei.
Workflow und Labels: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) · Stand der Umsetzung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) · Smart Home: [`smart-home/ROADMAP.md`](smart-home/ROADMAP.md).

**Ablauf:** Erfassen (`idea-inbox`) → Bewerten (Nutzen, Aufwand, Abhängigkeiten, Abnahme, Priorität `P1` hoch … `P3` niedrig; Label `planned`) → `Ready` (klar, nicht blockiert) oder `Blocked` (mit Grund) → `In Progress` (höchstens 1–2; Label `in-progress`) → `Done` (Commit/PR; manuelle Abnahme über `[USERTEST]`-Issue). Was die Hauptsession von dir braucht, steht als Issue mit Label `user-task` (Blocker zusätzlich `priority: high`).

**Abnahme-Vermerk bei `Done`:** ✅ von dir bestätigt (Datum) · 🧪 User-Test offen (#Issue) · ❌ fehlgeschlagen, Nachbesserung (#Issue) · ⚙️ nur automatisiert geprüft bzw. Dokumentation. „Done“ allein heißt **nicht** „von dir bestätigt“.

**Regel für künftige Sitzungen:** Ohne konkreten Auftrag: Rückmeldungen in `user-test`- und `user-task`-Issues verarbeiten, neue `idea-inbox`-Issues übernehmen, dann die oberste `Ready`-Zeile umsetzen, testen, integrieren, diese Datei und den Projektstatus aktualisieren. Ein konkreter Auftrag hat immer Vorrang.

Jeder Eintrag steht genau einmal in der Tabelle; die Spalte **Status** ist maßgeblich. `Ready`-Zeilen stehen in Umsetzungsreihenfolge.

## Übersicht

| # | Titel (Issue) | Beschreibung | Nutzen | Prio | Abhängigkeiten | Abnahme | Status |
|---|---|---|---|---|---|---|---|
| 1 | Drehen & Objektinteraktion (#5) | Drehen im Eigenschaften-Panel und per Tastatur, gleich in 2D/3D; Kamera- vs. Objektbedienung klar trennen | häufigster Bedienschritt beim Einrichten | P2 | #4 umgesetzt | siehe Issue; `[USERTEST]` | Ready |
| 2 | Augenhöhe beim Begehen einstellbar, Standard 163 cm (#23) | Einstellung unter Projekt › Steuerung, wirkt sofort, wird gespeichert | realistische Blickhöhe | P2 | – | siehe Issue | Ready |
| 3 | Fadenkreuz beim Begehen (#22) | kleines Fadenkreuz in der Bildmitte, nur im Begehen-Modus | Orientierung beim Ausrichten | P3 | – (zusammen mit #23 umsetzbar) | siehe Issue | Ready |
| 4 | Möbel-Hoverinformationen (#9) | Name, Kategorie, Preis, Maße, Händler, Bild beim Überfahren; nur echte Daten, kein Stören beim Ziehen, Touch berücksichtigen | schneller Überblick ohne Auswahl | P2 | – | siehe Issue | Ready |
| 5 | Zoom-Regler (#6) | Regler am unteren Viewport-Rand, synchron mit Mausrad | Bedienung ohne Mausrad/Touchpad | P2 | – | siehe Issue | Ready |
| 6 | Positionsmarker im 2D-Plan beim Begehen (#19) | Punkt + Blickrichtung im 2D-Plan, live, nur bei 2D + 3D | Orientierung in großen Wohnungen | P2 | – | siehe Issue | Ready |
| 7 | Mehrfachauswahl, Kopieren/Einfügen von Möbeln | Rahmen-/Umschalt-Auswahl, gemeinsames Verschieben, Strg+C/V | schnelleres Einrichten (Stühle, Regale) | P2 | – | mehrere Möbel wählen, gemeinsam ziehen, kopieren; ein Undo-Schritt | Ready |
| 8 | IKEA-Import pflegen (#10) | GLB-Dateiweg bewahren; PAX-Planung: Stückliste über `scripts/ikea-products.mjs` anreichern (Namen, Preise, Modelle); Anleitung „Planung als JSON speichern“ mit Screenshots | vollständige Budgets aus IKEA-Planungen | P2 | Hilfsskript vorhanden | importierte PAX-Planung zeigt Preise im Budget, Korpusse mit Namen | Ready |
| 9 | Smart Home P2: simulierte Geräte im Plan (#24, Teil 1) | Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D | Melder-/Schalterpositionen planen | P2 | – | [ROADMAP P2](smart-home/ROADMAP.md) | Ready |
| 10 | Türen und Fenster in 3D öffnen/schließen (#21) | Klick/Taste schaltet Flügel; geöffneter Flügel zählt in der Kollisionsprüfung | Platzwirkung geöffneter Flügel | P3 | Kollisionssystem #4 | siehe Issue | Ready |
| 11 | Schleichen beim Begehen (#20) | Taste für langsames Gehen (Gegenstück zu Umschalt = schneller), Anzeige im Bild | präzises Gehen an Möbeln | P3 | – | siehe Issue; Deutung „langsamer Schritt“ (Ducken nicht vorgesehen) | Ready |
| 12 | Smart Home P3/P4: Bewegungsmelder schaltet Licht, simuliert (#24, Teil 2) | Melder mit Licht verknüpfen, Erfassungsbereich, Simulation wirkt auf 3D-Licht | Zusammenspiel prüfen | P3 | Zeile 9; Lampenschalter (#7) | Melder im Erfassungsbereich → Licht an (Simulation), in 3D sichtbar | Ready |
| 13 | Schräge Wände in der Plan-Erkennung, Bemaßung aus PDFs | Erkennung nicht achsparalleler Wände; Maßtexte zur Maßstabsprüfung | genauere Planimporte | P3 | – | Testplan mit schräger Wand wird erkannt | Ready |
| 14 | Allgemeiner Quelltext-Import überarbeiten | Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops | mehr Händler nutzbar | P3 | – | definierte Testseiten liefern korrekte Werte oder klare Fehlermeldung | Ready |
| 15 | Möbelix live | nur über eingefügten Seitenquelltext; kein Umgehen des Bot-Schutzes | – | P2 | Cloudflare-Bot-Schutz | – | Blocked |
| 16 | IKEA-Küchenplanung importieren (#27) | Format unbekannt, Backend aus der Umgebung gesperrt | Küche aus IKEA übernehmen | P2 | deine Aufgabe #27 | Format dokumentiert, Import oder begründete Ablehnung | Blocked |
| 17 | Smart Home P5/P6: Live-Anbindung (#24, Teil 3) | Home Assistant lesend/steuernd | echte Geräte | P3 | deine Aufgabe #28; **nicht freigegeben** | [ROADMAP](smart-home/ROADMAP.md) | Blocked |
| 18 | Gamepad-Steuerung (#29) | Begehen mit Controller | – | P3 | deine Aufgabe #29 | [CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md) | Blocked |
| 19 | Nachtbeleuchtung (#7) | Dunkelwerden bis ~22:30, Lampenschalter automatisch/an/aus | glaubwürdige Abend-/Nachtwirkung | P1 | – | 🧪 User-Test offen #25 | Done |
| 20 | Möbelix: falscher Produkttyp (#8) | Typ aus Name/Seitenkategorie mit Sicherheitsstufe; Hauptprodukt statt Empfehlung | keine falschen Möbel | P1 | – | 🧪 User-Test offen #26 | Done |
| 21 | Einheitliches Kollisionssystem (#4) | Möbel blockieren sich; erlaubt: Teppich, Stuhl unter Tisch, Küche; Tischlampe auf Tisch; Platz vor Fronten | – | P1 | – | 🧪 User-Test offen #16 | Done |
| 22 | Backlog als Tabelle, Aufgaben als Issues (#15) | diese Tabelle; `user-task`-Issues #27–#29; Housekeeping (unten) | Übersicht | P1 | – | ⚙️ Dokumentation | Done |
| 23 | Modellwahl je Aufgabe (#18) | Regel in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) › „Modellwahl“ | Kontingent schonen | P1 | – | ⚙️ Dokumentation | Done |
| 24 | Issue-Workflow, Ideen-Erfassung, Vorlagen | Labels, `[IDEE]`/`[USERTEST]`-Vorlagen, Ablauf | – | – | – | ⚙️ Dokumentation (PR #17) | Done |
| 25 | Projekt speichern / erneut öffnen | – | – | – | – | 🧪 User-Test offen #11 | Done |
| 26 | IKEA: Artikelliste → Produktliste, PAX-Planung → Raum + Korpusse (PR #3) | – | – | – | – | 🧪 User-Test offen #12 | Done |
| 27 | 3D-Kollisionsanzeige (PR #2) | – | – | – | – | ❌ weitere Prüfung nötig → ersetzt durch #4 | Done |
| 28 | Tageszeit-Regler, Bedienung (PR #2) | – | – | – | – | ⚙️ Bedienung ok laut dir; Nachtwirkung → #7 | Done |
| 29 | Mausempfindlichkeit (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 30 | Klick vs. Ziehen, Auswahl in 2D/3D (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 31 | Wandfang, Platzierung nahe Ecken (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 32 | 2D/3D-Synchronisierung | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 33 | GLB-Modelle manuell herunterladen und importieren (PR #3) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 34 | Smart-Home-Konzept (Dokumentation) | [`smart-home/`](smart-home/README.md) | – | – | – | ⚙️ Dokumentation; offene Fragen → #28 | Done |

## Housekeeping 2026-10-16
- Neue Inbox-Issues #15, #18–#24 übernommen (Label `planned`, bzw. `done` für die erledigten #15 und #18). #24 aufgeteilt: simulierte Geräte (Zeilen 9, 12) und Live-Anbindung (Zeile 17, blockiert).
- „IKEA-Küchenplanung“ steht nur noch einmal (Zeile 16); #14 war bereits geschlossen, die Aufgabe für dich ist jetzt #27.
- Frühere Inbox-Notizen: „Möbelix-Seiten mit echten Quelltexten testen“ → User-Test #26; „Anleitung PAX-JSON“ → Zeile 8 (#10); „Mehrfachauswahl“ und „schräge Wände“ bewertet (Zeilen 7, 13).
- Aufgaben für dich als `user-task`-Issues: #27 (IKEA-Küche), #28 (Smart-Home-Entscheidungen), #29 (Gamepad).
