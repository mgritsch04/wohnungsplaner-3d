# Smart Home – Entscheidungen

_Stand: 2026-10-16._ Format: Entscheidung · Alternativen · Begründung · Status (`VORGESCHLAGEN` = wartet auf dich, `VORLÄUFIG` = von dir vorläufig bestätigt, änderbar, `ENTSCHIEDEN`).

| # | Entscheidung | Alternativen | Begründung | Status |
|---|---|---|---|---|
| D1 | **Home Assistant** als Zentrale | openHAB, ioBroker, Homey Pro, Apple Home/Google Home | größte Geräteunterstützung, lokal, aktive Entwicklung, gute APIs für den Planer; openHAB/ioBroker ähnlich mächtig, aber kleinere Community bei Matter/Zigbee-Neuheiten; Homey/Apple/Google weniger offen bzw. Cloud-/Ökosystembindung | VORLÄUFIG (dein Ja, #28) |
| D2 | **HAOS auf Home Assistant Green** | Pi 5 + SSD, N150-Mini-PC | sparsam, lautlos, offiziell, kein SD-Verschleiß; Pi 2026 nicht billiger; Mini-PC nur bei Kameras/lokaler Sprach-KI | OFFEN (#28: Raspberry Pi selbst kaufen prüfen – Vergleich unten) |
| D3 | **Zigbee (ZHA, ZBT-2) als Hauptnetz**, Thread/Matter gezielt | nur Matter; Zigbee2MQTT; Homematic IP | Reife, Preis, Auswahl; ZHA einfacher und mit Migrationsassistent; Z2M nur bei Bedarf | VORLÄUFIG (#28: „machen wir mal so“) |
| D4 | Thread-Border-Router: **zweiter ZBT-2** – oder vorhandenes Apple/Google-Gerät | Multiprotokoll auf einem Stick | Multiprotokoll offiziell nicht empfohlen | VORLÄUFIG (#28: „ja Stick“ – zweiter ZBT-2, erst bei Kauf von Thread-Geräten) |
| D5 | **Fernzugriff per VPN oder Home Assistant Cloud**, nie Portfreigabe | Reverse Proxy | Sicherheit, CG-NAT | VORLÄUFIG (#28: VPN; Cloud-Abo nur als Ausweichlösung) |
| D6 | **Backups 3-2-1**, verschlüsselt, halbjährlicher Restore-Test | nur lokal | Ausfallsicherheit | VORLÄUFIG (#28: Backups ja) |
| D7 | **Netz flach** (kein IoT-VLAN zu Beginn), Problemgeräte ins Gastnetz | VLANs mit mDNS-Reflektor | Matter/Thread brauchen mDNS/IPv6; FRITZ!Box ohne VLAN | VORLÄUFIG (#28: flach) |
| D8 | Planer-Anbindung erst **lesend über Backend-Bridge**, kein Token im Browser | HA-Login direkt aus dem Planer | Langzeit-Tokens = volle Rechte; Nicht-Admins können alle Aktionen ausführen | ENTSCHIEDEN (Sicherheitsgrundsatz); Anbindung selbst „später vielleicht“ (#28) |
| D9 | Planer: **simulierte Geräte zuerst** (Roadmap P2–P4) | sofort Live-Anbindung | Nutzen ohne Hardware, keine Sicherheitsrisiken | VORLÄUFIG (#28: „Simulieren passt“; im Backlog weiter hinten) |
| D10 | Türschloss **optional und zuletzt** | sofort | sicherheitskritisch, Vermieter/Versicherung | offen (#28: „lassen wir noch offen“) |
| D11 | Keine Arbeiten an 230 V ohne **Elektrofachkraft** | Selbstmontage | Rechtslage Österreich (§ 106 GewO), Sicherheit | ENTSCHIEDEN |

## Offene Fragen an dich
1. **Q1 Budget:** Rahmen für Zentrale + Erstausstattung (Vorschlag ~590 € ohne Schloss)?
2. **Q2 Vorhandene Geräte:** HomePod mini / Apple TV 4K / Google Nest Hub? (dann kein zweiter Thread-Stick). Welcher Router (FRITZ!Box-Modell)? NAS vorhanden?
3. **Q3 Wohnung:** Miete oder Eigentum? Heizkörper (Ventilhersteller) oder Fußbodenheizung? Elektrische Rollläden vorhanden? Netzbetreiber/Smart Meter (z. B. Wiener Netze)?
4. **Q4 Fernzugriff:** Abo (einfach, ~75 €/Jahr, vor Abschluss Preis prüfen) oder VPN (kostenlos, etwas mehr Aufwand)?
5. **Q5 Schloss:** gewünscht? Hausverwaltung/Schließanlage und Haushaltsversicherung schon gefragt?
6. **Q6 Sprachsteuerung/Kameras** geplant? (entscheidet Green vs. Mini-PC)
7. **Q7 Priorität im Planer:** sollen simulierte Smart-Home-Geräte (P2) vor anderen Planer-Themen kommen?

## Deine Rückmeldung (2026-10-16, Issue #28) – vorläufig, jederzeit änderbar
- **Q1 Budget:** offen („mal schauen“). **Q2 Geräte:** altes Echo Dot und eine Philips-Lampe – nichts davon soll Voraussetzung sein. **Q3 Wohnung:** Miete, Fußbodenheizung, keine elektrischen Rollläden (Nachrüstung evtl. möglich). **Q5 Schloss:** offen. **Q6:** Sprachsteuerung ja, Kameras offen. **Q7:** simulierte Smart-Home-Geräte im Planer **nicht** vorrangig – weiter hinten einreihen.

## Deine Rückmeldung (2026-10-16, zweite Runde, Issue #28)
- **D2:** klären, ob ein selbst gekaufter Raspberry Pi nicht besser ist → Vergleich unten, Entscheidung offen. **D4:** zweiter Stick. **D5:** VPN. **D7:** flach. **D8:** Anbindung später vielleicht. **D9:** Simulation passt.

## Erklärungen zu deinen Rückfragen
- **D2 Raspberry Pi 5 selbst kaufen oder Home Assistant Green?** Beides läuft mit demselben HAOS; der Unterschied ist Aufwand und Leistung, nicht die Funktion.
  - *Raspberry Pi 5* braucht zusätzlich: offizielles USB-C-Netzteil (27 W), Gehäuse mit Kühlung, und als Speicher besser eine SSD (per NVMe-Aufsteckplatine oder USB) statt einer SD-Karte, weil SD-Karten bei dauerndem Schreiben verschleißen. Vorteil: deutlich mehr Rechenleistung und mehr Arbeitsspeicher (wichtig, wenn später viele Add-ons oder lokale Sprachverarbeitung dazukommen), und du kannst Teile wiederverwenden, die du schon hast. Nachteil: Zusammenbau, Installation von HAOS selbst, mehr Fehlerquellen.
  - *Home Assistant Green* ist fertig: HAOS vorinstalliert, interner Speicher, passiv gekühlt, offiziell unterstützt – einstecken, fertig. Weniger Leistung als ein Pi 5, für Licht, Sensoren, Heizung und Automationen aber ausreichend.
  - *Kosten:* Ein Pi 5 ist erst mit Netzteil, Gehäuse und SSD vergleichbar ausgestattet – zusammengerechnet meist nicht billiger als Green. Bitte die aktuellen Preise vor dem Kauf vergleichen; ich nenne bewusst keine Zahlen, weil sie schwanken.
  - *Empfehlung:* Green, wenn es einfach laufen soll. Pi 5 (mit SSD), wenn du gerne bastelst, Teile schon hast oder später lokale Sprachsteuerung willst – dafür ist der Pi 5 die stärkere Wahl als Green.
- **D2 „HAOS ist einfach das Betriebssystem von Home Assistant?“** – Ja. HAOS ist das fertige Betriebssystem, auf dem Home Assistant läuft. Die Entscheidung D2 betrifft vor allem die **Hardware**, auf der HAOS läuft: *Home Assistant Green* (fertiges Gerät, HAOS vorinstalliert, einstecken und loslegen) statt Raspberry Pi oder Mini-PC. Bei Sprachsteuerung mit lokaler Spracherkennung oder Kameras wäre später ein stärkerer Mini-PC sinnvoll – Sprachsteuerung über Cloud-Dienste läuft auch auf Green.
- **D4 Thread-Border-Router:** Viele neue Matter-Geräte funken per *Thread*. Damit Home Assistant sie erreicht, braucht es eine „Brücke“ ins Heimnetz (Border-Router). Das kann ein zweiter Funkstick (ZBT-2) sein oder ein vorhandenes Gerät mit eingebautem Border-Router (z. B. HomePod mini, Apple TV 4K, Nest Hub, manche neueren Echo-Modelle). Ob dein Echo Dot das kann, hängt von der Generation ab – da du nichts davon abhängig machen willst, ist der zweite Stick die unabhängige Lösung; er wird erst gebraucht, wenn du Thread-Geräte kaufst.
- **D5 Fernzugriff:** *Home Assistant Cloud* ist ein Abo (ca. 75 €/Jahr, Preis vor Abschluss prüfen); dafür sehr einfach, ohne Router-Einstellungen, und es finanziert die Entwicklung. *VPN* ist kostenlos: z. B. WireGuard direkt in der FRITZ!Box (neuere FRITZ!OS-Versionen) oder das Tailscale-Add-on. Aufwand: ca. 15–30 min einmalig, App am Handy. Risiken/Grenzen: Manche Internetanschlüsse (CG-NAT/DS-Lite) erlauben keine eingehende Verbindung – dann geht nur Tailscale oder die Cloud; ein falsch eingerichteter Zugang ist ein Sicherheitsrisiko, deshalb **nie** Ports direkt freigeben. Empfehlung: zuerst VPN probieren, Cloud als einfache Alternative.
- **D7 Netz flach:** „Flach“ heißt: Smart-Home-Geräte hängen im normalen WLAN wie Handy und Laptop. Die Alternative wäre ein eigenes, abgeschottetes Netz (VLAN) nur für Smart-Home-Geräte – sicherer, aber komplizierter und mit Matter/Thread oft problematisch; die FRITZ!Box kann das nur eingeschränkt (Gastnetz). Vorschlag: flach starten, einzelne „verdächtige“ Billiggeräte ins Gastnetz.
- **D8 „Netz im Planer steuern?“** – Nein, gemeint ist etwas anderes: Ob und wie der Planer später **Zustände** aus Home Assistant anzeigen darf (z. B. „Licht Wohnzimmer ist an“). Grundsatz: Der Planer bekommt dafür nie direkt einen Home-Assistant-Schlüssel im Browser, sondern geht über einen kleinen Vermittler-Dienst. Das ist Zukunft; aktuell nur Simulation – passt zu deinem Wunsch.
- **D9 Simulation zuerst:** Im Planer werden Geräte (Melder, Lampen, Schalter) zuerst nur *simuliert* platziert und getestet – ohne echte Hardware und ohne Risiko. Eine echte Verbindung kommt, wenn überhaupt, erst danach. Da du Q7 „weiter hinten“ gewählt hast, bleibt das im Backlog nach den Planer-Themen.
