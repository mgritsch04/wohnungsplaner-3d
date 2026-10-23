# Smart Home – Roadmap

_Stand: 2026-10-16. Status aller Phasen: **PLANNED** (nichts umgesetzt, keine Hardware gekauft)._ Aufwand = grobe Schätzung in Arbeitssitzungen (eine Sitzung ≈ ein fokussierter Arbeitsblock mit Tests).

Zwei Stränge laufen getrennt: **A – reale Installation** (deine Hardware, Home Assistant) und **P – Planer-Software**. P1–P3 brauchen keine Hardware.

## A – Reale Installation

| Phase | Inhalt | Abhängigkeit | Abnahme | Aufwand |
|---|---|---|---|---|
| A0 Entscheidungen | Offene Fragen in [DECISIONS.md](DECISIONS.md) beantworten (Budget, Mietwohnung, Router, Schloss ja/nein) | – | Entscheidungen eingetragen | 1 Gespräch |
| A1 Basis | Host + Funk (siehe [HARDWARE_AND_DEVICES.md](HARDWARE_AND_DEVICES.md)) installieren nach [INSTALLATION_AND_SETUP.md](INSTALLATION_AND_SETUP.md); Benutzer, MFA, Bereiche | Hardware gekauft | HA läuft, Update eingespielt, erstes verschlüsseltes Backup **wiederhergestellt getestet** | 1–2 Abende |
| A2 Backup & Sicherheit | Backup-Ziele (lokal + NAS/Cloud), Notfallschlüssel offline, Fernzugriff nur per VPN/Nabu Casa | A1 | Wiederherstellungstest dokumentiert ([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)) | 1 Abend |
| A3 Erste Geräte | Licht + Steckdosen + Sensoren eines Raums | A1 | Geräte lokal steuerbar, ohne Internet getestet | 1 Abend |
| A4 Ausbau | Kontakte, Rollos, Heizung, Präsenz; Automationen | A3 | je Raum Szenen + 2–3 Automationen, Protokoll ohne Fehler eine Woche | laufend |
| A5 Sicherheitskritisch (optional) | Schloss erst nach eigener Risikoabwägung | A2, A4 | Notfallzugang geprüft, kein Fernöffnen ohne MFA | 1 Abend |

## P – Planer-Software

| Phase | Inhalt | Abhängigkeit | Abnahmekriterien | Aufwand |
|---|---|---|---|---|
| **P1 Architektur & Doku** | diese Dokumente | – | ✅ erledigt (2026-10-16) | – |
| **P2 Simulierte Geräte** | Datenmodell `devices` (Schema v2 + Migration), Platzieren/Auswählen/Ziehen in 2D/3D, Eigenschaften, Undo, Export/Import | – | Gerät in 2D platzieren → 3D sichtbar; Reload/Export erhält Geräte; alte Projekte laden; Unit + E2E grün | 2–3 |
| **P3 Gerätekatalog & Wirkbereiche** | Katalog (Melder, Licht, Kontakt, Rollo, Thermostat, Schloss, Saugroboter …), Erfassungskegel/-zonen, Ebenenschalter, Abdeckung pro Raum | P2 | Kegel folgt Drehung/Höhe; Abdeckungswert pro Raum plausibel (Unit-Test mit Rechteckraum); keine Bildraten-Einbußen > 10 % | 2–3 |
| **P4 Szenen & Simulation** | Szenen, einfache Automationen, Abspielen mit Tageszeit; Licht/Rollo wirken auf 3D | P3 | Szene schaltet Lichtquellen in 3D; Rollo dunkelt Fenster; ein Undo-Schritt pro Szene | 2 |
| **P5 HA lesend (optional)** | Planner Bridge (Backend), Zuordnung Räume↔Areas, Live-Zustände, veraltet/nicht gefunden | A1, P2 | kein Token im Browser (Test prüft Bundle/Export); Zustände < 2 s aktuell; Verbindungsabbruch sauber angezeigt | 3–4 |
| **P6 Steuern mit Freigabe** | erlaubte Aktionen (Licht, Rollo), Bestätigung, Protokoll; Schlösser ausgeschlossen bzw. nur mit Extra-Freigabe | P5 | nur freigegebene Entitäten schaltbar (Test), Aktionen protokolliert | 2–3 |
| P7 Erweiterungen | YAML-Export von Szenen, Saugroboter-Karte, Energieansicht | P5 | je Feature eigene Kriterien | offen |

**Priorität:** P2 → P3 → P4 bringen sofort Nutzen beim Planen (Kabel-/Melderpositionen, Abdeckung) und sind unabhängig von Hardware. P5/P6 erst, wenn A1–A2 stabil laufen.

## Stufe 2a: Bridge und CI-Test gegen echtes Home Assistant (#229)
- `src/smarthome/haBridge.ts`: kleiner Client (Zustände lesen, Dienste aufrufen), nur für Node-Skripte/Tests, wird von der App nicht importiert (kein Token im Browser-Bundle, D8).
- `scripts/ha/run-local.sh`: prüft den Export (`automationsYaml`) mit `hass --script check_config` (gültig → ok, absichtlich kaputt → muss scheitern) und startet ein Wegwerf-Home-Assistant mit `demo:`; die Bridge liest dort Zustände und schaltet ein Demo-Licht. Das Token entsteht zur Laufzeit per Onboarding der Testinstanz und wird verworfen.
- CI: `.github/workflows/smart-home-ha.yml`, läuft nur bei Änderungen an `src/smarthome/**`, `scripts/ha/**` oder dem Workflow; HA-Version fest in `scripts/ha/requirements.txt` (pip-Cache). Lokal: `pip install -r scripts/ha/requirements.txt`, `libturbojpeg` installieren, `scripts/ha/run-local.sh`.
- Hinweis: `check_config` endet auch bei verworfenen Automationen mit Exitcode 0; das Skript wertet deshalb zusätzlich die Fehlerzeilen aus.
