# Projektstatus – Wohnungsplaner 3D

_Zuletzt aktualisiert: 2026-10-16 · Branch `claude/quirky-faraday-0d9uep` · Workflow: [`DEVELOPMENT_WORKFLOW.md`](DEVELOPMENT_WORKFLOW.md)_

## Aktuell
- **Phase:** 8 (Stabilisierung) – Arbeitsauftrag „Complete Project Work Order“ (Aufgaben 1–8)
- **Erledigt in dieser Runde:** Git-Workflow + CI + Integration nach `main`, Kollisionen im 3D-Raum, Mausempfindlichkeit, Klick vs. Ziehen (inkl. Fix: 3D-Ziehen startete nicht), Wandfang/-durchdringung, Tageszeit-Regler ohne Verzögerung, echte IKEA-Seiten + Planer-Recherche
- **Nächster Schritt:** dein Praxistest (Liste unten); danach Stücklisten-Import bzw. allgemeiner Quelltext-Import (zurückgestellt)

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
| Händler-3D-Modell laden | NEEDS USER TEST | ✅ | ✅ E2E (simulierter Server) | ⚠️ echter Abruf hier gesperrt | – |
| Möbelix | BLOCKED (Bot-Schutz) | – | – | – | – |
| Planer-Pläne (IKEA Küche/PAX …) | BLOCKED (kein legitimer Zugang) | – | – | – | – |
| Gamepad | PLANNED (wartet auf Freigabe) | Bewertung `CONTROLLER_ASSESSMENT.md` | – | – | – |
| Küchenplaner, Budget, CSV | NEEDS USER TEST / DONE | ✅ | ✅ | ✅ | – |

**Von dir bestätigt:** noch nichts.

## Automatische Prüfungen (letzter Lauf, siehe Git-Abschnitt)
- `tsc -b`, `eslint`, `vite build`: ✅
- Vitest: ✅ 174/174 · Playwright: siehe unten

## Wartet auf deinen Test
1. 3D: Möbel anklicken (bleibt ausgewählt, bewegt sich nicht) und ziehen (folgt der Maus, kein Sprung) – auch in der Schnittansicht.
2. Sofa an die Eingangstür schieben: rote Markierung im Raum, Türblatt markiert, verschwindet beim Wegziehen.
3. Möbel an Wände/Ecken ziehen: rastet ruhig ein, nicht an Türöffnungen, löst sich erst bei deutlichem Wegziehen.
4. Tageszeit-Regler im Realismusmodus: folgt das Licht direkt?
5. Mausempfindlichkeit (Projekt › Steuerung) beim Begehen und Drehen.
6. Echte IKEA-Seite übernehmen + „Modell direkt laden“ (zeigt, ob IKEA den Abruf erlaubt); eine Möbelix-Seite einfügen.

## Blocker
- **3D-Modelle von IKEA laden / Planer beobachten:** Netzwerkrichtlinie dieser Umgebung sperrt `web-api.ikea.com`, `api.dexf.ikea.com`, `kitchen.planner.ikea.com` (Freigabe: Umgebung › Network access › Allowed domains).
- **Möbelix:** Cloudflare-Bot-Challenge – wird respektiert.
- **Komplette Planer-Pläne:** nur über nicht öffentlichen IKEA-Dienst mit App-Schlüssel bzw. Konto → nicht umsetzbar ohne offizielle Freigabe.

## Bekannte Grenzen
- **Allgemeiner Website-/Quelltext-Import (zurückgestellt, Aufgabe 8):** zuverlässig nur bei Seiten mit schema.org-Daten (JSON-LD/Microdata/Meta). Bei per JavaScript nachgeladenen Shops enthält der Quelltext oft keine Produktdaten; reiner Seitentext liefert nur Maße (heuristisch, kann Zusatzmaße wie Sitzhöhe verwechseln); mehrere Produkte auf einer Seite → das erste wird genommen; die App ruft Seiten nie selbst ab (CORS). Wird nach den Händler-/Planer-Themen überarbeitet.
- Konfliktanzeige zeigt Überschneidungen von Möbeln untereinander nur als Hinweis (nicht im 3D-Raum), weil z. B. Stühle unter Tischen gewollt sind.
- Erkennung nur für achsparallele, gefüllte Wände.
- 3D-Leistung auf echter GPU nicht gemessen (Cloud: Software-Rendering).
- Speicherung browserlokal (Export als Projektpaket für andere Geräte).

## Als Nächstes (Vorschlag)
1. Nach deinem Test: Feinschliff (Farben der Kollisionsanzeige, Fangabstände)
2. Stücklisten-Import aus IKEA-Planer-Zusammenfassung (braucht Beispieltext)
3. Allgemeinen Quelltext-Import überarbeiten (Aufgabe 8)

## Git
- Branch `claude/quirky-faraday-0d9uep`; `main` = `5797457` (PR #1 gemergt nach grüner CI)
- Diese Runde: `2918525` CI/Workflow · `34551bd` Kollisionen 3D + Drag-Fix · `485726b` Mausempfindlichkeit · `004c716` Wandfang/Durchdringung · `1a6ce1f` Tageszeit-Regler · `e25da43` 3DModel/Recherche
