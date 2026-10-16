# Projektstatus – Wohnungsplaner 3D

_Zuletzt aktualisiert: 2026-10-16 · Branch `claude/quirky-faraday-0d9uep` · Workflow: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md)_

## Aktuell
- **Phase:** 8 (Stabilisierung) + Arbeitsauftrag „IKEA/Möbelix-Integration und Smart-Home-Konzept“
- **Erledigt in dieser Runde (5):** IKEA – echte Produktdaten und 3D-Modelle, Artikelliste → Produktliste mit Modellen, gespeicherte PAX-Planung → Raum + Korpusse; Möbelix weiterhin blockiert; Smart-Home-Konzept (`docs/smart-home/`); Ideen-Backlog (`docs/IDEAS.md`)
- **Vorherige Runde (4):** Kollisionen in 3D, Mausempfindlichkeit, Klick vs. Ziehen, Wandfang, Tageszeit-Regler – **testest du selbst** (unverändert in dieser Runde)
- **Nächster Schritt:** deine Antworten in [`smart-home/DECISIONS.md`](smart-home/DECISIONS.md), Test der IKEA-Wege; danach höchste `Ready`-Aufgabe in [`IDEAS.md`](IDEAS.md)

## Legende
`DONE` fertig mit Beleg · `PARTIAL` teilweise · `IN PROGRESS` in Arbeit · `PLANNED` geplant · `BLOCKED` blockiert · `NEEDS USER TEST` braucht deinen Praxistest

Prüfstufen: **Impl.** Code vorhanden · **Auto** automatischer Test/Build grün · **Manuell** von Claude in der laufenden App (Headless-Chromium, Software-Rendering) angesehen · **Nutzer** von dir bestätigt

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

**Von dir bestätigt:** noch nichts.

## Automatische Prüfungen (letzter Lauf, siehe Git-Abschnitt)
- `tsc -b`, `eslint`, `vite build`: ✅
- Vitest: ✅ 184/184 · Playwright: ✅ 22/22 (Headless-Chromium, SwiftShader; ein Namenskonflikt des neuen Import-Knopfs wurde dabei gefunden und behoben)

## Wartet auf deinen Test
1. 3D: Möbel anklicken (bleibt ausgewählt, bewegt sich nicht) und ziehen (folgt der Maus, kein Sprung) – auch in der Schnittansicht.
2. Sofa an die Eingangstür schieben: rote Markierung im Raum, Türblatt markiert, verschwindet beim Wegziehen.
3. Möbel an Wände/Ecken ziehen: rastet ruhig ein, nicht an Türöffnungen, löst sich erst bei deutlichem Wegziehen.
4. Tageszeit-Regler im Realismusmodus: folgt das Licht direkt?
5. Mausempfindlichkeit (Projekt › Steuerung) beim Begehen und Drehen.
6. IKEA: Artikelliste mit `node scripts/ikea-products.mjs … --models` abrufen und mit den GLB-Dateien importieren; eigene PAX-Planung als JSON speichern (DevTools) und unter Import übernehmen; eine Möbelix-Seite einfügen.

## Blocker
- **IKEA-Küchenplaner, Suche, Verfügbarkeit, Planer-Modelle:** von der Netzwerkrichtlinie der Umgebung gesperrt (`api.kitchen.planner.ikea.com`, `sik.search.blue.cdtapps.com`, `api.salesitem.ingka.com`, `content.dexf.ikea.com`).
- **Möbelix:** Cloudflare-Bot-Challenge – wird respektiert; Weg über eingefügten Seitenquelltext.
- **IKEA-Dienste direkt aus der App:** nur mit IKEAs eigenem Anwendungsschlüssel → nicht genutzt; Planungs-JSON stellt der Nutzer selbst bereit.
- **Smart Home live:** keine Hardware/HA-Instanz; Entscheidungen offen.

## Bekannte Grenzen
- **Allgemeiner Website-/Quelltext-Import (zurückgestellt, Aufgabe 8):** zuverlässig nur bei Seiten mit schema.org-Daten (JSON-LD/Microdata/Meta). Bei per JavaScript nachgeladenen Shops enthält der Quelltext oft keine Produktdaten; reiner Seitentext liefert nur Maße (heuristisch, kann Zusatzmaße wie Sitzhöhe verwechseln); mehrere Produkte auf einer Seite → das erste wird genommen; die App ruft Seiten nie selbst ab (CORS). Wird nach den Händler-/Planer-Themen überarbeitet.
- Konfliktanzeige zeigt Überschneidungen von Möbeln untereinander nur als Hinweis (nicht im 3D-Raum), weil z. B. Stühle unter Tischen gewollt sind.
- Erkennung nur für achsparallele, gefüllte Wände.
- 3D-Leistung auf echter GPU nicht gemessen (Cloud: Software-Rendering).
- Speicherung browserlokal (Export als Projektpaket für andere Geräte).

## Als Nächstes (Vorschlag)
Siehe [`IDEAS.md`](IDEAS.md) → `Ready`: 1. Smart Home P2 (simulierte Geräte im Planer) · 2. IKEA-Planung mit Stückliste anreichern · 3. allgemeinen Quelltext-Import überarbeiten.

## Git
- Branch `claude/quirky-faraday-0d9uep`; `main` = `a9cc64f` (PR #2 gemergt); Runde 5 wird per PR #3 integriert
- Runde 5: `eb638f2` IKEA-Modellwahl · `b79c590` Artikelliste/Skript/Mehrdatei-Import · `97f7532` PAX-Planung · `37b14ad` Recherche · `624baee` Smart-Home-Doku · `0bd9806`/`0035663` Backlog · `c1648c6` Knopf-Fix
