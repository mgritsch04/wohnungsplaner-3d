# Smart Home – Backup und Wiederherstellung

_Stand: 2026-10-16 · Status: **PLANNED**._ Kennzeichnung: ✔ offizielle Quelle geprüft · ◐ Sekundärquelle · ✘ Praxisempfehlung/Annahme.
Referenzen: [Backups (Common tasks)](https://www.home-assistant.io/common-tasks/general/#backups) · [Release 2025.1](https://www.home-assistant.io/blog/2025/01/03/release-20251/) · [ZHA](https://www.home-assistant.io/integrations/zha/) · [Zigbee2MQTT FAQ](https://www.zigbee2mqtt.io/guide/faq/) · [Recorder](https://www.home-assistant.io/integrations/recorder/) (abgerufen 2026-10-16).

> **Getrennt halten:** Home-Assistant-Backups haben nichts mit dem Git-Repository des Wohnungsplaners oder dessen Projektdateien zu tun. Keine HA-Backups, `secrets.yaml` oder Notfallschlüssel in dieses Repository.

## 1. Was gesichert wird ✔
Vollbackup: Konfiguration inkl. Datenbank (`home-assistant_v2.db`), Integrationen, Automationen, Skripte, Dashboards, installierte Apps samt Daten (z. B. Zigbee2MQTT/Mosquitto, falls genutzt), `share`, `ssl`, `media`. Empfehlung: `media`/`share` ausschließen, wenn groß (schnellerer Restore).
ZHA sichert das Zigbee-Netz zusätzlich automatisch ✔; Thread-Netzdaten liegen in HA ✔.

## 2. Richtlinie
| Punkt | Festlegung |
|---|---|
| Häufigkeit | **täglich automatisch** (Uhrzeit „systemoptimiert“) + **vor jedem Update** (Option aktivieren ✔) + manuell vor größeren Umbauten |
| Aufbewahrung | lokal 7 · NAS 14 · extern 3 (manuelle Backups werden nicht automatisch gelöscht ✔ – regelmäßig aufräumen) |
| Ziele (3-2-1) | ① lokal auf dem Host · ② **NAS/Netzwerkspeicher** (SMB/NFS) ✔ · ③ **außer Haus**: Home Assistant Cloud (1 Backup bis 5 GB, immer verschlüsselt ✔) **oder** OneDrive/Google Drive-Integration ✔ |
| Verschlüsselung | **an** für alle Ziele außerhalb des Hosts (AES, Schlüssel im „Emergency Kit“ ✔) |
| Notfallschlüssel | Emergency Kit **im Passwortmanager + ausgedruckt** an sicherem Ort; ohne Schlüssel kein Restore ✔ |
| Zugriff | NAS-Freigabe mit eigenem Benutzer nur für HA (Schreiben), Cloud-Konto mit MFA |
| Kontrolle | Fehlgeschlagene Backups erscheinen unter „Reparaturen“ ✔ + Benachrichtigung aufs Handy einrichten |

## 3. Szenarien
**a) Hardware defekt / Umzug auf neue Hardware** ✔
1. HAOS auf neuem Gerät installieren, **Zigbee-/Thread-Stick vorher einstecken**.
2. Onboarding → „Aus Backup wiederherstellen“ → Datei hochladen oder Home Assistant Cloud wählen.
3. Encryption Key eingeben, Teile wählen, warten (große Systeme bis ~45 min, Seite nicht neu laden).
4. Mit alten Zugangsdaten anmelden, Netzwerkspeicher neu verbinden; bei neuem Funkstick Zigbee migrieren (siehe d).
Zielgerät braucht mehr Speicher als das Quellsystem belegt ✔.

**b) Speichermedium beschädigt (typisch: microSD)** ✔/✘
Symptome: Bootschleife, schreibgeschützt, Datenbankfehler. → Neues Medium (besser SSD), HAOS neu installieren, Restore aus dem letzten Backup **außerhalb** des Hosts. Vorbeugen: SSD statt SD, Datenbank klein halten (Recorder-Ausschlüsse), sauberes Herunterfahren / USV.

**c) Versehentlich gelöscht oder fehlerhafte Änderung**
Teil-Restore (nur Konfiguration bzw. einzelne App) aus dem letzten Backup; bei Automationen/Skripten hilft zusätzlich ein Export als YAML ✘.

**d) Zigbee-Koordinator wechseln** ✔
ZHA: Einstellungen → Zigbee → „Migrieren“ (automatisch aus Backup); alten Stick danach nicht in Reichweite betreiben; Geräte melden sich meist innerhalb einer Stunde. Zigbee2MQTT: Wechsel mit Backup nur bei TI-(zstack)/Silicon-Labs-(ember)-Adaptern, sonst Neukoppeln ✔.

**e) Totalverlust der Wohnung (Brand, Einbruch)**
Restore aus dem externen Backup auf beliebiger neuer Hardware; Notfallschlüssel muss außerhalb verfügbar sein.

## 4. Wiederherstellung testen (Pflicht, nicht optional)
Ein Backup gilt erst als gültig, wenn ein Restore geklappt hat.
* **Wann:** nach der Ersteinrichtung, danach **halbjährlich** und nach größeren Umbauten.
* **Wie** ✘: HAOS als virtuelle Maschine (offizielle VM-Images) auf einem PC → Onboarding-Restore aus dem **externen** Backup → prüfen: Anmeldung, Automationen vorhanden, Dashboards, Geräteliste, Verlauf. **Funksticks dabei nicht anschließen**, VM danach vom Netz trennen und löschen (sonst doppelte Steuerung).
* **Protokoll:** Datum, Backup-Datum/-Größe, Dauer, Auffälligkeiten → Tabelle unten.

| Datum | Backup von | Ziel getestet | Ergebnis | Notizen |
|---|---|---|---|---|
| _(noch kein Test – System nicht installiert)_ | | | | |

## 5. Weitere Daten
* Zugangsdaten (HA-Owner, Router, Cloud, Schloss-App) im Passwortmanager mit Notfallzugang.
* Gerätedokumentation (Pairing-Codes von Matter-Geräten, Installationscodes) fotografieren/ablegen – Matter-QR-Codes am Gerät oft nicht mehr zugänglich ✘.
* Router-Konfiguration exportieren (FRITZ!Box-Sicherung mit Kennwort).
