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
| 4 | Grundriss-PDF/-Bild-Import verbessern (#37), schräge Wände, Bemaßung | PDF-/Bildimport mit Maßstab und Wanderkennung (Beta) gibt es bereits (Import-Tab); offen: schräge Wände, Maßtexte, Räume automatisch | genauere Planimporte | P3 | – | Testplan mit schräger Wand wird erkannt; dein Plan als Test | In Progress (Agent, Branch `claude/plan-import-37`) |
| 5 | Speicherfehler deutlich melden (#60) | „Speicherfehler“ ist heute nur ein kleiner Hinweis; deutliche Meldung mit Ursache (privater Modus, Speicher voll) und Ausweg („jetzt als Datei exportieren“), verschwindet nach Erfolg | kein unbemerkter Datenverlust | P2 | – | Fehler simuliert → Meldung + Export-Knopf; nach Erfolg weg | Ready |
| 7 | Projektversionen und Varianten: Zwischenstand benennen, zurückspringen, vergleichen (#66, #58) | Benannte Zwischenstände mit Datum speichern, öffnen, löschen; heute nur Undo/Redo und mehrere Projekte. #58 (Varianten) wird damit zusammengelegt | ohne Angst Änderungen machen | P2 | – | Stand speichern, ändern, Stand öffnen: alter Stand da, aktueller bleibt erreichbar | Ready |
| 8 | Plan als PDF/Bild exportieren, inkl. Druckansicht (#71, #72) | Grundriss als PDF und PNG mit Maßen, Titel, Maßstab; Druckansicht mit Plan + Stückliste auf einer Seite (#72 hier aufgenommen); heute nur Projekt-/JSON-/CSV-Export | an Handwerker geben, drucken | P2 | – | PDF/PNG öffnen sich, Maße/Titel/Maßstab sichtbar; Druckvorschau ohne Bedienelemente | Ready |
| 9 | Mindestbreiten und Laufwege (#68, #67) | Durchgänge gegen Mindestbreite (Standard 90 cm, einstellbar) prüfen und markieren; kürzester Laufweg zwischen zwei Punkten in m (gemeinsame Wegegeometrie) | sicher und barrierefrei planen | P2 | – | Durchgang < 90 cm in 2D/3D markiert; Laufweg mit Länge sichtbar | Ready |
| 11 | Maßlinien zu Wänden und Möbeln in 2D (#50) | Abstände des gewählten Möbels zu den nächsten Wänden/Möbeln anzeigen | Planen mit Abständen | P3 | – | siehe Issue | Ready |
| 12 | Ausrichten und Verteilen mehrerer Möbel (#51) | links/rechts/mittig ausrichten, gleichmäßig verteilen | ordentliche Reihen | P3 | Mehrfachauswahl (PR #48) | siehe Issue | Ready |
| 13 | Kamera-Lesezeichen (#55) | 3D-Blickwinkel speichern und wieder aufrufen | Vergleich von Ansichten | P3 | – | siehe Issue | Ready |
| 14 | Fehlerbericht-Knopf (#62) | Browser, Version, Zustand ohne persönliche Daten kopieren/als Issue-Text | schnellere Fehlersuche | P3 | – | siehe Issue | Ready |
| 15 | Tastenkürzel-Hilfe (#59) | Dialog „Hilfe und Tastenkürzel“ existiert bereits; ergänzen um neue Kürzel (Mehrfachauswahl, G/C beim Begehen) | Bedienbarkeit | P3 | Mehrfachauswahl, Kamera-Lesezeichen | siehe Issue | Ready |
| 16 | Mehrgeschossige Gebäude mit Treppen (#54) | Ebenen im Datenmodell, Treppen, Umschalten 2D/3D | Häuser/Maisonetten | P3 | Schema-Migration; großer Umfang | siehe Issue | Ready |
| 17 | Smart Home P2: simulierte Geräte im Plan (#24, Teil 1) | Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D | Melder-/Schalterpositionen planen (laut dir #28 Q7: nicht vorrangig) | P3 | – | [ROADMAP P2](smart-home/ROADMAP.md) | Ready |
| 18 | Smart Home P3/P4: Bewegungsmelder schaltet Licht, simuliert (#24, Teil 2) | Melder mit Licht verknüpfen, Erfassungsbereich, Simulation wirkt auf 3D-Licht | Zusammenspiel prüfen | P3 | Zeile 9; Lampenschalter (#7) | Melder im Erfassungsbereich → Licht an (Simulation), in 3D sichtbar | Ready |
| 19 | Allgemeiner Quelltext-Import überarbeiten | Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops | mehr Händler nutzbar | P3 | – | definierte Testseiten liefern korrekte Werte oder klare Fehlermeldung | Ready |
| 20 | Gamepad-Steuerung (#29) | Begehen mit Controller – von dir freigegeben, als Lückenfüller ganz hinten | – | P3 | – | [CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md) | Ready |
| 21 | Materialien/Texturen für Möbel (#63) | Wände, Böden, Decke haben Materialauswahl bereits; Möbel nur Farbe → Material/Textur ergänzen | realistischere 3D-Ansicht | P3 | – | Material wählbar, gespeichert, in 3D sichtbar | Ready |
| 22 | Installationsplan: Steckdosen, Schalter, Heizkörper, Wasser/Abwasser (#64, #81) | Ein gemeinsames Datenmodell „Installationen“ mit Typen, platzierbar in 2D/3D, rastet an der Wand; Grundlage auch für Smart-Home-Geräte (#24) | Installationen beim Möbelplanen beachten | P3 | mit Smart Home P2 (#24) gemeinsam | Elemente platzier-/verschiebbar, 2D+3D sichtbar; Möbel über Wasseranschluss markiert | Ready |
| 23 | Gruppen von Möbeln (#65) | Dauerhafte Gruppen (z. B. Küchenzeile) zusammen verschieben/drehen; temporäre Mehrfachauswahl gibt es (PR #48) | Einheit bewegen | P3 | Mehrfachauswahl (#94) abwarten | Gruppe bilden/verschieben/drehen/trennen | Ready |
| 24 | Tageslicht pro Raum und Balkon-Sonne (#69, #93) | Himmelsrichtung im Projekt; je Raum grobe Tageslicht-Schätzung aus Fensterrichtung; Balkon/Terrasse Sonnenzeiten (#93 hier aufgenommen) | Raumqualität vergleichen | P3 | – | Himmelsrichtung einstellbar; Schätzung je Raum/Balkon, als Schätzung gekennzeichnet | Ready |
| 25 | Dunkelmodus (#73) | Umschalter hell/dunkel/System für die Oberfläche | Bedienung abends | P3 | – | Umschalter wirkt, bleibt nach Neuladen, gut lesbar | Ready |
| 26 | Touch: zwei Finger zoomen und drehen (#74) | 2D hat nur Mausrad; 3D OrbitControls am Tablet ungeprüft | Bedienung ohne Maus | P3 | Zoom-Regler (vorhanden) | Tablet: zwei Finger zoomen/drehen in 2D und 3D | Ready |
| 27 | Stückliste nach Räumen gruppieren (#75) | Zwischensumme je Raum, CSV mit Gruppierung | getrennte Abrechnung | P3 | CSV-Stückliste (#57) zuerst | Zwischensumme je Raum, CSV gruppiert | Ready |
| 28 | Sitzposition beim Begehen (#78) | Umschalter Stehen/Sitzen, Sitz-Augenhöhe einstellbar (Standard 120 cm) | Blick vom Sofa | P3 | Augenhöhe/Ducken (vorhanden) | Umschalten wirkt sofort | Ready |
| 29 | Hilfetexte mit Info-Symbolen (#79) | Kurze Erklärungen bei Begriffen (Realismus, Tageszeit …); ergänzt den vorhandenen Dialog „Hilfe und Tastenkürzel“ | Verständlichkeit | P3 | – | wichtige Bedienelemente mit Info-Symbol | Ready |
| 30 | Wandaufbau und Schallschutz-Schätzung (#80) | Aufbau je Wand (Ziegel, Trockenbau, Beton), grobe Schätzung, Problemfälle markieren | Ruhe planen | P3 | – | Aufbau wählbar, Schätzung gekennzeichnet | Ready |
| 31 | Küchen-Arbeitsdreieck (#82) | Dreieck Kühlschrank–Spüle–Herd im Plan, Warnung bei zu langen Wegen | effizient kochen | P3 | Küchenplaner (vorhanden) | Dreieck sichtbar, Warnung, aktualisiert beim Verschieben | Ready |
| 32 | Notizen, Aufgaben je Raum, Umzugs-Checkliste (#83, #84, #91) | Gemeinsame Basis: Notiz-Pins an Raum/Möbel, abhakbare Liste je Raum, projektweite Umzugs-Checkliste mit Terminen | Erinnerungen am Ort | P3 | – | Pins/Listen anlegen, abhaken, gespeichert | Ready |
| 33 | Schrankinnenaufteilung (#85) | Fächer, Schubladen, Stangen mit Mindestmaßen | genaue Schrankplanung | P3 | Türen öffnen (#21) hilfreich | Aufteilung in 2D/3D sichtbar | Ready |
| 34 | Fotos als Referenz an Wänden (#86) | eigenes Foto einer Wand zuordnen, Transparenz, lokal gespeichert | Foto mit Plan vergleichen | P3 | – | Foto sichtbar, Transparenz einstellbar | Ready |
| 35 | 3D-Modell als GLB exportieren (#87) | Wohnung mit Möbeln als .glb | Handwerker/Familie ansehen lassen | P3 | – | .glb öffnet sich in gängigem Viewer | Ready |
| 36 | Maßband in 3D (#88) | zwei Punkte in 3D anklicken, Abstand in m | Abstände im Raum prüfen | P3 | mit Maßlinien (#50) planen | Abstand sichtbar, löschbar | Ready |
| 37 | Sichtlinien vom Eingang (#89) | Blickpunkt setzen, sichtbare/verdeckte Bereiche im Plan | Anordnung prüfen | P3 | – | Bereiche unterscheidbar | Ready |
| 38 | Heizkosten-Schätzung (#90) | grobe €/Jahr aus Fläche und Dämmstandard, als Schätzung gekennzeichnet | Kosten im Blick | P3 | Wandaufbau (#80) optional | Schätzung mit Annahmen | Ready |
| 39 | Blick von außen: Gebäude (#92) | Außenansicht mit Fassade, Fenstern, Eingang; Wohnung markiert | Lage im Haus | P3 | – | drehbare Außenansicht | Ready |
| 40 | Auswahlprobleme in 3D (Hinweis aus #31) | Klären, welche Möbel sich in 3D nicht auswählen lassen (Rückfrage in #31), dann beheben | zuverlässige Auswahl | P1 | deine Antwort in #31 | betroffene Möbel lassen sich in 3D auswählen | Blocked |
| 41 | Möbelix live | nur über eingefügten Seitenquelltext; kein Umgehen des Bot-Schutzes | – | P2 | Cloudflare-Bot-Schutz | – | Blocked |
| 42 | Möbelix-Küchenplanung übernehmen (#38) | Format unbekannt, Möbelix hinter Bot-Schutz | Küche aus Möbelix | P3 | Export-Datei oder gespeicherte Planung von dir (siehe #38) | Format dokumentiert, Import oder begründete Ablehnung | Blocked |
| 43 | Smart Home P5/P6: Live-Anbindung (#24, Teil 3) | Home Assistant lesend/steuernd | echte Geräte | P3 | Entscheidungen #28 teils vorläufig; **nicht freigegeben** | [ROADMAP](smart-home/ROADMAP.md) | Blocked |
| 44 | Geplante Routine (automatische Fortsetzung) (#30) | tägliche Läufe mit je einer Aufgabe | Fortschritt ohne manuelles Starten | P2 | deine Aufgabe #30 (Routine mit Repository anlegen) | [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md) | Blocked |
| 45 | Vorher-nachher-Vergleich (#76) | zwei Stände nebeneinander mit gleichem Blickwinkel | Umstellungen vergleichen | P3 | wartet auf Projektversionen (#66) | Vergleich zeigbar, Unterschiede markiert | Blocked |
| 46 | Mehrfachauswahl, Kopieren/Einfügen | Umschalt+Klick, Auswahlrahmen (Umschalt+Ziehen), gemeinsam verschieben, Pfeiltasten, Strg+C/V/A, Entf, je ein Undo-Schritt | schnelleres Einrichten | P2 | – | 🧪 User-Test offen #94 | Done |
| 47 | Undo/Redo für alle Änderungen (#49) | existierte bereits (Strg+Z/Y, ↶/↷, ein Schritt je Ziehen) | – | – | – | ℹ️ im Issue erklärt, du schließt | Done |
| 48 | Kollision beim Begehen (#53) | existierte bereits (Wände + feste Möbel, 22 cm Radius, Gleiten); Rückfrage: Lampen/Pflanzen fest? | – | – | – | ℹ️ Rückfrage in #53 | Done |
| 49 | Budget-Übersicht (#56) | existierte bereits (Reiter „Budget“, „ohne Preis“ statt 0 €) | – | – | – | ℹ️ im Issue erklärt, du schließt | Done |
| 50 | Ducken beim Begehen (#20) | C halten: Kamera weich auf ~60 % (min. 80 cm), langsamer, Anzeige „Geduckt“ | Blick unter Tische/Regale | P3 | – | 🧪 User-Test offen #47 | Done |
| 51 | Positionsmarker im 2D-Plan beim Begehen (#19) | Punkt + Blickkegel live im 2D-Plan, nur in 2D + 3D beim Begehen | Orientierung | P2 | – | 🧪 User-Test offen #46 | Done |
| 52 | Zoom-Regler (#6) | −/+/Schieber/Einpassen unten in 2D und 3D, synchron mit Mausrad; beim Begehen ausgeblendet | Bedienung ohne Mausrad | P2 | – | 🧪 User-Test offen #43 | Done |
| 53 | First-Person: Möbel auswählen und tragen (#39) | Klick aufs Fadenkreuz wählt aus, G trägt/setzt ab (folgt dem Blick, Kollisionsregeln wie beim Ziehen, ein Undo-Schritt); Teppiche stoppen an Wänden | Einrichten aus der Ich-Perspektive | P1 | – | 🧪 User-Test offen #42 | Done |
| 54 | Möbel-Hoverinformationen (#9) | Karte mit Name, Kategorie, Maße, Preis, Händler, Bild nach kurzer Verzögerung; nicht beim Ziehen, nicht bei Touch | schneller Überblick | P2 | – | 🧪 User-Test offen #41 | Done |
| 55 | Prioritäten und Issue-Pflege (#13, #34, #35, #36, #40, deine Zeile „High Prio Issues abarbeiten“) | Reihenfolge fehlgeschlagene Tests → `priority: high` → Kommentare → Ideen; Issue-Check je Aufgabe; Label `info`; IDEAS.md per PR nach `main`; keine Zusatzkosten | Verlässlichkeit | P1 | – | ⚙️ Regeln in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) | Done |
| 56 | Augenhöhe beim Begehen (Standard 163 cm) + Fadenkreuz (#23, #22) | Einstellung Projekt › Steuerung (3D), wirkt sofort, gespeichert; Fadenkreuz nur beim Begehen | realistische Blickhöhe, Orientierung | P2 | – | 🧪 User-Test offen #33 | Done |
| 57 | Drehen & Objektinteraktion (#5) | ±15°/±90° im Eigenschaften-Panel, Q/E, Feld „Drehung“; Kollisionsprüfung: aus Wand/Möbeln in freien Raum schieben, sonst Konflikt markieren | häufigster Bedienschritt | P2 | – | 🧪 User-Test offen #31 | Done |
| 58 | Nachtbeleuchtung (#7) | Dunkelwerden bis ~22:30, Lampenschalter automatisch/an/aus | glaubwürdige Abend-/Nachtwirkung | P1 | – | 🧪 User-Test offen #25 | Done |
| 59 | Möbelix: falscher Produkttyp (#8) | Typ aus Name/Seitenkategorie mit Sicherheitsstufe; Hauptprodukt statt Empfehlung | keine falschen Möbel | P1 | – | 🧪 User-Test offen #26 | Done |
| 60 | Einheitliches Kollisionssystem (#4) | Möbel blockieren sich; erlaubt: Teppich, Stuhl unter Tisch, Küche; Tischlampe auf Tisch; Platz vor Fronten | – | P1 | – | 🧪 User-Test offen #16 | Done |
| 61 | Backlog als Tabelle, Aufgaben als Issues (#15) | diese Tabelle; `user-task`-Issues #27–#29; Housekeeping (unten) | Übersicht | P1 | – | ⚙️ Dokumentation | Done |
| 62 | Modellwahl je Aufgabe (#18) | Regel in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) › „Modellwahl“ | Kontingent schonen | P1 | – | ⚙️ Dokumentation | Done |
| 63 | Issue-Workflow, Ideen-Erfassung, Vorlagen | Labels, `[IDEE]`/`[USERTEST]`-Vorlagen, Ablauf | – | – | – | ⚙️ Dokumentation (PR #17) | Done |
| 64 | Projekt speichern / erneut öffnen | – | – | – | – | 🧪 User-Test offen #11 | Done |
| 65 | IKEA: Artikelliste → Produktliste, PAX-Planung → Raum + Korpusse (PR #3) | – | – | – | – | 🧪 User-Test offen #12 | Done |
| 66 | 3D-Kollisionsanzeige (PR #2) | – | – | – | – | ❌ weitere Prüfung nötig → ersetzt durch #4 | Done |
| 67 | Tageszeit-Regler, Bedienung (PR #2) | – | – | – | – | ⚙️ Bedienung ok laut dir; Nachtwirkung → #7 | Done |
| 68 | Mausempfindlichkeit (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 69 | Klick vs. Ziehen, Auswahl in 2D/3D (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 70 | Wandfang, Platzierung nahe Ecken (PR #2) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 71 | 2D/3D-Synchronisierung | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 72 | GLB-Modelle manuell herunterladen und importieren (PR #3) | – | – | – | – | ✅ von dir bestätigt (2026-10-16) | Done |
| 73 | Smart-Home-Konzept (Dokumentation) | [`smart-home/`](smart-home/README.md) | – | – | – | ⚙️ Dokumentation; offene Fragen → #28 | Done |
| 74 | Türaufschlag prüfen (#70) | existiert: Viertelkreis im Plan, Möbel im Schwenkbereich als Warnung in 2D/3D | – | – | – | ℹ️ existiert bereits, im Issue erklärt | Done |
| 75 | Lichtfarbe für Lampen (#77) | existiert je Leuchte (Regler Lichtfarbe in Kelvin); je Raum nicht | – | – | – | ℹ️ existiert bereits (je Leuchte), Rückfrage im Issue | Done |
| 1 | IKEA-Import pflegen (#10) – paralleler Agent, Branch `claude/ikea-import-10` | GLB-Dateiweg bewahren; PAX-Planung: Stückliste über `scripts/ikea-products.mjs` anreichern (Namen, Preise, Modelle); Anleitung „Planung als JSON speichern“ mit Screenshots | vollständige Budgets aus IKEA-Planungen | P2 | Hilfsskript vorhanden | PR #45 gemergt | Done |
| 2 | IKEA-Küchenplanung untersuchen (#27) – Recherche-Agent, Branch `claude/ikea-kitchen-27` | Netz ist freigegeben (#27, getestet: Host erreichbar). Planungen sind an IKEA-Konten gebunden → ohne Login vermutlich nur über eine von dir gespeicherte Planung (Option B) | Küche aus IKEA übernehmen | P2 | ggf. Beispiel-JSON von dir | Untersuchung gemergt (PR #45), Beispiel-Planung von dir offen (#95) | Done |
| 3 | Türen und Fenster in 3D öffnen/schließen (#21) | Klick/Taste schaltet Flügel; geöffneter Flügel zählt in der Kollisionsprüfung | Platzwirkung geöffneter Flügel | P3 | Kollisionssystem #4 | 🧪 User-Test #107 (PR folgt nach #48) | Done |
| 6 | Raster/Wandkante beim Ziehen (#52) | Raster- und Wandfang gibt es; prüfen, was im Issue fehlt (z. B. sichtbares Einrasten, Abstand zur Wandkante einstellbar) | präzises Platzieren | P2 | – | 🧪 User-Test #105: Auswahl Raster 5/10 cm, nur Wände, frei | Done |
| 10 | CSV-Stückliste: Maße + gleiche Möbel zusammenfassen (#57) | Export existiert (UTF-8+BOM, `;`); ergänzen: Spalte Maße, gleiche Möbel = eine Zeile mit Menge | Einkauf/Abgleich | P3 | – | 🧪 User-Test #106 | Done |

## Housekeeping 2026-10-16 (4)
- Ideen #63–#93 übernommen (vorbereitet vom Hilfsagenten, von der Hauptsession geprüft). Zusammengelegt: #58→#66, #72→#71, #67+#68, #64+#81, #69+#93, #83+#84+#91. #70/#77 existierten bereits (Label `info`).

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
