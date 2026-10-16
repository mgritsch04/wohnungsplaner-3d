# Smart Home – Gesamtkonzept

_Stand: 2026-10-16 · Status: **Konzept** (nichts gekauft, nichts installiert, keine Live-Steuerung im Planer) · Issue #134._

Dieses Dokument fasst das Smart-Home-Konzept für **deine Wohnung** zusammen: was es können soll, welche Geräte und Produkte, wie sie zusammenspielen und in welchen Schritten es umgesetzt wird. Die Details stehen in den Einzeldokumenten ([README](README.md)); dieses Dokument verweist darauf und ergänzt, was für deine Wohnung gilt.

**Kennzeichnung:** **Deine Angabe** = von dir in #28 so beantwortet (vorläufig, änderbar) · **Vorschlag (Standard)** = von mir vorbelegt, weil keine Angabe von dir vorliegt; gilt, bis du etwas anderes sagst · **Offen** = lässt sich nicht sinnvoll vorbelegen (Kauf, Vermieter). Alle Entscheidungen mit Begründung: [DECISIONS.md](DECISIONS.md).

## 1. Ausgangslage (deine Angaben aus #28)
* Mietwohnung, **Fußbodenheizung**, keine elektrischen Rollläden (Nachrüstung evtl. möglich).
* Vorhanden: altes Echo Dot, eine Philips-Lampe – **nichts davon soll Voraussetzung sein**.
* **Sprachsteuerung gewünscht**, Kameras offen, Türschloss offen.
* Zentrale Home Assistant, Zigbee als Hauptnetz, Fernzugriff per VPN, Netz flach, Backups – alle vorläufig bestätigt.
* Im Planer **nur simulieren**; Smart-Home im Planer ist **nicht vorrangig** (weiter hinten im Backlog).

## 2. Zielbild

| Funktion | Real (Home Assistant) | Im Planer |
|---|---|---|
| Licht nach Raum, Szenen (Hell, Abend, Nacht, Aus) | ✔ Phase A3 | simuliert (Phase P4): Szene schaltet Lampen in 3D |
| Flurlicht per Bewegung, nachts gedimmt | ✔ A3 | simuliert: Bewegungsmelder mit Erfassungskegel, Abdeckung je Raum (P3) |
| Fenster offen → Hinweis „Heizung/Lüften“ | ✔ A4 | Kontakt an Fenster gebunden (P2/P3) |
| Raumklima: Temperatur, Feuchte, CO₂ mit Lüftungshinweis | ✔ A3/A4 | Sensorpositionen planen (P2) |
| Wasserleck unter Spüle/Waschmaschine → Push | ✔ A3 | Position planen (P2) |
| Steckdosen schalten und Verbrauch messen | ✔ A3 | Position planen (P2) |
| Sprachsteuerung (Licht, Szenen) | ✔ A4 | – |
| Heizung (Fußbodenheizung) | **nur messen**, steuern erst nach Freigabe der Hausverwaltung (siehe §4) | – |
| Rollos, Türschloss, Kameras | später / optional | – |
| Live-Zustände aus Home Assistant im Planer | optional, frühestens P5, nur lesend über Vermittler-Dienst | – |

**Simuliert vs. live:** Alles im Planer ist zunächst Simulation (eigene Geräte-Objekte, Zustände nur im Projekt). Eine Live-Anbindung gibt es nur optional später (P5, lesend), nie mit Zugangsschlüssel im Browser ([D8](DECISIONS.md)).

## 3. Zentrale – Vorschlag (Standard): Home Assistant Green
* **Home Assistant Green** mit vorinstalliertem HAOS, 179,90 € ([Shelly-Shop](https://www.shelly.com/de/products/home-assistant-green), Preis vor Kauf prüfen), ~1,7 W, lautlos.
* **Warum nicht Raspberry Pi 5?** Komplett ausgestattet (Netzteil, Kühlung, SSD) nicht billiger (~198 € Schätzung, [HARDWARE_AND_DEVICES.md](HARDWARE_AND_DEVICES.md) §1) und mehr Bastelaufwand. Der Pi lohnt sich nur, wenn Sprache **frei** und komplett lokal erkannt werden soll (Whisper) – dafür ist aber eher ein N150-Mini-PC sinnvoll.
* **Sprachsteuerung auf Green:** Home Assistant gibt für die lokale Spracherkennung *Speech-to-Phrase* an, dass sie auch auf Green bzw. Raspberry Pi 4 in unter einer Sekunde erkennt – allerdings nur die unterstützten Befehle (Licht, Szenen, Rollos …), keine freie Sprache ([Übersicht esp32.co.uk](https://esp32.co.uk/home-assistant-local-voice-and-ai-green-vs-n150-n305-mini-pc/)). Für eine Wohnung reicht das.
* Funk: **Connect ZBT-2** (Zigbee, 45 €, [HA-Blog](https://www.home-assistant.io/blog/2025/11/19/home-assistant-connect-zbt-2)) an USB-Verlängerung; zweiter ZBT-2 für Thread erst, wenn Thread-Geräte gekauft werden ([D4](DECISIONS.md)).
* **Kosten Zentrale:** ~243 € ohne, ~288 € mit zweitem ZBT-2 (Schätzung aus belegten Einzelpreisen, [HARDWARE_AND_DEVICES.md](HARDWARE_AND_DEVICES.md) §3), Strom ~5 €/Jahr, Fernzugriff per VPN 0 €.

## 4. Geräte je Funktion – Vorschlag (Standard)
Produkte und Preise stammen aus [HARDWARE_AND_DEVICES.md](HARDWARE_AND_DEVICES.md) §5 (dort mit Quellen, Stand 2026-10-16; Preise vor Kauf prüfen). Auswahlregel: mieterfreundlich (kein Eingriff in 230 V), lokal in Home Assistant, Zigbee bevorzugt.

| Funktion | Gerät | Produkt (Funk) | Preis | Begründung |
|---|---|---|---|---|
| Licht | smarte Leuchtmittel | IKEA KAJPLATS E27 (Matter/Thread) oder Zigbee-Leuchtmittel; vorhandene Philips-Lampe optional | 4,99 € | mieterfreundlich, kein Elektriker; Thread erst mit zweitem Stick |
| Schalter | Funktaster statt Unterputz | IKEA BILRESA (Matter/Thread) | 5,99 € | klebbar neben vorhandene Schalter; Unterputz-Aktoren (Shelly) nur durch Elektrofachkraft ([D11](DECISIONS.md)) |
| Bewegung Flur | PIR-Melder | IKEA VALLHORN (Zigbee) | ~10 € | günstig, batteriebetrieben, schnell für Licht |
| Präsenz Wohn-/Schlafzimmer | mmWave | SONOFF SNZB-06P (Zigbee) | ~17,58 € | erkennt auch Stillsitzen; Zonen einstellen gegen Fehlalarme |
| Fenster/Tür | Kontakt | IKEA MYGGBETT (Matter/Thread) oder SONOFF SNZB-04P (Zigbee) | 7,99 € / ~10–15 € | Lüftungshinweis, Abwesenheit |
| Temperatur/Feuchte | Sensor je Raum | SONOFF SNZB-02P (Zigbee) | ~17 € | Grundlage für Heizungs-Auswertung und Lüften |
| CO₂ | Luftsensor Wohn- oder Schlafzimmer | IKEA ALPSTUGA (Matter/Thread) | 29,99 € | Lüftungsampel; laut Testern nicht genau, zum Lüften brauchbar |
| Wasserleck | Sensor | SONOFF SNZB-05P (Zigbee) oder IKEA KLIPPBOK | ~20 € / ~7–9 € | unter Spüle, an Waschmaschine |
| Steckdosen/Energie | Zwischenstecker mit Messung | SONOFF S60ZBTPF (Zigbee) | ~15 € | Verbrauch messen; netzbetrieben → verstärkt das Zigbee-Netz |
| Sprache | Sprachsatellit | **Home Assistant Voice Preview Edition** (Wi-Fi, ESP32-S3, Mikrofone, Lautsprecher) | UVP 59 € ([The Pi Hut](https://thepihut.com/products/home-assistant-voice-preview-edition), [CNX Software](https://cnx-software.com/2024/12/20/59-voice-preview-edition-adds-an-offline-smart-speaker-to-your-home-assistant-server)) | arbeitet direkt mit Home Assistant (Assist), lokal mit Speech-to-Phrase; das Echo Dot lässt sich nur über Umwege/Cloud anbinden und taugt nicht als lokales Mikrofon für Home Assistant (Forenberichte, [HA-Community](https://community.home-assistant.io/t/ha-on-alexa-without-nabucasa/872663)) |
| Rauchmelder | vorhandene zertifizierte Melder bleiben | smart nur **zusätzlich**: Frient SMSZB-120 (Zigbee) | ~51–64 € | Pflichtmelder nicht ersetzen |
| **Heizung (Fußbodenheizung)** | zunächst **nur messen** (Sensoren oben) | – | – | siehe unten |

**Fußbodenheizung:** Heizkörperthermostate (TRVZB u. ä.) passen nicht. Smarte Steuerung hieße Stellantriebe am Heizkreisverteiler bzw. Wand-Raumthermostate tauschen – in einer Mietwohnung ein Eingriff in die Haustechnik (Vermieter fragen; 230-V-Anschluss nur Elektrofachkraft). Dazu kommt: ob 24 V oder 230 V, Einbautiefe am Verteiler, und dass Fußbodenheizungen träge reagieren ([Forum simon42](https://community.simon42.com/t/fussbodenheizung-mit-ha-steuern/32606), [simon42 Anleitung](https://simon42.com/home-assistant-fussbodenheizung)). **Vorschlag (Standard):** erst ein Winter lang nur messen; steuern nur, wenn die Hausverwaltung zustimmt (Offen, siehe §8).

**Starter-Set (Schätzung, ohne Zentrale):** Wohnzimmer + Schlafzimmer + Flur + Küche/Bad: 6 Leuchtmittel, 2 Taster, 1 PIR, 2 mmWave, 3 Kontakte, 3 Temperatursensoren, 1 CO₂, 1 Wasserleck, 2 Zwischenstecker, 1 Voice PE ≈ **270–300 €**. Gesamt mit Zentrale ≈ **520–590 €** (Vorschlag (Standard) als Budgetrahmen; Q1 ist bei dir offen).

## 5. Zusammenspiel – Beispielregeln (Vorschlag (Standard))
1. **Flurlicht:** Bewegung im Flur → Licht an; 07–22 Uhr 100 %, nachts 15 % warmweiß; aus nach 2 min ohne Bewegung.
2. **Wohnzimmer-Präsenz:** niemand mehr da (mmWave, 10 min) → Licht und Zwischenstecker „Medien“ aus.
3. **Lüften:** CO₂ > 1 200 ppm → Hinweis aufs Handy und gelbe Szene am Leuchtmittel; Fenster offen > 15 min bei < 5 °C außen → Erinnerung „Fenster schließen“.
4. **Wasserleck:** Sensor nass → Push-Nachricht und alle Lichter blinken einmal.
5. **Abend:** Sonnenuntergang und jemand zu Hause → Szene „Abend“ (gedimmt, warmweiß).
6. **Abwesend:** alle Handys weg (Companion App) → alle Lichter aus, Hinweis falls ein Fenster offen ist.
7. **Sprache:** „Licht im Wohnzimmer aus“, „Szene Abend“ – über die Voice PE, lokal.
8. **Feuchte Bad:** Feuchte > 70 % nach dem Duschen → Lüften-Hinweis.

Regeln entstehen in Home Assistant als Automationen; im Planer werden sie in Phase P4 nur simuliert.

## 6. Umsetzung in Phasen
Ausführlich mit Abnahmekriterien in [ROADMAP.md](ROADMAP.md). Kurzfassung:

| Phase | Inhalt | Abnahme |
|---|---|---|
| A0 | Offene Punkte §8 klären, Kauf freigeben | Entscheidungen eingetragen |
| A1 | Green + ZBT-2 einrichten, Benutzer, MFA, Bereiche | HA läuft, erstes verschlüsseltes Backup wiederhergestellt getestet |
| A2 | Backups 3-2-1, VPN-Fernzugriff | Restore-Test dokumentiert, kein offener Port |
| A3 | Flur + Wohnzimmer: Licht, Melder, Sensoren, Regeln 1–4 | Regeln laufen eine Woche ohne Fehler, auch ohne Internet |
| A4 | übrige Räume, Sprache, Regeln 5–8 | je Raum Szenen + 2–3 Automationen |
| P2–P4 | Planer: simulierte Geräte, Wirkbereiche, Szenen (weiter hinten im Backlog, deine Angabe Q7) | Kriterien in ROADMAP.md |
| P5 | optional: Zustände aus HA lesend über Vermittler-Dienst | kein Token im Browser (Test prüft Bundle/Export) |

## 7. Sicherheit und Datenschutz
* **Keine Zugangsdaten im Browser-Code** und nicht im Projekt-Export; eine spätere Anbindung nur lesend über einen eigenen Vermittler-Dienst ([D8](DECISIONS.md), [SECURITY_AND_NETWORK.md](SECURITY_AND_NETWORK.md)).
* **Lokaler Betrieb bevorzugt:** Zigbee/Thread lokal, Sprache lokal (Speech-to-Phrase), Cloud nur als Ausweichlösung.
* **Netz:** flach gestartet (deine Angabe D7); Billig-WLAN-Geräte ins Gastnetz – das ist die Netz-Trennung, die mit einer FRITZ!Box ohne VLAN einfach geht. Ein eigenes IoT-VLAN erst, wenn ein Router das gut kann.
* **Fernzugriff** nur per VPN, nie Portfreigabe; MFA für alle Konten.
* **230 V** nur durch Elektrofachkraft; Türschloss optional und zuletzt.

## 8. Offen – nur das, was ich nicht vorbelegen kann (gesammelt in #28)
1. **Kauf freigeben:** Green + ZBT-2 (~243 €) und Starter-Set (~270–300 €) – oder anderer Budgetrahmen.
2. **Green oder Pi 5** (D2): Vorschlag (Standard) Green; Pi nur, wenn du gern bastelst.
3. **Fußbodenheizung:** Hausverwaltung fragen, ob Stellantriebe/Raumthermostate getauscht werden dürfen (bis dahin nur messen).
4. Schloss und Kameras bleiben offen, bis du sie brauchst – kein Kauf vorgesehen.
