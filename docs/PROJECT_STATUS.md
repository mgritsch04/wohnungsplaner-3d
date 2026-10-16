# Projektstatus – Wohnungsplaner 3D

_Zuletzt aktualisiert: 2026-10-16 · Branch `claude/quirky-faraday-0d9uep`_

## Aktuell
- **Phase:** 8 (Stabilisierung) + Nacharbeiten aus Nutzer-Feedback
- **Aktive Aufgabe:** IKEA/Möbelix-Integrationstests, GLB-Import, realistischere Darstellung
- **Nächster Schritt:** siehe unten „Als Nächstes“

## Legende
`DONE` fertig mit Beleg · `PARTIAL` teilweise · `IN PROGRESS` in Arbeit · `PLANNED` geplant ·
`BLOCKED` blockiert · `NEEDS USER TEST` braucht deinen Praxistest

Prüfstufen: **Impl.** = Code vorhanden · **Auto** = automatischer Test/Build grün ·
**Manuell** = von Claude in laufender App (Headless-Chromium) geprüft · **Nutzer** = von dir bestätigt

## Funktionen

| Bereich | Status | Impl. | Auto | Manuell | Nutzer |
|---|---|---|---|---|---|
| Datenmodell, Einheiten, Schema v1, Validierung | DONE | ✅ | ✅ Unit | – | – |
| 2D-Editor (Wände, Räume, Öffnungen, Fang, Bemaßung, Undo) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Numerische Maße (Raum, Wand, Öffnung, Möbel) | NEEDS USER TEST | ✅ | ✅ E2E | ✅ | – |
| 3D-Ansicht (Wände/Öffnungen/Böden, Orbit, Schnitt) | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ Screenshot | – |
| Begehung mit Kollision | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ⚠️ nur Software-Rendering | – |
| PDF/PNG/JPG-Underlay, Kalibrierung, Kontrollmaße | NEEDS USER TEST | ✅ | ✅ E2E | ✅ | – |
| Erkennung (Beta, achsparallele Wände) | PARTIAL | ✅ | ✅ Unit+E2E (synthetische Pläne) | – echte Pläne ungetestet | – |
| `apartment-plan.json` Import/Export + Prüfung | DONE | ✅ | ✅ Unit+E2E | ✅ | – |
| Katalog, prozedurale Modelle | PARTIAL | ✅ | ✅ | ✅ | – |
| GLB/glTF | PARTIAL | Laden per URL/Asset mit Fallback | – | – | – |
| Produktlisten-Import (CSV/JSON) | DONE | ✅ | ✅ Unit | – | – |
| IKEA/Möbelix-Integration | IN PROGRESS | – | – | – | – |
| Küchenplaner | NEEDS USER TEST | ✅ | ✅ Unit+E2E | ✅ | – |
| Materialien, Licht, Tageszeit | PARTIAL | ✅ | – | ✅ Screenshot | – |
| Planungs-/Realismusmodus, adaptive Qualität | PARTIAL | ✅ | – | ⚠️ GPU-Leistung nicht messbar | – |
| Autosave, Projektliste, Projektpaket | DONE | ✅ | ✅ Unit+E2E | ✅ | – |
| Budget, CSV-Einkaufsliste | DONE | ✅ | ✅ Unit+E2E | ✅ | – |

**Vom Nutzer bestätigt:** noch nichts. Rückmeldung bisher: Darstellung „viel zu unrealistisch“; GLB-Import fehlt in der Oberfläche.

## Automatische Prüfungen (letzter Lauf)
- `tsc -b`, `eslint`, `vite build`: ✅ (Commit `0613358`)
- Vitest: ✅ 60/60 · Playwright: ✅ 11/11 (Headless-Chromium, SwiftShader)

## Bekannte Grenzen / Bugs
- Erkennung nur für achsparallele, gefüllte Wände; Tür/Fenster-Typ heuristisch.
- 3D-Leistung auf echter GPU nicht gemessen (Cloud nur Software-Rendering).
- Möbel = einfache prozedurale Formen; kein GLB-Upload in der UI.
- Speicherung nur browserlokal.

## Als Nächstes
1. IKEA/Möbelix: praktische Tests + `docs/INTEGRATIONS_IKEA.md` + Provider-Architektur
2. GLB/glTF-Upload in der Oberfläche (Maße aus Modell, Fallback)
3. Realismus: Umgebungsverdeckung, Sockelleisten, Fensterbänke, Türgriffe, bessere Möbelformen, Himmel

## Git
- Branch: `claude/quirky-faraday-0d9uep` (Push geprüft) · kein Pull Request
- Letzte Commits: `0613358` Leistungsmessung · `7db4917` Stabilisierung PDF · `8c9d363` Fundament
