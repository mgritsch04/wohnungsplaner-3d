# Ideen-Backlog (Arbeitsplan der Hauptsession)

Kuratierter Arbeitsplan. **Neue Ideen bitte als GitHub-Issue mit Label `idea-inbox` erfassen** (Anleitung: [`IDEA_CAPTURE.md`](IDEA_CAPTURE.md)); die Hauptsession übernimmt sie hierher. Nur die Hauptsession bearbeitet diese Datei.
Workflow und Labels: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) · Stand der Umsetzung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) · Smart Home: [`smart-home/ROADMAP.md`](smart-home/ROADMAP.md).

**Ablauf:** Erfassen (`idea-inbox`) → Bewerten (Nutzen, Aufwand, Abhängigkeiten, Abnahme, Priorität `P1` hoch … `P3` niedrig; Label `planned`) → `Ready` (klar, nicht blockiert) oder `Blocked` (mit Grund) → `In Progress` (höchstens 1–2; Label `in-progress`) → `Done` (Commit/PR; manuelle Abnahme über `[USERTEST]`-Issue). Was die Hauptsession von dir braucht, steht als Issue mit Label `user-task` (Blocker zusätzlich `priority: high`).

**Abnahme-Vermerk bei `Done`:** ✅ von dir bestätigt (Datum) · 🧪 User-Test offen (#Issue) · ❌ fehlgeschlagen, Nachbesserung (#Issue) · ⚙️ nur automatisiert geprüft bzw. Dokumentation. „Done“ allein heißt **nicht** „von dir bestätigt“.

**Regel für künftige Sitzungen:** Ohne konkreten Auftrag: Rückmeldungen in `user-test`- und `user-task`-Issues verarbeiten, neue `idea-inbox`-Issues übernehmen, dann die oberste `Ready`-Zeile umsetzen, testen, integrieren, diese Datei und den Projektstatus aktualisieren. Ein konkreter Auftrag hat immer Vorrang.

Jeder Eintrag steht genau einmal in der Tabelle; die Spalte **Status** ist maßgeblich. Sortierung: In Progress → Ready (nach Priorität, innerhalb gleicher Priorität in Umsetzungsreihenfolge) → Blocked → Done.

## Übersicht

| # | Titel (Issue) | Beschreibung | Nutzen | Prio | Abhängigkeiten | Abnahme | Status |
|---|---|---|---|---|---|---|---|
| 1 | IKEA-Import pflegen (#10) – paralleler Agent, Branch `claude/ikea-import-10` | GLB-Dateiweg bewahren; PAX-Planung: Stückliste über `scripts/ikea-products.mjs` anreichern (Namen, Preise, Modelle); Anleitung „Planung als JSON speichern“ mit Screenshots | vollständige Budgets aus IKEA-Planungen | P2 | Hilfsskript vorhanden | importierte PAX-Planung zeigt Preise im Budget, Korpusse mit Namen | In Progress (PR #45) |
| 2 | IKEA-Küchenplanung untersuchen (#27) – Recherche-Agent, Branch `claude/ikea-kitchen-27` | Netz ist freigegeben (#27, getestet: Host erreichbar). Planungen sind an IKEA-Konten gebunden → ohne Login vermutlich nur über eine von dir gespeicherte Planung (Option B) | Küche aus IKEA übernehmen | P2 | ggf. Beispiel-JSON von dir | Format dokumentiert, Import oder begründete Ablehnung | In Progress (PR #44) |
| 3 | Türen und Fenster in 3D öffnen/schließen (#21) | Klick/Taste schaltet Flügel; geöffneter Flügel zählt in der Kollisionsprüfung | Platzwirkung geöffneter Flügel | P3 | Kollisionssystem #4 | siehe Issue | In Progress (Agent, Branch `claude/open-doors-21`) |
| 4 | Grundriss-PDF/-Bild-Import verbessern (#37), schräge Wände, Bemaßung | PDF-/Bildimport mit Maßstab und Wanderkennung (Beta) gibt es bereits (Import-Tab); offen: schräge Wände, Maßtexte, Räume automatisch | genauere Planimporte | P3 | – | Testplan mit schräger Wand wird erkannt; dein Plan als Test | In Progress (Agent, Branch `claude/plan-import-37`) |
| 5 | Speicherfehler deutlich melden (#60) | „Speicherfehler“ ist heute nur ein kleiner Hinweis; deutliche Meldung mit Ursache (privater Modus, Speicher voll) und Ausweg („jetzt als Datei exportieren“), verschwindet nach Erfolg | kein unbemerkter Datenverlust | P2 | – | Fehler simuliert → Meldung + Export-Knopf; nach Erfolg weg | Ready |
| 6 | Raster/Wandkante beim Ziehen (#52) | Raster- und Wandfang gibt es; prüfen, was im Issue fehlt (z. B. sichtbares Einrasten, Abstand zur Wandkante einstellbar) | präzises Platzieren | P2 | – | siehe Issue | Ready |
| 7 | CSV-Stückliste: Maße + gleiche Möbel zusammenfassen (#57) | Export existiert (UTF-8+BOM, `;`); ergänzen: Spalte Maße, gleiche Möbel = eine Zeile mit Menge | Einkauf/Abgleich | P3 | – | CSV öffnet in Excel/LibreOffice, gleiche Möbel zusammengefasst | Ready |
| 8 | Maßlinien zu Wänden und Möbeln in 2D (#50) | Abstände des gewählten Möbels zu den nächsten Wänden/Möbeln anzeigen | Planen mit Abständen | P3 | – | siehe Issue | Ready |
| 9 | Ausrichten und Verteilen mehrerer Möbel (#51) | links/rechts/mittig ausrichten, gleichmäßig verteilen | ordentliche Reihen | P3 | Mehrfachauswahl (PR #48) | siehe Issue | Ready |
| 10 | Kamera-Lesezeichen (#55) | 3D-Blickwinkel speichern und wieder aufrufen | Vergleich von Ansichten | P3 | – | siehe Issue | Ready |
| 11 | Fehlerbericht-Knopf (#62) | Browser, Version, Zustand ohne persönliche Daten kopieren/als Issue-Text | schnellere Fehlersuche | P3 | – | siehe Issue | Ready |
| 12 | Varianten speichern und vergleichen (#58) | mehrere Einrichtungsvarianten eines Projekts | Entscheidungen | P3 | Budget | siehe Issue | Ready |
| 13 | Tastenkürzel-Hilfe (#59) | Dialog mit allen Kürzeln (?), zuletzt, damit neue Kürzel enthalten sind | Bedienbarkeit | P3 | Mehrfachauswahl, Kamera-Lesezeichen | siehe Issue | Ready |
| 14 | Mehrgeschossige Gebäude mit Treppen (#54) | Ebenen im Datenmodell, Treppen, Umschalten 2D/3D | Häuser/Maisonetten | P3 | Schema-Migration; großer Umfang | siehe Issue | Ready |
| 15 | Smart Home P2: simulierte Geräte im Plan (#24, Teil 1) | Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D | Melder-/Schalterpositionen planen (laut dir #28 Q7: nicht vorrangig) | P3 | – | [ROADMAP P2](smart-home/ROADMAP.md) | Ready |
| 16 | Smart Home P3/P4: Bewegungsmelder schaltet Licht, simuliert (#24, Teil 2) | Melder mit Licht verknüpfen, Erfassungsbereich, Simulation wirkt auf 3D-Licht | Zusammenspiel prüfen | P3 | Zeile 9; Lampenschalter (#7) | Melder im Erfassungsbereich → Licht an (Simulation), in 3D sichtbar | Ready |
| 17 | Allgemeiner Quelltext-Import überarbeiten | Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops | mehr Händler nutzbar | P3 | – | definierte Testseiten liefern korrekte Werte oder klare Fehlermeldung | Ready |
| 18 | Gamepad-Steuerung (#29) | Begehen mit Controller – von dir freigegeben, als Lückenfüller ganz hinten | – | P3 | – | [CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md) | Ready |
| 19 | Auswahlprobleme in 3D (Hinweis aus #31) | Klären, welche Möbel sich in 3D nicht auswählen lassen (Rückfrage in #31), dann beheben | zuverlässige Auswahl | P1 | deine Antwort in #31 | betroffene Möbel lassen sich in 3D auswählen | Blocked |
| 20 | Möbelix live | nur über eingefügten Seitenquelltext; kein Umgehen des Bot-Schutzes | – | P2 | Cloudflare-Bot-Schutz | – | Blocked |
| 21 | Möbelix-Küchenplanung übernehmen (#38) | Format unbekannt, Möbelix hinter Bot-Schutz | Küche aus Möbelix | P3 | Export-Datei oder gespeicherte Planung von dir (siehe #38) | Format dokumentiert, Import oder begründete Ablehnung | Blocked |
| 22 | Smart Home P5/P6: Live-Anbindung (#24, Teil 3) | Home Assistant lesend/steuernd | echte Geräte | P3 | Entscheidungen #28 teils vorläufig; **nicht freigegeben** | [ROADMAP](smart-home/ROADMAP.md) | Blocked |
| 23 | Geplante Routine (automatische Fortsetzung) (#30) | tägliche Läufe mit je einer Aufgabe | Fortschritt ohne manuelles Starten | P2 | deine Aufgabe #30 (Routine mit Repository anlegen) | [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md) | Blocked |
| 24 | Mehrfachauswahl, Kopieren/Einfügen | Umschalt+Klick, Auswahlrahmen (Umschalt+Ziehen), gemeinsam verschieben, Pfeiltasten, Strg+C/V/A, Entf, je ein Undo-Schritt | schnelleres Einrichten | P2 | – | 🧪 User-Test offen #94 | Done |
| 25 | Undo/Redo für alle Änderungen (#49) | existierte bereits (Strg+Z/Y, ↶/↷, ein Schritt je Ziehen) | – | – | – | ℹ️ im Issue erklärt, du schließt | Done |
| 26 | Kollision beim Begehen (#53) | existierte bereits (Wände + feste Möbel, 22 cm Radius, Gleiten); Rückfrage: Lampen/Pflanzen fest? | – | – | – | ℹ️ Rückfrage in #53 | Done |
| 27 | Budget-Übersicht (#56) | existierte bereits (Reiter „Budget“, „ohne Preis“ statt 0 €) | – | – | – | ℹ️ im Issue erklärt, du schließt | Done |
| 28 | Ducken beim Begehen (#20) | C halten: Kamera weich auf ~60 % (min. 80 cm), langsamer, Anzeige „Geduckt“ | Blick unter Tische/Regale | P3 | – | 🧪 User-Test offen #47 | Done |
| 29 | Positionsmarker im 2D-Plan beim Begehen (#19) | Punkt + Blickkegel live im 2D-Plan, nur in 2D + 3D beim Begehen | Orientierung | P2 | – | 🧪 User-Test offen #46 | Done |
| 30 | Zoom-Regler (#6) | −/+/Schieber/Einpassen unten in 2D und 3D, synchron mit Mausrad; beim Begehen ausgeblendet | Bedienung ohne Mausrad | P2 | – | 🧪 User-Test offen #43 | Done |
| 31 | First-Person: Möbel auswählen und tragen (#39) | Klick aufs Fadenkreuz wählt aus, G trägt/setzt ab (folgt dem Blick, Kollisionsregeln wie beim Ziehen, ein Undo-Schritt); Teppiche stoppen an Wänden | Einrichten aus der Ich-Perspektive | P1 | – | 🧪 User-Test offen #42 | Done |
| 32 | Möbel-Hoverinformationen (#9) | Karte mit Name, Kategorie, Maße, Preis, Händler, Bild nach kurzer Verzögerung; nicht beim Ziehen, nicht bei Touch | schneller Überblick | P2 | – | 🧪 User-Test offen #41 | Done |
| 33 | Prioritäten und Issue-Pflege (#13, #34, #35, #36, #40, deine Zeile „High Prio Issues abarbeiten“) | Reihenfolge fehlgeschlagene Tests → `priority: high` → Kommentare → Ideen; Issue-Check je Aufgabe; Label `info`; IDEAS.md per PR nach `main`; keine Zusatzkosten | Verlässlichkeit | P1 | – | ⚙️ Regeln in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Done |
| 34 | Augenhöhe beim Begehen (Standard 163 cm) + Fadenkreuz (#23, #22) | Einstellung Projekt › Steuerung (3D), wirkt sofort, gespeichert; Fadenkreuz nur beim Begehen | realistische Blickhöhe, Orientierung | P2 | – | 🧪 User-Test offen #33 | Done |
| 35 | Drehen & Objektinteraktion (#5) | ±15°/±90° im Eigenschaften-Panel, Q/E, Feld „Drehung“; Kollisionsprüfung: aus Wand/Möbeln in freien Raum schieben, sonst Konflikt markieren | häufigster Bedienschritt | P2 | – | 🧪 User-Test offen #31 | Done |
| 36 | Nachtbeleuchtung (#7) | Dunkelwerden bis ~22:30, Lampenschalter automatisch/an/aus | glaubwürdige Abend-/Nachtwirkung | P1 | – | 🧪 User-Test offen #25 | Done |
| 37 | Möbelix: falscher Produkttyp (#8) | Typ aus Name/Seitenkategorie mit Sicherheitsstufe; Hauptprodukt statt Empfehlung | keine falschen Möbel | P1 | – | 🧪 User-Test offen #26 | Done |
| 38 | Einheitliches Kollisionssystem (#4) | Möbel blockieren sich; erlaubt: Teppich, Stuhl unter Tisch, Küche; Tischlampe auf Tisch; Platz vor Fronten | – | P1 | – | 🧪 User-Test offen #16 | Done |
| 39 | Backlog als Tabelle, Aufgaben als Issues (#15) | diese Tabelle; `user-task`-Issues #27–#29; Housekeeping (unten) | Übersicht | P1 | – | ⚙️ Dokumentation | Done |
| 40 | Modellwahl je Aufgabe (#18) | Regel in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) › „Modellwahl“ | Kontingent schonen | P1 | – | ⚙️ Dokumentation | Done |
| 41 | Issue-Workflow, Ideen-Erfassung, Vorlagen | Labels, `[IDEE]`/`[USERTEST]`-Vorlagen, Ablauf | – | – | – | ⚙️ Dokumentation (PR #17) | Done |
| 42 | Projekt speichern / erneut öffnen | – | – | – | – | 🧪 User-Test offen #11 | Done |
| 43 | IKEA: Artikelliste → Produktliste, PAX-Planung → Raum + Korpusse (PR #3) | – | – | – | – | 🧪 User-Test offen #12 | Done |
| 44 | 3D-Kollisionsanzeige (PR #2) | – | – | – | – | ❌ weitere Prüfung nötig → ersetzt durch #4 | Done |
| 45 | Tageszeit-Regler, Bedienung (PR #2) | – | – | – | – | ⚙️ Bedienung ok laut dir; Nachtwirkung → #7 | Done |
| 46 | Mausempfindlichkeit (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 47 | Klick vs. Ziehen, Auswahl in 2D/3D (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 48 | Wandfang, Platzierung nahe Ecken (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 49 | 2D/3D-Synchronisierung | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 50 | GLB-Modelle manuell herunterladen und importieren (PR #3) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 51 | Smart-Home-Konzept (Dokumentation) | [`smart-home/`](smart-home/README.md) | – | – | – | ⚙️ Dokumentation; offene Fragen → #28 | Done |

## Housekeeping 2026-10-16 (3)
- Neue Ideen #49–#62 übernommen: #49/#53/#56 existierten bereits (Label `info`, Erklärung im Issue), #57/#60 teilweise (Rest eingeplant), übrige als Ready-Zeilen. Agenten-Aufgaben #10/#27/#21/#37 als In Progress mit Branch.

## Housekeeping 2026-10-16 (2)
- Deine Rückmeldungen verarbeitet: #27 (Netz frei → Untersuchung Ready), #28 (vorläufige Entscheidungen in `smart-home/DECISIONS.md`), #29 (Gamepad freigegeben, ganz hinten), #20 (Ducken statt Schleichen). User-Tests #26/#31 betrafen noch nicht gemergte Stände → nach Merge von PR #32 neu.
- Neue Ideen #13, #34–#40 übernommen; deine Zeile „High Prio Issues abarbeiten“ ist als Regel im Workflow umgesetzt.

## Housekeeping 2026-10-16
- Neue Inbox-Issues #15, #18–#24 übernommen (Label `planned`, bzw. `done` für die erledigten #15 und #18). #24 aufgeteilt: simulierte Geräte (Smart-Home-Zeilen) und Live-Anbindung (blockiert).
- „IKEA-Küchenplanung“ steht nur noch einmal (eine Zeile, Blocked); #14 war bereits geschlossen, die Aufgabe für dich ist jetzt #27.
- Frühere Inbox-Notizen: „Möbelix-Seiten mit echten Quelltexten testen“ → User-Test #26; „Anleitung PAX-JSON“ → Zeile „IKEA-Import pflegen“ (#10); „Mehrfachauswahl“ und „schräge Wände“ bewertet (als Ready bewertet).
- Aufgaben für dich als `user-task`-Issues: #27 (IKEA-Küche), #28 (Smart-Home-Entscheidungen), #29 (Gamepad), #30 (Routine einrichten).
