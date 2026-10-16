# Projektstatus – Wohnungsplaner 3D

_Zuletzt aktualisiert: 2026-10-16 · Branch `claude/quirky-faraday-0d9uep`_

## Aktuell
- **Phase:** 8 (Stabilisierung) – Fehlerbehebungen aus deinem Praxistest
- **Zuletzt erledigt (Runde 3):** Auswahl-Bug 3D, Kollision Möbel/Wand/Tür, Wandfang, Quelltext-Import, Sockelleisten, Tageszeit-Licht, Händlermodell-Weg (GLB), Controller-Bewertung
- **Nächster Schritt:** dein Praxistest der Fixes + eine echte IKEA-Seite (siehe unten)

## Legende
`DONE` fertig mit Beleg · `PARTIAL` teilweise · `IN PROGRESS` in Arbeit · `PLANNED` geplant ·
`BLOCKED` blockiert · `NEEDS USER TEST` braucht deinen Praxistest

Prüfstufen: **Impl.** Code vorhanden · **Auto** automatischer Test/Build grün ·
**Manuell** von Claude in laufender App (Headless-Chromium, Software-Rendering) geprüft · **Nutzer** von dir bestätigt

## Funktionen

| Bereich | Status | Impl. | Auto | Manuell | Nutzer |
|---|---|---|---|---|---|
| Datenmodell, Einheiten, Schema v1, Validierung | DONE | ✅ | ✅ Unit | – | – |
| 2D-Editor (Wände, Räume, Öffnungen, Fang, Bemaßung, Undo) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Numerische Maße (Raum, Wand, Öffnung, Möbel) | NEEDS USER TEST | ✅ | ✅ E2E | ✅ | – |
| 3D-Ansicht (Wände/Öffnungen/Böden, Orbit, Schnitt) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ Screenshots | – |
| Realismus: AO, SMAA, Tonemapping, Himmel, Texturen/Relief, Lampenlicht | NEEDS USER TEST | ✅ | ✅ Build+E2E ohne Fehler | ✅ Screenshots | – |
| Architektur-Details (Sockelleisten, Fensterbänke, Fensterflügel, Zargen, Drücker) | NEEDS USER TEST | ✅ | ✅ Unit | ✅ Screenshots | – |
| Auswahl in 3D/2D (bleibt nach Loslassen, Klick vs. Ziehen) | NEEDS USER TEST | ✅ | ✅ E2E-Regression (schlägt ohne Fix fehl) + Unit | ✅ | – |
| Kollision Möbel ↔ Wand/Türblatt, kein Durchtunneln, Gleiten | NEEDS USER TEST | ✅ | ✅ 12 Unit + E2E | ✅ | – |
| Wandfang (Rückseite bündig, Ecken, Alt = frei) | NEEDS USER TEST | ✅ | ✅ Unit + E2E | ✅ | – |
| Platzierungswarnungen (Türaufschlag, außerhalb, Überschneidung) | NEEDS USER TEST | ✅ | ✅ Unit | – | – |
| Sockelleisten (alle Innenwandflächen, Instanced) | NEEDS USER TEST | ✅ | ✅ 6 Unit (Rechteck, L, Wandstück, ohne Raum, Fenster) | ✅ Screenshot | – |
| Tageszeit-Licht (Sonne, Himmel, Fensterlicht, Nacht, Überblendung) | NEEDS USER TEST | ✅ | ✅ Unit + E2E | ✅ Screenshots 4 Zeiten | – |
| Möbelmodelle (abgerundet, Polster, Kissen …) | NEEDS USER TEST | ✅ | ✅ Maßtest aller 53 Modelle | ✅ Screenshots | – |
| Begehung mit Kollision, Decken | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ⚠️ nur Software-Rendering | – |
| PDF/PNG/JPG-Underlay, Kalibrierung, Kontrollmaße | NEEDS USER TEST | ✅ | ✅ E2E (inkl. mehrseitiges Vektor-PDF) | ✅ | – |
| Erkennung (Beta, achsparallele Wände) | PARTIAL | ✅ | ✅ Unit+E2E (synthetische Pläne) | – echte Pläne ungetestet | – |
| `apartment-plan.json` Import/Export + Prüfung | DONE | ✅ | ✅ Unit+E2E | ✅ | – |
| GLB/glTF-Import (Katalog + pro Objekt, Draco lokal) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Produkt von Händlerseite übernehmen (robuster Parser, Fehlermeldungen) | NEEDS USER TEST | ✅ | ✅ 18 Unit + E2E (synthetische Seiten) | – echte Seiten | – |
| Händler-3D-Modell aus Quelltext (Direktabruf/Datei-Rückfall, Maßabgleich) | NEEDS USER TEST | ✅ | ✅ Unit + E2E (simulierter Server) | – echte IKEA-Seite | – |
| Gamepad-Steuerung | PLANNED (wartet auf Freigabe) | Bewertung `docs/CONTROLLER_ASSESSMENT.md` | – | – | – |
| IKEA/Möbelix Live-Abfrage | BLOCKED | – | – | – | – |
| Produktlisten-Import (CSV/JSON) | DONE | ✅ | ✅ Unit | – | – |
| Küchenplaner | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Autosave, Projektliste, Projektpaket | DONE | ✅ | ✅ Unit+E2E | ✅ | – |
| Budget, CSV-Einkaufsliste | DONE | ✅ | ✅ Unit+E2E | ✅ | – |

**Von dir bestätigt:** noch nichts. Deine Rückmeldungen bisher: „viel zu unrealistisch“ (→ Realismus-Stufen 1–4), „was ist mit .glb import“ (→ umgesetzt).

## Automatische Prüfungen (letzter Lauf, Commit `63bf64b`)
- `tsc -b`, `eslint`, `vite build`: ✅
- Vitest: ✅ 161/161 · Playwright: ✅ 17/17 (Headless-Chromium, SwiftShader)

## Wartet auf deinen Test
0. Die gemeldeten Fehler: Möbel anklicken (bleibt ausgewählt?), Sofa an Tür/Wand schieben, an Wand fangen, Sockelleisten, Tageszeit-Regler (oben in der Leiste im Realismusmodus).
1. Realismusmodus auf deinem Rechner (echte Grafikkarte): Bildeindruck und flüssige Bedienung?
2. „Produkt von Händlerseite übernehmen“ mit einer echten IKEA- und einer Möbelix-Seite: stimmen Name, Preis, Maße?
3. Eigenes GLB-Modell importieren (z. B. von einem Hersteller, sofern erlaubt).
4. Einen echten Grundriss (PDF/Foto) kalibrieren und nachzeichnen bzw. erkennen lassen.

## Blocker
- **IKEA/Möbelix live:** Die Cloud-Umgebung blockiert `www.ikea.com` und `www.moebelix.at` (Proxy 403/DNS). Keine offizielle öffentliche API bekannt. Details: `docs/INTEGRATIONS_IKEA.md`.

## Bekannte Grenzen
- Erkennung nur für achsparallele, gefüllte Wände; Tür/Fenster-Typ heuristisch.
- 3D-Leistung auf echter GPU nicht gemessen (Cloud: ~1 FPS mit Software-Rendering im Realismusmodus).
- Möbel ohne GLB sind maßstäbliche Näherungen.
- Speicherung nur browserlokal (Export als Projektpaket für andere Geräte).

## Als Nächstes (Vorschlag)
1. Nach deinem Test: Realismus feinjustieren (Lichtstimmung, Farben, Belichtung)
2. Mehrfachauswahl und Kopieren/Einfügen
3. Schräge Wände in der Erkennung, Bemaßungstexte aus PDFs zur Maßstabsprüfung

## Git
- Branch: `claude/quirky-faraday-0d9uep` · Push geprüft · kein Pull Request
- Runde 3: `0b02fdb` Auswahl · `9778ace` Kollision/Fang · `618c820` Quelltext-Import · `8389f0d` Sockelleisten · `50bb075` Tageszeit · `5feffeb` Händlermodell · `63bf64b` Controller-Bewertung
- Runde 2: `e912086` Texturen · `c637aae` Möbelmodelle · `0fe74dd` Architektur-Details · `0c59496` Realismus-Effekte · `8ee9471` GLB-Import · `94b7ef4` Produkt-Provider/PoC · Doku `f7cbcd3` + Dashboard
