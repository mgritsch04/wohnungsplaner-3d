# Ideen-Backlog

Zentrale Sammelstelle für Verbesserungsideen. Neue Ideen einfach unter **Inbox** eintragen (eine Zeile reicht).
Stand der Umsetzung: [`PROJECT_STATUS.md`](PROJECT_STATUS.md) · Smart Home: [`smart-home/ROADMAP.md`](smart-home/ROADMAP.md).

## Ablauf
1. **Erfassen** → `Inbox` (Beschreibung reicht).
2. **Bewerten** → Nutzen, Aufwand, Abhängigkeiten, Abnahmekriterien ergänzen; Priorität `P1` (hoch) … `P3` (niedrig).
3. **Bereit** → nach `Ready`, sobald klar definiert und nicht blockiert; fehlt etwas → `Blocked` mit Grund.
4. **Umsetzen** → `In Progress` (höchstens 1–2 gleichzeitig), kleine Commits, Tests.
5. **Abschließen** → nach `Done` mit Commit/Datei; Status in `PROJECT_STATUS.md` nachziehen. Vom Nutzer bestätigt erst nach deinem Test.

**Regel für künftige Sitzungen:** Gibt es keinen konkreten Auftrag, wählt Claude aus `Ready` die höchste Priorität ohne Blocker, setzt sie um, testet, committet und aktualisiert dieses Dokument und den Projektstatus. Ein konkreter Auftrag des Nutzers hat immer Vorrang.

Format je Eintrag: **Titel** – Beschreibung · *Nutzen* · Priorität · Abhängigkeiten · Abnahme.

## Inbox
- **Anleitung „IKEA-Planung als JSON speichern“ mit Screenshots** – Schritt für Schritt (DevTools) für Laien; evtl. Lesezeichen-Helfer prüfen (nur eigene Daten, kein IKEA-Schlüssel in der App).
- **Möbelix-Seiten mit echten Quelltexten testen** – sobald du eine Seite einfügst.
- **Küchenplaner (IKEA METOD) untersuchen** – braucht Netzfreigabe `api.kitchen.planner.ikea.com`.
- **Mehrfachauswahl und Kopieren/Einfügen von Möbeln** (aus früherem Vorschlag).
- **Schräge Wände in der Plan-Erkennung**, Bemaßungstexte aus PDFs zur Maßstabsprüfung.

## Ready
- **Smart Home P2: simulierte Geräte im Plan** – Datenmodell `devices` (Schema v2 + Migration), platzieren/ziehen in 2D/3D, Eigenschaften. · *Grundlage für alle Smart-Home-Funktionen, ohne Hardware nutzbar* · P1 · – · Abnahme: siehe [ROADMAP P2](smart-home/ROADMAP.md).
- **IKEA-Planung: Stückliste anreichern** – `itemList` einer importierten Planung an `scripts/ikea-products.mjs` übergeben → Namen, Preise, Modelle für Korpusse. · *Realistische Kosten und echte Modelle für Planungen* · P2 · Hilfsskript vorhanden · Abnahme: importierte PAX-Planung zeigt Preise im Budget, Korpusse mit Namen.
- **Allgemeiner Quelltext-Import überarbeiten** (Arbeitsauftrag 8, zurückgestellt) – Seiten ohne schema.org, Mehrprodukt-Seiten, JS-Shops. · P2 · – · Abnahme: definierte Testseiten (synthetisch + vom Nutzer gelieferte echte) liefern korrekte Werte oder klare Fehlermeldung.

## In Progress
_(leer)_

## Blocked
- **Möbelix-Integration** – Cloudflare-Bot-Schutz; braucht von dir eingefügte Seitenquelltexte oder offizielle Schnittstelle. · P2
- **IKEA-Küchenplanung importieren** – Backend aus der Umgebung gesperrt; Format unbekannt. · P2
- **Smart Home P5/P6 (Live-Anbindung)** – braucht installierte Home-Assistant-Instanz (Phase A1/A2) und deine Entscheidungen in [DECISIONS.md](smart-home/DECISIONS.md). · P3
- **Gamepad-Steuerung** – wartet auf deine Freigabe ([CONTROLLER_ASSESSMENT.md](CONTROLLER_ASSESSMENT.md)). · P3

## Done
- 3D-Kollisionsanzeige, Mausempfindlichkeit, Klick-vs.-Ziehen-Fix, Wandfang, Tageszeit-Regler – PR #2 (`a9cc64f`), wartet auf deinen Test.
- IKEA: echte Produktdaten + 3D-Modelle, Artikelliste → Produktliste (`scripts/ikea-products.mjs`), PAX-Planung als JSON → Raum + Korpusse – 2026-10-16 (`b79c590`, `97f7532`), Doku [`PLANNER_IMPORT_RESEARCH.md`](PLANNER_IMPORT_RESEARCH.md).
- Smart-Home-Konzept (Dokumentation) – [`smart-home/`](smart-home/README.md), 2026-10-16.
