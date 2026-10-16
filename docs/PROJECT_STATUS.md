# Projektstatus – Wohnungsplaner 3D

_Zuletzt aktualisiert: 2026-10-16 · Branch `claude/quirky-faraday-0d9uep` · Workflow: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md)_

## Aktuell
- **Phase:** 8 (Stabilisierung) + Arbeitsauftrag „Workflow, autonome Entwicklung und bestehender Arbeitsauftrag“ (Runde 6)
- **Workflow neu:** Ideen als GitHub-Issues (`idea-inbox`), kuratierter Plan in [`IDEAS.md`](IDEAS.md), Abnahme über `[USERTEST]`-Issues – Ablauf in [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md)
- **Erledigt in Runde 6:** Kollisionssystem (#4 → User-Test #16), Nachtbeleuchtung (#7 → #25), Möbelix-Produkttyp (#8 → #26), Drehen mit Kollisionsprüfung (#5 → #31), Augenhöhe 163 cm + Fadenkreuz (#23/#22 → #33), Hover-Info (#9 → #41), Möbel im Begehen auswählen/tragen + Teppich stoppt an Wänden (#39 → #42), Zoom-Regler (#6 → #43), Positionsmarker beim Begehen (#19 → #46), Ducken (#20 → #47), Mehrfachauswahl/Kopieren (→ #94), Speicherfehler-Banner (#60), Möbel-Einrasten wählbar (#52 → #105), CSV mit Maßen/Mengen (#57 → #106), Türen/Fenster öffnen (#21 → #107), Plan als PNG/PDF + Druckansicht (#71/#72 → #112, PR #111), Grundriss-Import schräge Wände/Räume/Maßtexte (#37 → #114), Projektversionen (#66/#58 → #115), Einkaufsliste nach Räumen + „Problem melden“ (#75/#62 → #116), Engstellen (#68 → #118), Laufwege (#67 → #120), Tastenkürzel-Übersicht (#59), UI-Grundlage (#96–#98) + Ausrichten/Verteilen (#51 → #122), Dunkelmodus + Maßlinien + Kamera-Lesezeichen (#73/#50/#55 → #123), Eigenschaften-Panel in Gruppen + Vorher-nachher-Vergleich in 3D (#99/#76 → #126), Küchen-Arbeitsdreieck + GLB-Export + Sitzen beim Begehen + Startkarte (#82/#87/#78/#102 → #127), Touch-Bedienung (#74) von dir verworfen, Prioritäten-/Issue-Regeln (#13, #34–#36, #40), Backlog als Tabelle + Aufgaben-Issues (#15), Modellwahl-Regel (#18)
- **Deine Aufgaben:** #28 Smart-Home-Rückfragen (Erklärungen in `smart-home/DECISIONS.md`) · #30 Routine einrichten (Label `user-task`); #27 und #29 von dir erledigt
- **In Arbeit:** Korrektur-Paket aus fehlgeschlagenen User-Tests (#47, #107, #94, #16, #133) – Opus-Agent; Grundriss-Import mit deinem Plan (#114) als Nächstes. Sammel-PR mit #100/#103, #65, #89, #88, #125, #104, #129 (User-Tests #139, #140). Bestätigt: #120, #105, #46, #43, #41, #33, #31, #25.
- **Dashboard (#113):** https://claude.ai/artifact/Smc3PMAsNzSgMnFG2WHqK2 – breite Übersicht mit Nutzung (5 h/Woche + Hochrechnung), Sitzungen, Agents, Tests, Backlog-Hochrechnung; Nutzung und Sitzungen schreibt ein Cloud-Updater (Haiku-Session, ca. alle 2 min, Ruhemodus ohne aktive Sitzungen, Wegwerf-Helfer pro Lauf hält den Verlauf klein); stündliche Routinen-Sessions haben die nötigen Werkzeuge nicht
- **Nächster Schritt:** Korrektur-Paket integrieren, #114 mit deinem Plan, dann #134 (Smart-Home-Konzept) und die obersten `Ready`-Zeilen; Limit-Steuerung: ~90 % des 5-h-Fensters, keine neuen Agents über dem erlaubten Tempo

## Legende
`DONE` fertig mit Beleg · `PARTIAL` teilweise · `IN PROGRESS` in Arbeit · `PLANNED` geplant · `BLOCKED` blockiert · `NEEDS USER TEST` braucht deinen Praxistest

Prüfstufen: **Impl.** Code vorhanden · **Auto** automatischer Test/Build grün · **Manuell** von Claude in der laufenden App (Headless-Chromium, Software-Rendering) angesehen · **Nutzer** von dir bestätigt

## Runde 6 (Workflow + Arbeitsauftrag A–I)

Status je Aufgabe: implementiert · automatisiert getestet · User-Test offen (#) · vom Nutzer bestätigt · fehlgeschlagen · blockiert.

| Aufgabe | Implementiert | Automatisiert getestet | Abnahme |
|---|---|---|---|
| Issue-Workflow, Labels, Vorlagen, Ideen-Erfassung | ✅ `DEVELOPMENT_WORKFLOW.md`, `IDEA_CAPTURE.md`, `.github/ISSUE_TEMPLATE/` | – | – |
| Backlog als Tabelle, `user-task`-Issues #27–#29, Modellwahl-Regel (#15, #18) | ✅ `IDEAS.md`, `DEVELOPMENT_WORKFLOW.md` | – | – |
| A Kollisionssystem (#4): eine Regel für 2D/3D/Ziehen/Platzieren; Möbel-Überschneidung = Fehler (rot) und blockiert das Ziehen; erlaubt: Teppich/Vorhang, Stuhl unter Tisch/Schreibtisch, Kücheneinbauten; Tischlampe/Deko stellt sich beim Ziehen auf Tisch/Kommode; Warnung (orange) bei zu wenig Platz vor Schrank-/Schubladenfronten. Regeln: `src/model/placementRules.ts` | ✅ | ✅ Unit (Lampe im Sofa, Stuhl/Tisch/Teppich/Tischlampe ohne Konflikt, Stapeln, Ziehen stoppt am Sofa, Frontabstand, Küchenzeile) + E2E (3D-Marker Lampe/Sofa, 2D-Ziehen stoppt) | 🧪 User-Test offen #16 (nicht visuell von mir bewertet) |
| D Nachtbeleuchtung (#7): **Ursache** – Licht ab ~20:45 auf Nachtwerte gesättigt (21:00 = 23:30), Belichtung nachts ×1,5, hohe Mindestwerte für Umgebungs-/Himmelslicht, Automatik-Raumlichter immer an. **Jetzt** Dunkelwerden bis ~22:30, Mondlicht-Niveau, Belichtung nur ×1,12; Schalter „Lampen: automatisch/an/aus“ für Steh-/Tischlampen, platzierte Leuchten und Raumlicht; Raumlicht-Reichweite an Raumgröße | ✅ | ✅ Unit (Lichtwerte 19:30–22:00 fallend, Lampenstufen, Schema-Default) + E2E mit gemessener Bildhelligkeit (vorher 13:00/21:00/23:30 = 206/109/109, nachher 206/34/18, Lampen aus 10) | 🧪 #25 · Bilder von mir angesehen (Cloud-Browser, Software-Rendering) |
| F Möbelix-Produkttyp (#8): **Ursache** – Dialog übernahm die Kategorie nie aus der Seite (fest „Schränke & Regale“ → Form Regal); bei mehreren Produkten wurde das erste genommen. **Jetzt** Typ aus Name + schema.org-Kategorie + Breadcrumb (`src/catalog/providers/classify.ts`), Anzeige sicher/unsicher/nicht erkannt, ohne Erkennung muss gewählt werden; Sessel → Sessel-Form; Hauptprodukt über Seitenadresse/Überschrift | ✅ | ✅ Unit (18 Typen, Widerspruch, Breadcrumb, Empfehlung vor Hauptprodukt) + E2E (Sessel über Breadcrumb, unbekannter Typ sperrt „Hinzufügen“) – nur synthetische Seiten | 🧪 #26 (braucht echten Möbelix-Quelltext von dir) |
| B Drehen (#5): ±15°/±90° im Eigenschaften-Panel, Feld „Drehung“, Q/E – alle über `rotateFurnitureTo` (gleiche Regeln wie Ziehen): ragt das Möbel nach dem Drehen in Wand/Türblatt/Möbel, wird es in freien Raum geschoben (nie in einen anderen Raum), sonst gedreht + Konflikt markiert; Hinweis unten; ein Undo-Schritt | ✅ | ✅ Unit (Schrank an Wand, freie Drehung, gegen Sofa, enger Gang → Konflikt, gesperrt) + E2E (2D: Panel-Knopf, Undo, Q/E) | 🧪 #31 · Panel-Screenshot angesehen |
| Augenhöhe + Fadenkreuz (#23, #22): Einstellung „Augenhöhe beim Begehen“ (Projekt › Steuerung (3D), 100–220 cm, Standard 163 cm, vorher fest 165 cm), wirkt sofort ohne Neustart des Begehens, wird gespeichert; Fadenkreuz in der Bildmitte nur beim Begehen | ✅ | ✅ Unit (Schema-Default) + E2E (163 cm, Änderung live auf 180 cm, nach Neuladen erhalten, Fadenkreuz nur beim Begehen) | 🧪 #33 · Screenshot angesehen |
| G Hover-Info (#9): Karte nach ~0,45 s mit Name, Kategorie, Maße, Preis (Mengen/Schätzung), Marke/Händler, Produktbild (nur https, ohne Referrer); verschwindet bei gedrückter Maustaste, nicht bei Touch; 2D und 3D | ✅ | ✅ E2E (2D: Inhalt, Ziehen blendet aus, leere Fläche) | 🧪 #41 |
| Teppich stoppt an Wänden (#39, Teil): Teppiche liegen weiter unter Möbeln, werden beim Ziehen aber wie andere Möbel an Wänden gestoppt | ✅ | ✅ Unit | Teil von #39 |
| First-Person: Möbel auswählen/tragen (#39): Klick aufs Fadenkreuz wählt aus, G trägt (folgt dem Blick 1,1–4 m, Kollision wie beim Ziehen), Klick/G setzt ab (ein Undo-Schritt), Verlassen setzt ab; G schaltet beim Begehen kein 2D-Werkzeug | ✅ | ✅ E2E (anvisieren, tragen, absetzen, Undo-Schritt, Werkzeug unverändert) | 🧪 #42 · Screenshot angesehen |
| C Zoom-Regler (#6): unten in 2D und 3D (−/+/logarithmischer Schieber/Einpassen), synchron mit Mausrad/Touchpad, beim Begehen ausgeblendet | ✅ | ✅ E2E (Knöpfe, Mausrad-Sync 2D/3D, ausgeblendet beim Begehen) | 🧪 #43 · Screenshot angesehen |
| Positionsmarker (#19): Punkt + Blickkegel der Begehen-Kamera live im 2D-Plan, nur in 2D + 3D; eigener Mini-Store, kein Neuzeichnen des Plans | ✅ | ✅ E2E (Position = Kamera, folgt beim Gehen, nur in 2D+3D) | 🧪 #46 |
| Ducken (#20): C halten senkt die Kamera weich auf ~60 % der Augenhöhe (min. 80 cm), halbe Gehgeschwindigkeit, Anzeige „Geduckt“; C ohne Wirkung auf 2D-Werkzeuge beim Begehen | ✅ | ✅ E2E | 🧪 #47 |
| Mehrfachauswahl: Umschalt+Klick, Auswahlrahmen (Umschalt+Ziehen auf Boden), Gruppe gemeinsam ziehen (starr, jedes Möbel stoppt an Hindernissen), Pfeiltasten, Strg+C/V/A, Entf, Duplizieren – je ein Undo-Schritt; Hinweis im Panel; Hervorhebung 2D/3D | ✅ | ✅ E2E (Umschalt+Klick, Gruppe ziehen + 1 Undo-Schritt, Kopieren/Einfügen, Löschen/Undo, Rahmen) | 🧪 #94 |
| Speicherfehler (#60): deutliches Banner unter der Werkzeugleiste mit Ursache (Speicher voll / Speichern blockiert), „Jetzt als Datei exportieren“ und „Erneut speichern“; verschwindet nach Erfolg | ✅ | ✅ E2E (Fehler simuliert → Banner, Wiederholen → weg, „Gespeichert“) | 🧪 (Test-Issue folgt mit Merge) |
| Nachtlicht-Test robust gemacht: misst nur den Bildbereich der Wohnung (vorher Mittel über das ganze, überwiegend schwarze Bild → im CI zu knapp); Lampen/Raumlicht verstärkt | ✅ | ✅ lokal an 32,2 / aus 12,0 | – |
| Möbel-Einrasten wählbar (#52): Raster 5 cm / 10 cm / nur Wände / frei (Werkzeug-Panel), gilt in 2D und 3D, Alt = frei in 2D, Kollision immer aktiv | ✅ | ✅ Unit + vorhandene Zieh-E2E; 3D-Zieh-Test toleriert einen Rasterschritt | 🧪 #105 |
| CSV-Einkaufsliste (#57): Spalte „Maße B × T × H (cm)“, gleiche Möbel als eine Zeile mit Menge | ✅ | ✅ Unit + E2E | 🧪 #106 |
| Türen/Fenster öffnen (#21, Agent): Doppelklick/O/Klick beim Begehen, Zustand gespeichert, nur geöffnete Flügel sind Hindernis, geschlossene Tür sperrt das Begehen | ✅ | ✅ Unit (11) + E2E | 🧪 #107 · Screenshots vom Agenten |
| Plan als PNG/PDF + Druckansicht (#71/#72, lokale Sitzung): Plan mit Maßen, Titel, Datum, Maßstabsbalken; Druck A4 hoch/quer auf 1 Seite mit Stückliste, PDF über Druckdialog | ✅ | ✅ Unit + E2E | 🧪 #112 · PDFs (je 1 Seite, 1:75) und PNG von mir angesehen |

## Diese Runde (Arbeitsauftrag 1–8)

| # | Aufgabe | Status | Was sich geändert hat / was nachweislich funktioniert | Auto | Manuell (visuell) |
|---|---|---|---|---|---|
| 1 | Git/GitHub-Workflow | DONE | `docs/DEVELOPMENT_WORKFLOW.md`, CI `.github/workflows/ci.yml` (Lint, tsc, Unit, Build, E2E). PR #1 nach grüner CI mit Merge-Commit in `main` integriert (`5797457`) | ✅ CI grün (checks + e2e) | – |
| 2 | Kollisionen im 3D-Raum | NEEDS USER TEST | Betroffenes Objekt rot (Wand/Türblatt) bzw. orange (Türaufschlag/außerhalb) umrandet + getönt, Überschneidungsvolumen als roter Block, verantwortliches Türblatt/Aufschlag markiert; Meldung nennt die Tür („Tür 90 cm (Wohnzimmer)“). Nur bei Möbel-/Grundrissänderung berechnet, kein Raycasting auf Markern | ✅ Unit (Schnittpolygon, Regionen, keine Fehlalarme bei bündiger Wand/Ecke, Beispielwohnung ohne Konflikte) + E2E (Sofa im Türblatt → Marker → Wegziehen → Marker weg → Undo → wieder da) | ✅ Screenshots Planung + Realismus |
| 3 | Mausempfindlichkeit | NEEDS USER TEST | Projekt › Steuerung (3D): 0,20–3,00×, Standard 1,00× = bisheriges Gefühl; wirkt auf Begehen-Umsehen und Orbit-Drehung, sofort, ohne Listener-Neuaufbau; Regler = 1 Undo-Schritt; alte Projekte laden mit 1 | ✅ Unit (Schema-Migration) + E2E (0,5×/1×/2× proportional, Orbit skaliert, Speichern) | – (Gefühl nur von dir prüfbar) |
| 4 | Klick vs. Ziehen | NEEDS USER TEST | **Ursache gefunden:** 3D-Ziehen startete nie (R3F liefert `e.delta` nur bei Klicks). Jetzt eigener 5-px-Schwellwert, Greifversatz bleibt, kein Sprung; pointercancel/lostpointercapture setzt zurück, Fokusverlust beendet den Drag (2D+3D); Schnittansicht: weggeschnittene Wandteile fangen keine Klicks mehr | ✅ E2E (Zittern < Schwelle wählt nur aus, Ziehen folgt Zeiger, Loslassen über Wand behält Auswahl, Fokusverlust, Druck auf UI-Knopf startet keinen Drag) | ✅ im Testlauf |
| 5 | Wandfang & Wanddurchdringung | NEEDS USER TEST | Ursachen: Fang an Türöffnungen/Durchgängen („virtuelle“ Wandfläche), Flackern an der Fangschwelle, falscher Ausschubvektor wenn ein Hindernis das Objekt durchsetzt (SAT-Enthaltensein), Springen bei schon kollidierenden Objekten, Tunnelgefahr bei sehr dünnen Wänden. Alle behoben; Sockelleisten unverändert | ✅ Unit (dünne 2-cm-Wand, Öffnung, Hysterese, Herausziehen ohne Sprung) + Performance (Drag-Update 25 Räume ≈ 16 ms inkl. Konfliktprüfung) | – |
| 6 | Tageszeit-Regler träge | NEEDS USER TEST | Ursachen: Licht folgte mit fester Rate (10 h/s → 1,2 s für 12 h) und jeder Reglerschritt klonte das Projekt + renderte die App neu. Jetzt Vorschaukanal ohne React-Render, bildratenunabhängige Glättung (50 ms), 1 Undo-Schritt beim Loslassen. Gemessen: 5,9 ms (max. 18 ms) → 0,2 ms pro Schritt; Licht nach 1–2 Frames aktuell | ✅ Unit + E2E (Projekt bleibt während Ziehen unverändert, Licht holt auf, 1 Undo-Schritt) | ⚠️ Software-Rendering ~0,3 FPS – Flüssigkeit nur auf echter GPU beurteilbar |
| 7 | IKEA/Möbelix-Import | PARTIAL | Echte IKEA-AT-Produktseiten liefern schema.org `Product` + `3DModel`; Parser liest jetzt das deklarierte 3D-Modell; echter E2E-Lauf (KALLAX) bis zur Platzierung. Planer: DEXF-Dienst mit App-Schlüssel/Konto → kompletter Planimport nicht legitim möglich. Möbelix: Cloudflare-Challenge → `BLOCKED`. Details: [`PLANNER_IMPORT_RESEARCH.md`](PLANNER_IMPORT_RESEARCH.md) | ✅ Unit mit Auszug echter Seitenstruktur | ✅ echter Lauf mit Screenshot (GLB-Abruf hier gesperrt) |
| 8 | Allgemeiner Quelltext-Import | PLANNED (zurückgestellt) | Nicht umgebaut, nicht verschlechtert – bekannte Grenzen siehe unten | bestehende Tests grün | – |

## Runde 5 (IKEA/Möbelix + Smart Home)

| Aufgabe | Status | Was nachweislich funktioniert | Auto | Manuell (visuell) |
|---|---|---|---|---|
| IKEA-Domains erneut getestet | DONE | `web-api.ikea.com`, `api.dexf.ikea.com` jetzt erreichbar; Suche/Verfügbarkeit/Küchen-Backend/Planer-Modelle weiter von der Umgebung gesperrt – Tabelle in [`PLANNER_IMPORT_RESEARCH.md`](PLANNER_IMPORT_RESEARCH.md) | – | – |
| IKEA-Produkt + echtes GLB | NEEDS USER TEST | GLB-Varianten aus schema.org `3DModel`, Auswahl iqp2 → …; echte KALLAX/ENHET-Modelle geladen, Maße passen; Direktabruf aus der App von IKEA gesperrt (403 bei fremder Herkunft) → Download-Weg | ✅ Unit | ✅ Screenshot 3D (lokal, echte Dateien) |
| Artikelliste → Produktliste | NEEDS USER TEST | `scripts/ikea-products.mjs` + Mehrdatei-Import (JSON + GLB); echter Lauf mit 3 Artikeln | ✅ Unit + E2E (synthetisch) | ✅ echter Lauf importiert/platziert |
| IKEA-PAX-Planung → Raum + Korpusse | NEEDS USER TEST | gespeicherte Planungs-JSON (ICF + Szene) → Raum 5×4 m + 5 Korpusse an korrekten Positionen/Rotationen | ✅ Unit + E2E (gekürzte eigene Testplanung) | ✅ Screenshot 3D |
| IKEA-Küchenplanung | BLOCKED | Backend aus der Umgebung gesperrt | – | – |
| Möbelix | BLOCKED | Cloudflare-Challenge, nicht umgangen | – | – |
| Smart-Home-Konzept | DONE (Dokumentation) | 9 Dokumente in [`smart-home/`](smart-home/README.md), Links geprüft | ✅ Linkprüfung | – |
| Ideen-Backlog | DONE | [`IDEAS.md`](IDEAS.md) + Regel in `CLAUDE.md` | – | – |

Mögliche Auswirkungen auf deine Testpunkte der Runde 4: keine geänderten Dateien in Kollision/Ziehen/Wandfang/Tageszeit/Maus; neu ist nur ein Import-Knopf (Import-Tab) und erweiterter Katalog-Import.

## Funktionen (Gesamtüberblick)

| Bereich | Status | Impl. | Auto | Manuell | Nutzer |
|---|---|---|---|---|---|
| Datenmodell, Einheiten, Schema v1, Validierung | DONE | ✅ | ✅ Unit | – | – |
| 2D-Editor (Wände, Räume, Öffnungen, Fang, Bemaßung, Undo) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| 3D-Ansicht (Orbit, Schnitt, Begehen) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ Screenshots | – |
| Realismus (AO, SMAA, Tonemapping, Himmel, Texturen, Tageszeit) | NEEDS USER TEST | ✅ | ✅ Build+E2E | ✅ Screenshots | – |
| Möbel: Auswahl, Ziehen, Kollision, Wandfang, Konfliktanzeige 2D/3D | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Sockelleisten, Fensterbänke, Zargen | NEEDS USER TEST | ✅ | ✅ Unit | ✅ | – |
| PDF/PNG/JPG-Underlay, Kalibrierung, Erkennung (Beta) | PARTIAL | ✅ | ✅ Unit+E2E (synthetisch) | – echte Pläne | – |
| `apartment-plan.json`, Projektpaket, Autosave | DONE | ✅ | ✅ Unit+E2E | ✅ | – |
| GLB/glTF-Import (Katalog + pro Objekt) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Produkt von Händlerseite (IKEA AT) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ echte Seite (lokal) | – |
| Händler-3D-Modell laden (IKEA: Datei-Weg, Hilfsskript) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ echte GLB lokal | – |
| Möbelix | BLOCKED (Bot-Schutz) | – | – | – | – |
| IKEA-PAX-Planung (JSON vom Nutzer) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| IKEA-Küchenplanung | BLOCKED (Umgebung) | – | – | – | – |
| Gamepad | PLANNED (wartet auf Freigabe) | Bewertung `CONTROLLER_ASSESSMENT.md` | – | – | – |
| Küchenplaner, Budget, CSV | NEEDS USER TEST / DONE | ✅ | ✅ | ✅ | – |

**Von dir bestätigt (Rückmeldung 2026-10-16):** Mausempfindlichkeit, Klick/Ziehen/Auswahl, Wandfang und Ecken, 2D/3D-Synchronisierung, manueller GLB-Download/-Import. **Nicht bestanden / Nachbesserung:** Kollisionen (#4 → nachgebessert, Test #16), Nachtwirkung der Tageszeit (#7 → nachgebessert, Test #25).

## Automatische Prüfungen (letzter Lauf, siehe Git-Abschnitt)
- `tsc -b`, `eslint`, `vite build`: ✅
- Vitest: ✅ 452/452 · Playwright lokal: ✅ 53/53 vollständiger Lauf (Stand mit #78; Lauf mit #102 siehe PR) (Headless-Chromium, SwiftShader); CI des PR prüft die ganze Suite

## Wartet auf deinen Test
Offene `[USERTEST]`-Issues (Label `user-test`; Antwort `BESTANDEN` oder `FEHLGESCHLAGEN: …`):
- #16 Kollisionen (Lampe/Sofa, Stuhl unter Tisch, Lampe auf Tisch, Platz vor Schranktüren)
- #25 Nachtbeleuchtung (Abend, Nacht, Lampen an/aus)
- #26 Möbelix: richtiger Produkttyp (mit echtem Seitenquelltext)
- #31 Möbel drehen (Knöpfe, Q/E, an der Wand)
- #33 Begehen: Augenhöhe und Fadenkreuz
- #41 Möbel-Hoverinfo
- #42 Begehen: Möbel tragen, Teppich an Wänden
- #43 Zoom-Regler
- #46 Positionsmarker beim Begehen
- #47 Ducken beim Begehen
- #94 Mehrfachauswahl
- Hinweis: #26 und #31 hast du vor dem Merge getestet – nach Merge von PR #32 bitte neu
- #11 Projekt speichern / erneut öffnen
- #12 IKEA: Artikelliste → Produktliste, PAX-Planung
- #105–#107, #112, #114–#116, #118, #120, #122, #123 (siehe Issues)
- #126 Eigenschaften-Panel in Gruppen, Vorher-nachher-Vergleich in 3D (nach Merge des Sammel-PR)
- #127 Küchen-Arbeitsdreieck, GLB-Export, Sitzen beim Begehen, Startkarte (nach Merge des Sammel-PR)

## Automatisierung (geplante Läufe)
- **Geprüft am 2026-10-16:** Eine Routine „Wohnungsplaner Tageslauf“ (täglich 05:50 Wien) wurde aus dieser Sitzung angelegt und einmal als **Prüflauf ohne Änderungen** gestartet. Ergebnis: Die neue Sitzung hatte **kein Repository und keinen GitHub-Zugang** (leeres Arbeitsverzeichnis, `git clone` ohne Zugangsdaten, keine GitHub-Werkzeuge). Aus einer laufenden Sitzung lässt sich die Routine nicht mit Repository anlegen.
- **Konsequenz:** Routine **deaktiviert** (sie hätte täglich Kontingent verbraucht, ohne etwas zu tun). Es ist **keine** automatische Fortsetzung aktiv.
- **So wird es aktiv (deine Aufgabe, einmalig):** unter https://claude.ai/code/routines eine Routine mit ausgewähltem Repository `mgritsch04/wohnungsplaner-3d` anlegen (oder die deaktivierte Routine dort bearbeiten, Repository hinzufügen, aktivieren) – Issue #30; Prompt, Zeitplan und Modell-Empfehlung: [`ROUTINE_PROMPT.md`](ROUTINE_PROMPT.md).
- **Grenzen:** frühestens stündlich; Läufe zählen gegen dein Kontingent; bei erschöpftem Kontingent wird ein Lauf abgelehnt und nicht nachgeholt (kein automatischer Neustart „nach dem Limit“ – der nächste planmäßige Lauf startet normal); keine Zusatzkosten, solange du keine „usage credits“ aktivierst. Ein Lauf merged nur den CI-grünen PR des Vorlaufs und öffnet selbst höchstens einen PR – nie direkt auf `main`.

## Blocker
- **IKEA-Küchenplaner, Suche, Verfügbarkeit, Planer-Modelle:** von der Netzwerkrichtlinie der Umgebung gesperrt (`api.kitchen.planner.ikea.com`, `sik.search.blue.cdtapps.com`, `api.salesitem.ingka.com`, `content.dexf.ikea.com`).
- **Möbelix:** Cloudflare-Bot-Challenge – wird respektiert; Weg über eingefügten Seitenquelltext.
- **IKEA-Dienste direkt aus der App:** nur mit IKEAs eigenem Anwendungsschlüssel → nicht genutzt; Planungs-JSON stellt der Nutzer selbst bereit.
- **Smart Home live:** keine Hardware/HA-Instanz; Entscheidungen offen.

## Bekannte Grenzen
- **Allgemeiner Website-/Quelltext-Import (zurückgestellt, Aufgabe 8):** zuverlässig nur bei Seiten mit schema.org-Daten (JSON-LD/Microdata/Meta). Bei per JavaScript nachgeladenen Shops enthält der Quelltext oft keine Produktdaten; reiner Seitentext liefert nur Maße (heuristisch, kann Zusatzmaße wie Sitzhöhe verwechseln); mehrere Produkte auf einer Seite → das erste wird genommen; die App ruft Seiten nie selbst ab (CORS). Wird nach den Händler-/Planer-Themen überarbeitet.
- Kollision nutzt die Außenmaße (Quader) der Möbel – auch bei importierten Modellen; Hohlräume (z. B. unter einem Bett) werden nicht berücksichtigt.
- Erkennung nur für achsparallele, gefüllte Wände.
- Lampen- und Raumlicht wirft keine Schatten; etwas Licht scheint durch Wände (z. B. auf den Boden vor der Wohnung).
- 3D-Leistung auf echter GPU nicht gemessen (Cloud: Software-Rendering).
- Speicherung browserlokal (Export als Projektpaket für andere Geräte).

## Als Nächstes (Vorschlag)
Siehe [`IDEAS.md`](IDEAS.md) → `Ready` (Reihenfolge dort).

## Git
- Branch `claude/quirky-faraday-0d9uep`; `main` = `4f7bc78` (zuletzt gemergt: PR #111, #117, #119, #121).
- Frühere Runden: PR #1 (`5797457`), PR #2 (`a9cc64f`), PR #3 (IKEA/Smart-Home-Doku).
