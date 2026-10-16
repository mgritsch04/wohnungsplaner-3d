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
| 1 | Auswahlprobleme in 3D (Hinweis aus #31) | Klären, welche Möbel sich in 3D nicht auswählen lassen (Rückfrage in #31), dann beheben | zuverlässige Auswahl | P1 | deine Antwort in #31 | betroffene Möbel lassen sich in 3D auswählen | Blocked |
| 2 | Ducken beim Begehen (#20) | Taste für Ducken mit niedrigerer Kamera (deine Klarstellung in #20), Anzeige im Bild | Blick unter Tische/Regale | P3 | Augenhöhe-Einstellung (#23) | siehe Issue | Ready |
| 3 | Mehrfachauswahl, Kopieren/Einfügen von Möbeln | Rahmen-/Umschalt-Auswahl, gemeinsames Verschieben, Strg+C/V | schnelleres Einrichten (Stühle, Regale) | P2 | – | mehrere Möbel wählen, gemeinsam ziehen, kopieren; ein Undo-Schritt | Ready |
| 4 | IKEA-Import pflegen (#10) – paralleler Agent, Branch `claude/ikea-import-10` | GLB-Dateiweg bewahren; PAX-Planung: Stückliste über `scripts/ikea-products.mjs` anreichern (Namen, Preise, Modelle); Anleitung „Planung als JSON speichern“ mit Screenshots | vollständige Budgets aus IKEA-Planungen | P2 | Hilfsskript vorhanden | importierte PAX-Planung zeigt Preise im Budget, Korpusse mit Namen | In Progress (PR #45) |
| 5 | IKEA-Küchenplanung untersuchen (#27) – Recherche-Agent, Branch `claude/ikea-kitchen-27` | Netz ist freigegeben (#27, getestet: Host erreichbar). Planungen sind an IKEA-Konten gebunden → ohne Login vermutlich nur über eine von dir gespeicherte Planung (Option B) | Küche aus IKEA übernehmen | P2 | ggf. Beispiel-JSON von dir | Format dokumentiert, Import oder begründete Ablehnung | In Progress (PR #44) |
| 6 | Türen und Fenster in 3D öffnen/schließen (#21) | Klick/Taste schaltet Flügel; geöffneter Flügel zählt in der Kollisionsprüfung | Platzwirkung geöffneter Flügel | P3 | Kollisionssystem #4 | siehe Issue | Ready |
| 7 | Grundriss-PDF/-Bild-Import verbessern (#37), schräge Wände, Bemaßung | PDF-/Bildimport mit Maßstab und Wanderkennung (Beta) gibt es bereits (Import-Tab); offen: schräge Wände, Maßtexte, Räume automatisch | genauere Planimporte | P3 | – | Testplan mit schräger Wand wird erkannt; dein Plan als Test | Ready |
| 8 | Smart Home P2: simulierte Geräte im Plan (#24, Teil 1) | Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D | Melder-/Schalterpositionen planen (laut dir #28 Q7: nicht vorrangig) | P3 | – | [ROADMAP P2](smart-home/ROADMAP.md) | Ready |
| 9 | Smart Home P3/P4: Bewegungsmelder schaltet Licht, simuliert (#24, Teil 2) | Melder mit Licht verknüpfen, Erfassungsbereich, Simulation wirkt auf 3D-Licht | Zusammenspiel prüfen | P3 | Zeile 9; Lampenschalter (#7) | Melder im Erfassungsbereich → Licht an (Simulation), in 3D sichtbar | Ready |
| 10 | Allgemeiner Quelltext-Import überarbeiten | Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops | mehr Händler nutzbar | P3 | – | definierte Testseiten liefern korrekte Werte oder klare Fehlermeldung | Ready |
| 11 | Gamepad-Steuerung (#29) | Begehen mit Controller – von dir freigegeben, als Lückenfüller ganz hinten | – | P3 | – | [CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md) | Ready |
| 12 | Möbelix live | nur über eingefügten Seitenquelltext; kein Umgehen des Bot-Schutzes | – | P2 | Cloudflare-Bot-Schutz | – | Blocked |
| 13 | Möbelix-Küchenplanung übernehmen (#38) | Format unbekannt, Möbelix hinter Bot-Schutz | Küche aus Möbelix | P3 | Export-Datei oder gespeicherte Planung von dir (siehe #38) | Format dokumentiert, Import oder begründete Ablehnung | Blocked |
| 14 | Smart Home P5/P6: Live-Anbindung (#24, Teil 3) | Home Assistant lesend/steuernd | echte Geräte | P3 | Entscheidungen #28 teils vorläufig; **nicht freigegeben** | [ROADMAP](smart-home/ROADMAP.md) | Blocked |
| 15 | Geplante Routine (automatische Fortsetzung) (#30) | tägliche Läufe mit je einer Aufgabe | Fortschritt ohne manuelles Starten | P2 | deine Aufgabe #30 (Routine mit Repository anlegen) | [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md) | Blocked |
| 16 | Positionsmarker im 2D-Plan beim Begehen (#19) | Punkt + Blickkegel live im 2D-Plan, nur in 2D + 3D beim Begehen | Orientierung | P2 | – | 🧪 User-Test offen #46 | Done |
| 17 | Zoom-Regler (#6) | −/+/Schieber/Einpassen unten in 2D und 3D, synchron mit Mausrad; beim Begehen ausgeblendet | Bedienung ohne Mausrad | P2 | – | 🧪 User-Test offen #43 | Done |
| 18 | First-Person: Möbel auswählen und tragen (#39) | Klick aufs Fadenkreuz wählt aus, G trägt/setzt ab (folgt dem Blick, Kollisionsregeln wie beim Ziehen, ein Undo-Schritt); Teppiche stoppen an Wänden | Einrichten aus der Ich-Perspektive | P1 | – | 🧪 User-Test offen #42 | Done |
| 19 | Möbel-Hoverinformationen (#9) | Karte mit Name, Kategorie, Maße, Preis, Händler, Bild nach kurzer Verzögerung; nicht beim Ziehen, nicht bei Touch | schneller Überblick | P2 | – | 🧪 User-Test offen #41 | Done |
| 20 | Prioritäten und Issue-Pflege (#13, #34, #35, #36, #40, deine Zeile „High Prio Issues abarbeiten“) | Reihenfolge fehlgeschlagene Tests → `priority: high` → Kommentare → Ideen; Issue-Check je Aufgabe; Label `info`; IDEAS.md per PR nach `main`; keine Zusatzkosten | Verlässlichkeit | P1 | – | ⚙️ Regeln in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Done |
| 21 | Augenhöhe beim Begehen (Standard 163 cm) + Fadenkreuz (#23, #22) | Einstellung Projekt › Steuerung (3D), wirkt sofort, gespeichert; Fadenkreuz nur beim Begehen | realistische Blickhöhe, Orientierung | P2 | – | 🧪 User-Test offen #33 | Done |
| 22 | Drehen & Objektinteraktion (#5) | ±15°/±90° im Eigenschaften-Panel, Q/E, Feld „Drehung“; Kollisionsprüfung: aus Wand/Möbeln in freien Raum schieben, sonst Konflikt markieren | häufigster Bedienschritt | P2 | – | 🧪 User-Test offen #31 | Done |
| 23 | Nachtbeleuchtung (#7) | Dunkelwerden bis ~22:30, Lampenschalter automatisch/an/aus | glaubwürdige Abend-/Nachtwirkung | P1 | – | 🧪 User-Test offen #25 | Done |
| 24 | Möbelix: falscher Produkttyp (#8) | Typ aus Name/Seitenkategorie mit Sicherheitsstufe; Hauptprodukt statt Empfehlung | keine falschen Möbel | P1 | – | 🧪 User-Test offen #26 | Done |
| 25 | Einheitliches Kollisionssystem (#4) | Möbel blockieren sich; erlaubt: Teppich, Stuhl unter Tisch, Küche; Tischlampe auf Tisch; Platz vor Fronten | – | P1 | – | 🧪 User-Test offen #16 | Done |
| 26 | Backlog als Tabelle, Aufgaben als Issues (#15) | diese Tabelle; `user-task`-Issues #27–#29; Housekeeping (unten) | Übersicht | P1 | – | ⚙️ Dokumentation | Done |
| 27 | Modellwahl je Aufgabe (#18) | Regel in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) › „Modellwahl“ | Kontingent schonen | P1 | – | ⚙️ Dokumentation | Done |
| 28 | Issue-Workflow, Ideen-Erfassung, Vorlagen | Labels, `[IDEE]`/`[USERTEST]`-Vorlagen, Ablauf | – | – | – | ⚙️ Dokumentation (PR #17) | Done |
| 29 | Projekt speichern / erneut öffnen | – | – | – | – | 🧪 User-Test offen #11 | Done |
| 30 | IKEA: Artikelliste → Produktliste, PAX-Planung → Raum + Korpusse (PR #3) | – | – | – | – | 🧪 User-Test offen #12 | Done |
| 31 | 3D-Kollisionsanzeige (PR #2) | – | – | – | – | ❌ weitere Prüfung nötig → ersetzt durch #4 | Done |
| 32 | Tageszeit-Regler, Bedienung (PR #2) | – | – | – | – | ⚙️ Bedienung ok laut dir; Nachtwirkung → #7 | Done |
| 33 | Mausempfindlichkeit (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 34 | Klick vs. Ziehen, Auswahl in 2D/3D (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 35 | Wandfang, Platzierung nahe Ecken (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 36 | 2D/3D-Synchronisierung | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 37 | GLB-Modelle manuell herunterladen und importieren (PR #3) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 38 | Smart-Home-Konzept (Dokumentation) | [`smart-home/`](smart-home/README.md) | – | – | – | ⚙️ Dokumentation; offene Fragen → #28 | Done |

## Housekeeping 2026-10-16 (2)
- Deine Rückmeldungen verarbeitet: #27 (Netz frei → Untersuchung Ready), #28 (vorläufige Entscheidungen in `smart-home/DECISIONS.md`), #29 (Gamepad freigegeben, ganz hinten), #20 (Ducken statt Schleichen). User-Tests #26/#31 betrafen noch nicht gemergte Stände → nach Merge von PR #32 neu.
- Neue Ideen #13, #34–#40 übernommen; deine Zeile „High Prio Issues abarbeiten“ ist als Regel im Workflow umgesetzt.

## Housekeeping 2026-10-16
- Neue Inbox-Issues #15, #18–#24 übernommen (Label `planned`, bzw. `done` für die erledigten #15 und #18). #24 aufgeteilt: simulierte Geräte (Smart-Home-Zeilen) und Live-Anbindung (blockiert).
- „IKEA-Küchenplanung“ steht nur noch einmal (eine Zeile, Blocked); #14 war bereits geschlossen, die Aufgabe für dich ist jetzt #27.
- Frühere Inbox-Notizen: „Möbelix-Seiten mit echten Quelltexten testen“ → User-Test #26; „Anleitung PAX-JSON“ → Zeile „IKEA-Import pflegen“ (#10); „Mehrfachauswahl“ und „schräge Wände“ bewertet (als Ready bewertet).
- Aufgaben für dich als `user-task`-Issues: #27 (IKEA-Küche), #28 (Smart-Home-Entscheidungen), #29 (Gamepad), #30 (Routine einrichten).
