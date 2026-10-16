# Smart Home – Überblick

_Stand: 2026-10-16 · Status: **Konzept** (keine Hardware gekauft, nichts installiert, keine Live-Steuerung im Planer)._

Ziel: eine wartbare, möglichst lokale Smart-Home-Installation mit **Home Assistant**, deren Geräte später im **Wohnungsplaner** (2D/3D) geplant, simuliert und – optional, zuerst nur lesend – mit echten Zuständen angezeigt werden.

## Empfehlung auf einen Blick
* **Zentrale:** Home Assistant OS auf **Home Assistant Green** (~180 €, ~1,7 W) – Alternativen: günstiger mit SONOFF-Stick, stärker mit N150-Mini-PC.
* **Funk:** **Zigbee** über **Connect ZBT-2** (45 €) als Hauptnetz; **Thread/Matter** über zweiten ZBT-2 oder vorhandenen Apple/Google-Border-Router; ESPHome-Bluetooth-Proxy.
* **Geräte:** Zigbee-/IKEA-Thread-Sensoren, Zigbee-Heizkörperthermostate, Zigbee-Zwischenstecker (Mesh); Shelly nur durch Elektrofachkraft; Schloss optional und zuletzt.
* **Sicherheit:** kein offener Port (VPN oder Home Assistant Cloud), MFA, keine Tokens im Browser.
* **Backups:** täglich, verschlüsselt, lokal + NAS + extern, Restore halbjährlich testen.
* **Kosten (Schätzung):** Zentrale ~290 €, Erstausstattung 3 Räume ~300 €, Strom ~5 €/Jahr, optional Fernzugriff-Abo ~75 €/Jahr.

## Dokumente
| Datei | Inhalt |
|---|---|
| [CONCEPT.md](CONCEPT.md) | **Gesamtkonzept für deine Wohnung**: Zielbild, Geräte je Funktion, Regeln, Phasen, offene Punkte |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Komponenten, Datenmodell, lokal vs. Cloud, APIs, Datenflüsse |
| [HARDWARE_AND_DEVICES.md](HARDWARE_AND_DEVICES.md) | Host-Vergleich, Funk, Protokolle, Geräteklassen mit Preisen |
| [INSTALLATION_AND_SETUP.md](INSTALLATION_AND_SETUP.md) | spätere Einrichtung Schritt für Schritt mit offiziellen Links |
| [SECURITY_AND_NETWORK.md](SECURITY_AND_NETWORK.md) | Netz, Konten, Fernzugriff, Tokens, sicherheitskritische Geräte |
| [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) | Backup-Richtlinie, Szenarien, Restore-Tests |
| [APARTMENT_PLANNER_INTEGRATION.md](APARTMENT_PLANNER_INTEGRATION.md) | Geräte im Planer, Simulation, spätere HA-Anbindung |
| [ROADMAP.md](ROADMAP.md) | Phasen A (Installation) und P (Planer) mit Abnahmekriterien |
| [DECISIONS.md](DECISIONS.md) | Entscheidungen und **offene Fragen an dich** |

## Verlässlichkeit
Fakten sind in den Dokumenten gekennzeichnet (✔ offizielle Quelle geprüft · ◐ Sekundärquelle · ✘ Annahme; Preise `BELEGT`/`SCHÄTZUNG`/`UNBEKANNT`). Die Recherche (2026-10-16) konnte einige Seiten (home-assistant.io, geizhals.at, ikea.com) nicht direkt öffnen; geprüft wurde über die offiziellen Doku-Quelltexte auf GitHub bzw. Suchergebnisse. **Preise vor dem Kauf prüfen.** Gesetzliche Angaben (Elektroinstallation, Rauchmelder) sind Hinweise, keine Rechtsberatung.

Home-Assistant-Backups, Zugangsdaten und `secrets.yaml` gehören **nicht** in dieses Repository.
