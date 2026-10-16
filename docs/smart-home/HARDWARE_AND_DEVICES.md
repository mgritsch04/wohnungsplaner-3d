# Smart Home – Hardware und Geräte

_Stand: 2026-10-16 · Status: **Empfehlung, nichts gekauft**._
**Preise:** `BELEGT` = konkretes Listing mit Quelle (Momentaufnahme aus Suchergebnissen; teils DE/EU-Preis, Stand teils vor heute) · `SCHÄTZUNG` = abgeleitet · `UNBEKANNT`. Die Recherche konnte geizhals.at/ikea.com nicht direkt öffnen – **vor dem Kauf alle Preise auf geizhals.at bzw. ikea.com/at prüfen**. 2026 schwanken Preise für Pi/Mini-PCs/SSDs stark (DRAM-Knappheit, Pi-Preiserhöhungen Feb./Apr. 2026 – [BGR](https://www.bgr.com/2150106/raspberry-pi-cost-ram-crisis/)).
Strom: Annahme **0,30 €/kWh** → 1 W Dauerlast ≈ 2,63 €/Jahr.

## 1. Zentrale (Home-Assistant-Host)

| Option | Preis | Leerlauf | Strom/Jahr | Bewertung |
|---|---|---|---|---|
| **Home Assistant Green** (RK3566, 4 GB, 32 GB eMMC, Gigabit-LAN, 2× USB 2.0, **kein WLAN/Bluetooth** laut [Datenblatt](https://green.home-assistant.io/resources/Green_v1.1_Datasheet.pdf)) | **179,90 €** BELEGT ([Shelly-Shop DE](https://www.shelly.com/de/products/home-assistant-green); Preiserhöhung Jan. 2026 [Nabu Casa](https://www.nabucasa.com/news/2026-01-08-green-pricing-change/)) | ~1,7 W | ~4,50 € | offizielles Gerät, lautlos, HAOS vorinstalliert, kein SD-Verschleiß; nicht aufrüstbar |
| Raspberry Pi 5 4 GB + 27-W-Netzteil + Active Cooler + M.2 HAT+ mit 256-GB-SSD + Gehäuse | ~198 € SCHÄTZUNG aus BELEGT-Einzelpreisen (Pi 119,50 € [geizhals.at](https://geizhals.at/raspberry-pi-5-modell-b-a3029965.html), Netzteil 12,40 €, Cooler 5,90 €, SSD-Kit 44,90 €) | ~3–4 W | ~8–10 € | 2026 nicht billiger als Green, mehr Bastelaufwand; **microSD nicht empfohlen** (Dauerschreiblast) |
| Mini-PC Intel N150, 16 GB / 512 GB | ~230–390 € SCHÄTZUNG (z. B. Minisforum UN150P 279 € lt. [Notebookcheck](https://www.notebookcheck.com/UN150P-Mini-PC-mit-aktuellem-Intel-Prozessor-ist-ab-sofort-in-Deutschland-erhaeltlich.967602.0.html)) | ~5–8 W | ~13–21 € | Reserven für lokale Sprachsteuerung, Kameras/NVR, VMs; Lüfter möglich |
| Home Assistant Yellow | – | – | – | **Produktion eingestellt** 15.10.2025 ([HA-Blog](https://www.home-assistant.io/blog/2025/10/15/yellow-end-of-life/)) – nicht für Neuplanung |

RAM: 4 GB reichen für eine Wohnung; 8 GB+ erst bei lokaler Sprach-KI/Kameras. Speicher: eMMC/SSD statt microSD.

## 2. Funk
* **Zigbee-Koordinator:** **Home Assistant Connect ZBT-2** (Silicon Labs MG24, USB-C), UVP **45 €** BELEGT ([Launch-Blog](https://www.home-assistant.io/blog/2025/11/19/home-assistant-connect-zbt-2)); günstiger: SONOFF ZBDongle-E **19,90 €** BELEGT ([geizhals.at](https://geizhals.at/sonoff-zbdongle-e-zigbee-3-0-usb-dongle-plus-e-a3331465.html)); netzwerkfähig (LAN/PoE, frei platzierbar): SMLIGHT SLZB-06MU 45,90 € BELEGT.
* **Thread:** Ein Stick kann **entweder** Zigbee **oder** Thread – Multiprotokoll wird offiziell nicht empfohlen ([ZBT-2](https://www.home-assistant.io/connect/zbt-2)). → zweiter ZBT-2 mit OpenThread-Border-Router-App **oder** vorhandener Border Router (HomePod mini, Apple TV 4K, Nest Hub 2. Gen. u. a. – Liste [HA Thread](https://www.home-assistant.io/integrations/thread/)).
* **Matter:** Matter-Server-App (seit 2026 auf matter.js neu implementiert ◐ [HA-Blog 2026-06-23](https://www.home-assistant.io/blog/2026/06/23/the-matter-upgrade-youve-been-waiting-for/)); Inbetriebnahme per Companion App.
* **Bluetooth:** Green hat keins → 1–2 **ESPHome-Bluetooth-Proxies** (ESP32, ~5–15 € SCHÄTZUNG; Ethernet-Variante besser, [ESPHome](https://esphome.io/components/bluetooth_proxy/)).
* **Z-Wave:** in Österreich nur bei konkretem Bedarf (EU 868 MHz, Stick ZWA-2 ~53–59 € BELEGT) – **nicht einplanen**.
* **USB-Verlängerung** (USB 2.0, geschirmt, 0,5–1,5 m, ~5–10 € SCHÄTZUNG): USB-3-Ports/SSDs stören 2,4-GHz-Funk ✔ ([Nabu Casa](https://support.nabucasa.com/hc/en-us/articles/29400591254301-Forming-a-new-Zigbee-network-with-Home-Assistant-Connect-ZBT-2)).

## 3. Empfohlenes Setup und Alternativen

| Posten | **Empfohlen** | Günstiger | Leistungsstärker |
|---|---|---|---|
| Host | Green 179,90 | Green 179,90 | N150-Mini-PC ~279 (SCHÄTZUNG) |
| Zigbee | ZBT-2 45,00 | ZBDongle-E 19,90 | ZBT-2 45,00 |
| Thread | 2. ZBT-2 45,00 (entfällt bei vorhandenem Apple/Google-Border-Router) | vorhandener Border Router / später | 2. ZBT-2 45,00 |
| Verlängerung(en), BT-Proxy | ~18 | ~8 | ~16 |
| **Anschaffung** | **~288 €** (~243 € ohne 2. ZBT-2) | **~208 €** | **~385 €** (+ USV optional ~80–180 €) |
| Strom/Jahr | ~5 € | ~5 € | ~18 € |
| Optional Fernzugriff-Abo | Home Assistant Cloud ~75 €/Jahr ◐ (vor Abschluss prüfen) | VPN (0 €) | beliebig |

**Warum „Green + ZBT-2“:** offizielles, sparsames, lautloses Gerät ohne SD-Verschleiß, Plug-and-play, reicht für eine Wohnung, Firmware der Funksticks aus HA aktualisierbar, Kauf unterstützt die Entwicklung. Mini-PC erst, wenn lokale Sprachsteuerung oder Kameras geplant sind. USV und eigenes NAS lohnen sich für eine Wohnung meist nicht – ein **externes Backup-Ziel** schon ([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)).

## 4. Protokolle im Vergleich (Einschätzung 2026)

| | Zigbee | Thread + Matter | Wi-Fi (Shelly, ESPHome) | Bluetooth LE | Proprietär (Homematic IP, Somfy, Hue Bridge) |
|---|---|---|---|---|---|
| Lokal in HA | ✔ vollständig | ✔ (Border Router + Matter-Server) | meist ✔ (Shelly lokal) | ✔ (mit Proxy) | unterschiedlich, oft Cloud/Community |
| Batteriegeräte | sehr gut | sehr gut | ungeeignet | gut | gut |
| Gerätewahl/Reife | **am größten** | wächst stark (IKEA 2026 komplett Matter) | gut | mittel | an Hersteller gebunden |
| Preis | niedrig | niedrig (IKEA) bis mittel | mittel | mittel | mittel–hoch |

**Entscheidung:** **Zigbee als Hauptnetz**, **Thread/Matter gezielt** (IKEA-Neuheiten 2026, ggf. Schloss/tado X), **Wi-Fi nur wo nötig** (Shelly-Aktoren – nur durch Elektrofachkraft –, Präsenzsensoren mit Zonen, Saugroboter), **keine proprietären Hubs** beim Neustart. Netzbetriebene Zigbee-Steckdosen früh verteilen (Mesh-Router).

## 5. Geräteklassen

| Kategorie | Empfehlung (Protokoll) | Beispiele, Preis | Einbindung in HA | Hinweise |
|---|---|---|---|---|
| Licht, Taster | Leuchtmittel Zigbee oder Matter-Thread; Funktaster | IKEA KAJPLATS E27 4,99 € BELEGT (DE), IKEA BILRESA 5,99 € BELEGT (DE) ([Quelle](https://www.smarthomeassistent.de/matter-produkte-ikea-korrigiert-ueberraschend-die-preise/)); Hue-Bridge Pro ~150 € | ZHA/Matter/Hue lokal | mieterfreundlich; IKEA-Thread-Fernbedienungen noch ohne direkte Bindings ◐ |
| Unterputz-Schalter/Dimmer | Shelly Gen3/Gen4 im **Wi-Fi-Modus** | Shelly 1PM Mini Gen4 ~22 €, Dimmer Gen3 ~30 € BELEGT ([shelly.com](https://www.shelly.com/de/collections/smart-switches-dimmers)) | Shelly lokal | ⚠ **230-V-Festinstallation nur durch Elektrofachkraft** (§ 106 GewO), Vermieter fragen, Rückbau einplanen |
| Fenster-/Türkontakte | Zigbee oder Matter-Thread | IKEA MYGGBETT 7,99 € BELEGT ([techtest](https://techtest.org/ikea-myggbett-home-assistant-im-test-matter-tuer-sensor-fuer-799e/)); SONOFF SNZB-04P ~10–15 € SCHÄTZUNG | ZHA / Matter | IKEA PARASOLL: Berichte über kurze Batterielaufzeit ◐ |
| Rollos | Akku-Rollos (Zigbee/Matter) oder Shelly 2PM (Cover-Modus) für vorhandene Motoren | Shelly 2PM Gen4 ~30 € BELEGT; IKEA-Rollos: Verfügbarkeit/Preis ZU PRÜFEN | ZHA / Shelly; Somfy nur über Overkiz (meist Cloud) | Shelly: Elektrofachkraft; Akku-Rollos oft Bohrlöcher |
| **Türschloss ⚠** | Nuki Smart Lock Pro (5. Gen.), lokal per MQTT oder Matter-Thread | ~230–270 € BELEGT (DE, [mydealz](https://www.mydealz.de/magazin/?p=52978)); Bundle mit Keypad ~359 € | [Nuki](https://www.home-assistant.io/integrations/nuki/) / MQTT / Matter | **sicherheitskritisch**: Zylinder mit Not-/Gefahrenfunktion, mechanischer Notschlüssel, kein Auto-Öffnen, Hausverwaltung (Schließanlage) und Haushaltsversicherung vorher fragen; Matter-Kopplung mit ZBT-2 laut [Nuki-Forum](https://developer.nuki.io/t/nuki-pro-gen-5-ha-matter/40332) problematisch → MQTT als Weg |
| Bewegung/Präsenz | PIR (Flur), mmWave (Wohn-/Schlafzimmer) | IKEA VALLHORN ~10 € BELEGT (Startpreis), SONOFF SNZB-06P ~17,58 € BELEGT, Aqara FP1E ~44–50 € BELEGT, Everything Presence Lite 39,99 € BELEGT | ZHA / ESPHome | mmWave: Fehlalarme durch Ventilator/Vorhang; Zonen einstellen |
| Saugroboter | Roborock (Core-Integration) oder Valetudo-fähiges Modell (z. B. Dreame) | Preise modellabhängig (UNBEKANNT) | [Roborock](https://www.home-assistant.io/integrations/roborock): Steuerung lokal, Cloud-Anmeldung nötig ◐; Valetudo komplett lokal | Valetudo/Rooten = Eigenrisiko (Garantie) |
| Klima/Luft | Zigbee-Thermometer, IKEA Thread-Sensoren, CO₂ | SONOFF SNZB-02P ~17 €, IKEA TIMMERFLOTTE 9,99 €, IKEA ALPSTUGA (CO₂+PM2.5) 29,99 € BELEGT (DE); Aranet4 (BLE, NDIR) ~199 € | ZHA / Matter / Aranet (BLE) | ALPSTUGA-CO₂ laut Testern ungenau, aber zum Lüften brauchbar ◐ |
| Heizung | Heizkörperthermostate Zigbee (**nicht für deine Fußbodenheizung** – dort zuerst nur messen, [D12](DECISIONS.md)) | SONOFF TRVZB ~22–29 € BELEGT ([Quelle](https://www.smarthomeassistent.de/deal-sonoff-trvzb-thermostat-im-angebot/)); Aqara E1 ~50 €; tado X (Thread/Matter, Preis UNBEKANNT) | ZHA / Matter | Ventilhersteller prüfen (M30×1,5 / Danfoss-Adapter); Fußbodenheizung = Haustechnik, Hausverwaltung; Frostschutz-Untergrenze |
| Wasserleck | Zigbee oder Matter-Thread | SONOFF SNZB-05P ~20 €, IKEA KLIPPBOK ~7–9 € BELEGT | ZHA / Matter | unter Spüle, Waschmaschine, Geschirrspüler |
| **Rauchmelder ⚠** | zertifizierte **EN-14604**-Melder als Basis; smarte Melder nur **zusätzlich** | Frient SMSZB-120 (Zigbee, EN 14604 lt. Händler) ~51–64 € BELEGT | ZHA | Pflicht je Bundesland (OIB-RL 2, Bauordnungen); bei Mietwohnungen oft Vermieter zuständig – vorhandene Melder nicht entfernen |
| Steckdosen/Energie | Zigbee-Zwischenstecker mit Messung (Mesh-Router) | SONOFF S60ZBTPF ~15 € BELEGT; Shelly Plug S Gen3 ~17–24 € BELEGT | ZHA / Shelly | Last beachten (Shelly Plug S 12 A); ganze Wohnung: Smart-Meter-Kundenschnittstelle (z. B. Wiener Netze: im Portal aktivieren, IR-Lesekopf – [Factsheet](https://wienernetze.at/o/document/wn-sm-factsheet-kundenschnittstelle)) |

Vollständige Recherche mit allen Quellen, Zwischenwerten und offenen Punkten: Grundlage dieses Dokuments ist die Recherche vom 2026-10-16; offene Punkte stehen in [DECISIONS.md](DECISIONS.md).

## 6. Starter-Liste Wohnzimmer + Schlafzimmer + Flur (SCHÄTZUNG)
3+2+1 KAJPLATS, 2 BILRESA, 1 SNZB-06P, 1 ALPSTUGA + Netzteil, 2 TRVZB, 3 MYGGBETT + Akkus, 2 S60ZBTPF, 1 SNZB-02P, 1 VALLHORN + Akkus, 1 Frient-Rauchmelder (ergänzend) → **≈ 300 €** zusätzlich zur Zentrale. Mit Nuki Pro + Keypad **≈ 620–670 €**. Nicht enthalten: Elektrofachkraft, Saugroboter, Rollos, Energiemessung der Wohnung.

**Gesamtbudget (Schätzung):** Zentrale ~290 € + Geräte ~300 € ≈ **~590 €** (ohne Schloss), laufend ~5 €/Jahr Strom + optional ~75 €/Jahr Fernzugriff-Abo.
