# Smart Home – Installation und Einrichtung (für später)

_Stand: 2026-10-16 · Status: **PLANNED** – nichts ausführen, bevor die Entscheidungen in [DECISIONS.md](DECISIONS.md) getroffen sind._
Offizielle Anleitungen (Menüpfade ändern sich häufig – im Zweifel der offiziellen Seite folgen): [Installation](https://www.home-assistant.io/installation/) · [Green](https://www.home-assistant.io/green/) · [Raspberry Pi](https://www.home-assistant.io/installation/raspberrypi) · [Generic x86-64](https://www.home-assistant.io/installation/generic-x86-64) · [Onboarding](https://www.home-assistant.io/getting-started/onboarding/) · [Organizing](https://www.home-assistant.io/docs/organizing/) · [ZHA](https://www.home-assistant.io/integrations/zha/) · [Thread](https://www.home-assistant.io/integrations/thread/) · [Matter](https://www.home-assistant.io/integrations/matter/) · [Backups](https://www.home-assistant.io/common-tasks/general/#backups).

## 0. Vorbereitung
* Router: feste IP-Reservierung für den HA-Host; IPv6 lokal aktiv lassen (Matter/Thread).
* Passwortmanager bereit (Owner-Konto, Emergency Kit, Router).
* Funkstick-Platz: weg von Router/SSD/Metall, USB-2.0-Verlängerung.
* Vorhandene Apple-/Google-Geräte inventarisieren (Thread-Border-Router?).

## 1. Host in Betrieb nehmen
**Green:** LAN + Strom anschließen, `http://homeassistant.local` öffnen (HAOS vorinstalliert) ✔.
**Raspberry Pi 5:** Raspberry Pi Imager → „Other specific-purpose OS → Home automation → Home Assistant“ → auf SSD/Karte schreiben; LAN anschließen ✔. (NVMe-Boot: Bootreihenfolge im EEPROM ggf. anpassen ◐.)
**Mini-PC:** UEFI, Secure Boot aus; HAOS-Image auf die interne SSD schreiben (z. B. aus Ubuntu-Live-USB) ✔.
Hinweis: Der Standardport ist laut aktueller `http`-Doku unter HAOS ab 2026.8 **80** (vorher 8123; Rückfall auf 8123, wenn 80 belegt) ◐ – ältere Anleitungen nennen `:8123`.

## 2. Onboarding ✔
1. „Neue Installation“ → Owner-Konto (Admin). Alternativ „Aus Backup wiederherstellen“.
2. Standort → setzt Zeitzone (Europe/Vienna), Einheiten (metrisch), Währung (EUR).
3. Analyse-Freigabe nach Wunsch.
4. Sofort: **MFA aktivieren** (Profil → Sicherheit), Sprache Deutsch, Update auf aktuelle Version.

## 3. Grundstruktur
* **Etage** „Wohnung“, **Bereiche** = Räume wie im Wohnungsplaner (gleiche Namen) ✔.
* **Benutzer** je Person, Admin nur für dich; „nur lokal“ für Konten ohne Fernzugriff.
* **Labels**: „sicherheitskritisch“, „batterie“, „mesh-router“.
* Netzwerk → IPv6 „Automatisch“ ✔.

## 4. Backups zuerst
Einstellungen → System → Backups: tägliches automatisches Backup, Backup vor Updates, Ziele lokal + NAS + extern, **Emergency Kit herunterladen und sicher ablegen**, dann **Restore-Test** (siehe [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) §4). Erst danach Geräte anlernen.

## 5. Funk und Geräte
1. **Zigbee:** ZBT-2 einstecken → ZHA wird erkannt → Netz bilden ✔. Zuerst **netzbetriebene** Geräte (Steckdosen) koppeln (Mesh), dann Batteriesensoren nahe am Zielort.
2. **Thread/Matter:** Matter-Server-App installieren; Thread über OpenThread-Border-Router-App auf zweitem Stick **oder** vorhandenen Apple/Google-Border-Router; Thread-Zugangsdaten über die Companion App teilen ✔. Matter-Geräte **nur über die Companion App** koppeln ✔; Matter-Code (QR) vorher fotografieren.
3. **Wi-Fi-Geräte** (Shelly): ins Heim-WLAN, Cloud abschalten, Integration „Shelly“ (lokal).
4. **ESPHome-Bluetooth-Proxy** flashen und in HA übernehmen ✔.
5. Jedes Gerät sofort umbenennen (`raum_typ_ort`) und dem Bereich zuordnen.

## 6. Betrieb (monatlich ~15 min)
1. Release-Notes lesen (Abschnitt „Backward-incompatible changes“) ✔.
2. Letztes Backup prüfen → Update (1–2 Wochen nach Release) ✔/✘.
3. Einstellungen → System → **Reparaturen** und Protokolle ansehen ✔.
4. Batterien (Label „batterie“), nicht erreichbare Geräte prüfen.
5. Quartalsweise: Datenbankgröße, ungenutzte Integrationen/Apps entfernen; halbjährlich Restore-Test.

## 7. Fehlersuche (kurz)
* Zigbee-Geräte fallen aus → Mesh (mehr netzbetriebene Router), Stick-Position/Verlängerung, Kanalkonflikt mit WLAN.
* Matter-Kopplung scheitert → IPv6/mDNS, gleiches Netz für Handy, HA und Border Router, „Multicast-Optimierung“ am WLAN.
* System träge → Recorder-Ausschlüsse, Apps reduzieren.
* System startet nicht → Restore auf neuem Medium ([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) §3).
