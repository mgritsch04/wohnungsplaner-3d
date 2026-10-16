# Smart Home – Sicherheit und Netzwerk

_Stand: 2026-10-16 · Status: **PLANNED**._ Kennzeichnung: ✔ offizielle Quelle geprüft · ◐ Sekundärquelle · ✘ Annahme.
Referenzen: [Securing](https://www.home-assistant.io/docs/configuration/securing/) · [Remote access](https://www.home-assistant.io/docs/configuration/remote/) · [Authentication](https://www.home-assistant.io/docs/authentication/) · [MFA](https://www.home-assistant.io/docs/authentication/multi-factor-auth/) · [HTTP](https://www.home-assistant.io/integrations/http/) · [Matter](https://www.home-assistant.io/integrations/matter/) (alle abgerufen 2026-10-16).

## 1. Netzwerk
**Empfehlung für die Wohnung: flach und einfach.**
* HA-Host, Thread-Border-Router und Matter-Geräte **im selben Netz** – Matter und Thread brauchen lokales **IPv6** und **mDNS/Multicast**; die HA-Doku rät ausdrücklich zu einfachen, flachen Netzen und warnt vor VLANs/Multicast-Filtern ✔. In HA: Netzwerk → IPv6 „Automatisch“ ✔.
* Router-Option „Multicast-Optimierung“/IGMP-Snooping am WLAN kann Matter-Erkennung stören ✔ → bei Problemen prüfen.
* **Problemgeräte isolieren** (Kameras, billige Cloud-WLAN-Geräte): ins **Gastnetz** – dort sind sie vom Heimnetz getrennt, aber für HA dann **nicht lokal erreichbar**. Nur für Geräte, die ohnehin über die Cloud laufen.
* **FRITZ!Box** (in Österreich verbreitet): keine frei konfigurierbaren VLANs, nur Gastnetz (WLAN + LAN 4) ◐. Echte IoT-VLANs brauchen andere Hardware (UniFi, OpenWrt, OPNsense, Omada …) plus mDNS-Reflektor – **erst sinnvoll, wenn Bedarf besteht** (mehr Aufwand, mehr Fehlerquellen).
* Viele Anschlüsse nutzen CG-NAT/DS-Lite → Portweiterleitung oft unmöglich ✔; VPN-Overlay oder Home Assistant Cloud funktionieren trotzdem.

## 2. Zugang und Benutzer
* Eigenes Konto je Person; **Administrator nur, wo nötig** ✔. Option „nur lokale Anmeldung“ für Konten, die nie von außen genutzt werden ✔.
* **MFA (TOTP-App) für alle Konten**, besonders bei Fernzugriff ✔. Achtung: Anmeldungen aus „trusted_networks“ umgehen MFA ✔ → trusted_networks **nicht** verwenden.
* `http`: `ip_ban_enabled: true` und `login_attempts_threshold` setzen (Sperren laufen nicht automatisch ab) ✔.
* **Rechte-Realität** ✔: Nicht-Admins können alle Entitäten lesen und alle Aktionen ausführen; geschützt ist nur die Konfiguration. Wer z. B. ein Schloss steuern darf, entscheidet faktisch der Zugang zu HA – deshalb Konten sparsam vergeben.

## 3. Fernzugriff
| Option | Bewertung |
|---|---|
| **Home Assistant Cloud (Nabu Casa)** | laut Doku einfachste und sicherste Option, TLS, kein Routerumbau, inkl. Cloud-Backup (1 Backup bis 5 GB) ✔; Preis ca. 7,50 €/Monat bzw. 75 €/Jahr ◐ (vor Abschluss prüfen) |
| **VPN** (WireGuard am Router oder als App, Tailscale-App) | sicher, kein offener HA-Port ✔; kostenlos; Handy muss VPN aktiv haben |
| Reverse Proxy mit TLS | nur mit Erfahrung; `trusted_proxies` korrekt setzen ✔ |
| **Direkte Portweiterleitung** | **nicht verwenden** („least secure“ ✔) |

**Empfehlung:** VPN über den Router (FRITZ!Box: WireGuard ✘ prüfen) oder Home Assistant Cloud, wenn Einfachheit und Unterstützung des Projekts wichtig sind.

## 4. Geheimnisse, Tokens, Browser-Code
* `secrets.yaml` trennt Geheimnisse von der Konfiguration, **verschlüsselt aber nichts** ✔ – Datei nie in ein öffentliches Repository.
* **Langzeit-Tokens**: 10 Jahre gültig, volle Benutzerrechte, nur einmal angezeigt ✔ → im Passwortmanager ablegen, pro Zweck ein eigenes Token, ungenutzte widerrufen.
* **Nie im Browser-Code**: Kein Token im Wohnungsplaner, nicht in `VITE_*`-Variablen (Vite bettet sie in das ausgelieferte JavaScript ein), nicht im LocalStorage, nicht im Projekt-Export, nicht im Git-Repository. Grund: Wer es liest (XSS, geteilte Datei, Browser-Erweiterung), kann alle Geräte steuern.
* Für die spätere Planer-Anbindung: entweder HA-eigener Login je Nutzer (kurzlebige Tokens) oder ein Backend-Dienst mit Freigabeliste ([APARTMENT_PLANNER_INTEGRATION.md](APARTMENT_PLANNER_INTEGRATION.md) §6).
* Repository-Regel (bereits in `CLAUDE.md`): keine Secrets committen; Smart-Home-Zugangsdaten gehören weder in dieses Repository noch in Planer-Projekte.

## 5. Sicherheitskritische Geräte
**Smarte Türschlösser, Alarm, Rauchmelder, Heizung im Winter** – Regeln:
* Schloss: nur Geräte mit lokalem Weg (Matter/Bluetooth) und **mechanischem Notzugang**; Zylinder mit Not-/Gefahrenfunktion; **kein automatisches Öffnen** per Präsenz/Geofencing; Fernöffnen nur mit MFA; Ereignisprotokoll aktiv; Vermieter/Versicherung vorher klären (siehe Geräte-Dokument).
* Smarte Rauchmelder **ergänzen** nur zertifizierte Melder (EN 14604), ersetzen sie nicht.
* Automationen für Heizung mit Frostschutz-Untergrenze; Ausfall des HA-Hosts darf keine Wohnung kalt oder Tür offen lassen (Geräte müssen autonom sicher sein).

## 6. Updates
Monatliche Releases ✔. Vor jedem Update: Hinweise zu inkompatiblen Änderungen lesen, Backup (automatisch vor Update aktivierbar ✔), 1–2 Wochen nach Release aktualisieren (Praxis ✘). Apps, Firmware (Zigbee-Stick, Shelly, Schloss) ebenfalls aktuell halten; nur benötigte Apps installieren; SSH nur mit Schlüssel.

## 7. Datenschutz
Präsenzsensoren und Verlauf zeigen Anwesenheit; Recorder-Aufbewahrung begrenzen (Standard 10 Tage ✔), Kameras/Mikrofone nur bewusst, Gäste informieren.
