# Ideen-Backlog (Arbeitsplan der Hauptsession)

Kuratierter Arbeitsplan. **Neue Ideen bitte als GitHub-Issue mit Label `idea-inbox` erfassen** (Anleitung: [`IDEA_CAPTURE.md`](IDEA_CAPTURE.md)); die Hauptsession übernimmt sie hierher. Nur die Hauptsession bearbeitet diese Datei.
Workflow und Labels: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md) · Stand der Umsetzung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) · Smart Home: [`smart-home/ROADMAP.md`](smart-home/ROADMAP.md).

## Ablauf
1. **Erfassen** → GitHub-Issue `idea-inbox` (oder kurz hier unter `Inbox`).
1. **Bewerten** → Nutzen, Aufwand, Abhängigkeiten, Abnahme; Priorität `P1` (hoch) … `P3` (niedrig); Issue-Label `planned`.
2. **Bereit** → `Ready`, wenn klar und nicht blockiert; sonst `Blocked` mit Grund.
3. **Umsetzen** → `In Progress` (höchstens 1–2), Issue-Label `in-progress`, kleine Commits, Tests.
4. **Abschließen** → `Done` mit Commit/PR. Manuelle Abnahme über ein `[USERTEST]`-Issue.

**Abnahme-Vermerk in `Done`:** ✅ *von dir bestätigt* (Datum/Quelle) · 🧪 *User-Test offen* (#Issue) · ❌ *Test fehlgeschlagen, Nachbesserung* (#Issue) · ⚙️ *nur automatisiert getestet* (keine manuelle Abnahme nötig oder noch nicht angefragt). „Done“ allein heißt **nicht** „von dir bestätigt“.

**Regel für künftige Sitzungen:** Ohne konkreten Auftrag: Rückmeldungen in `user-test`-Issues und neue `idea-inbox`-Issues verarbeiten, dann die höchste unblockierte `Ready`-Aufgabe umsetzen, testen, integrieren, diese Datei und den Projektstatus aktualisieren. Ein konkreter Auftrag hat immer Vorrang.

Format: **Titel** (#Issue) – Beschreibung · *Nutzen* · Priorität · Abhängigkeiten · Abnahme.

## Inbox
- **Anleitung „IKEA-Planung als JSON speichern“ mit Screenshots** – für Laien; evtl. Lesezeichen-Helfer prüfen (nur eigene Daten, kein IKEA-Schlüssel in der App). → wird mit #10 bewertet.
- **Möbelix-Seiten mit echten Quelltexten testen** – sobald du eine Seite einfügst (siehe #8).
- **Mehrfachauswahl und Kopieren/Einfügen von Möbeln** (früherer Vorschlag).
- **Schräge Wände in der Plan-Erkennung**, Bemaßungstexte aus PDFs zur Maßstabsprüfung.

## Ready
1. **Nachtbeleuchtung** (#7) – nach ~21 Uhr kaum dunkler; Ursache (Sonne, Umgebung, Belichtung, Tone Mapping, Automatik-Raumlichter) beheben. · *dein Feedback* · **P1** · – · Abnahme: Tag/Abend/Nacht messbar verschieden, Lampen an/aus unterscheidbar; `[USERTEST]`.
2. **Möbelix: falscher Produkttyp** (#8) – Regal statt Sessel; Kategorie aus Seitendaten/Name statt fester Vorgabe, unsichere Fälle markieren. · *dein Feedback* · **P1** · – · Abnahme: siehe Issue.
3. **Drehen & Objektinteraktion** (#5) – Drehen im Eigenschaften-Panel + Tastatur, 2D/3D gleich, Kollision beim Drehen. · P2 · #4 · Abnahme: siehe Issue.
4. **Möbel-Hoverinformationen** (#9) – Name, Kategorie, Preis, Maße, Händler, Bild beim Überfahren. · P2 · – · Abnahme: siehe Issue.
5. **Zoom-Regler** (#6) – am unteren Viewport-Rand, synchron mit Mausrad. · P2 · – · Abnahme: siehe Issue.
6. **IKEA-Import pflegen** (#10) – GLB-Dateiweg bewahren; PAX-Planung: Stückliste über `scripts/ikea-products.mjs` anreichern (Namen, Preise, Modelle). · P2 · Hilfsskript vorhanden · Abnahme: importierte PAX-Planung zeigt Preise im Budget, Korpusse mit Namen.
7. **Smart Home P2: simulierte Geräte im Plan** – Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D. · P2 · – · Abnahme: [ROADMAP P2](smart-home/ROADMAP.md). Live-Anbindung ist **nicht** freigegeben.
8. **Allgemeiner Quelltext-Import überarbeiten** (Arbeitsauftrag 8, zurückgestellt) – Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops. · P3 · – · Abnahme: definierte Testseiten liefern korrekte Werte oder klare Fehlermeldung.

## In Progress
_(leer)_

## Blocked
- **Möbelix-Integration (Live)** – Cloudflare-Bot-Schutz; nur über von dir eingefügte Seitenquelltexte oder offizielle Schnittstelle. · P2
- **IKEA-Küchenplanung importieren** – Backend aus der Umgebung gesperrt (`api.kitchen.planner.ikea.com`); Format unbekannt. · P2
- **Smart Home P5/P6 (Live-Anbindung)** – braucht Home-Assistant-Instanz und deine Entscheidungen in [DECISIONS.md](smart-home/DECISIONS.md). · P3
- **Gamepad-Steuerung** – wartet auf deine Freigabe ([CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md)). · P3

## Done
- Mausempfindlichkeit – PR #2 · ✅ von dir bestätigt (Rückmeldung 2026-10-16)
- Klick vs. Ziehen, Auswahl in 2D/3D – PR #2 · ✅ von dir bestätigt (2026-10-16)
- Wandfang, Platzierung nahe Ecken – PR #2 · ✅ von dir bestätigt (2026-10-16)
- 2D/3D-Synchronisierung · ✅ von dir bestätigt (2026-10-16)
- GLB-Modelle manuell herunterladen und importieren – PR #3 · ✅ von dir bestätigt (2026-10-16)
- 3D-Kollisionsanzeige – PR #2 · ❌ weitere Prüfung nötig → #4
- Einheitliches Kollisionssystem (#4) – Möbel blockieren sich, erlaubte Kombinationen (Teppich, Stuhl unter Tisch, Küche), Tischlampe auf Tisch, Platz vor Fronten · 🧪 User-Test offen #16
- Tageszeit-Regler (Bedienung) – PR #2 · ⚙️ Bedienung ok laut dir; Nachtwirkung → #7
- Projekt speichern / erneut öffnen · 🧪 User-Test offen #11
- IKEA: Artikelliste → Produktliste mit Modellen, PAX-Planung → Raum + Korpusse – PR #3 · 🧪 User-Test offen #12
- Smart-Home-Konzept (Dokumentation) – [`smart-home/`](smart-home/README.md) · ⚙️ Dokumentation, offene Fragen in DECISIONS.md
