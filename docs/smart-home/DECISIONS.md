# Smart Home – Entscheidungen

_Stand: 2026-10-16._ Format: Entscheidung · Alternativen · Begründung · Status (`VORGESCHLAGEN` = wartet auf dich, `ENTSCHIEDEN`).

| # | Entscheidung | Alternativen | Begründung | Status |
|---|---|---|---|---|
| D1 | **Home Assistant** als Zentrale | openHAB, ioBroker, Homey Pro, Apple Home/Google Home | größte Geräteunterstützung, lokal, aktive Entwicklung, gute APIs für den Planer; openHAB/ioBroker ähnlich mächtig, aber kleinere Community bei Matter/Zigbee-Neuheiten; Homey/Apple/Google weniger offen bzw. Cloud-/Ökosystembindung | VORGESCHLAGEN |
| D2 | **HAOS auf Home Assistant Green** | Pi 5 + SSD, N150-Mini-PC | sparsam, lautlos, offiziell, kein SD-Verschleiß; Pi 2026 nicht billiger; Mini-PC nur bei Kameras/lokaler Sprach-KI | VORGESCHLAGEN |
| D3 | **Zigbee (ZHA, ZBT-2) als Hauptnetz**, Thread/Matter gezielt | nur Matter; Zigbee2MQTT; Homematic IP | Reife, Preis, Auswahl; ZHA einfacher und mit Migrationsassistent; Z2M nur bei Bedarf | VORGESCHLAGEN |
| D4 | Thread-Border-Router: **zweiter ZBT-2** – oder vorhandenes Apple/Google-Gerät | Multiprotokoll auf einem Stick | Multiprotokoll offiziell nicht empfohlen | offen (hängt von Frage Q2 ab) |
| D5 | **Fernzugriff per VPN oder Home Assistant Cloud**, nie Portfreigabe | Reverse Proxy | Sicherheit, CG-NAT | offen (Q4) |
| D6 | **Backups 3-2-1**, verschlüsselt, halbjährlicher Restore-Test | nur lokal | Ausfallsicherheit | VORGESCHLAGEN |
| D7 | **Netz flach** (kein IoT-VLAN zu Beginn), Problemgeräte ins Gastnetz | VLANs mit mDNS-Reflektor | Matter/Thread brauchen mDNS/IPv6; FRITZ!Box ohne VLAN | VORGESCHLAGEN |
| D8 | Planer-Anbindung erst **lesend über Backend-Bridge**, kein Token im Browser | HA-Login direkt aus dem Planer | Langzeit-Tokens = volle Rechte; Nicht-Admins können alle Aktionen ausführen | ENTSCHIEDEN (Sicherheitsgrundsatz) |
| D9 | Planer: **simulierte Geräte zuerst** (Roadmap P2–P4) | sofort Live-Anbindung | Nutzen ohne Hardware, keine Sicherheitsrisiken | VORGESCHLAGEN |
| D10 | Türschloss **optional und zuletzt** | sofort | sicherheitskritisch, Vermieter/Versicherung | offen (Q5) |
| D11 | Keine Arbeiten an 230 V ohne **Elektrofachkraft** | Selbstmontage | Rechtslage Österreich (§ 106 GewO), Sicherheit | ENTSCHIEDEN |

## Offene Fragen an dich
1. **Q1 Budget:** Rahmen für Zentrale + Erstausstattung (Vorschlag ~590 € ohne Schloss)?
2. **Q2 Vorhandene Geräte:** HomePod mini / Apple TV 4K / Google Nest Hub? (dann kein zweiter Thread-Stick). Welcher Router (FRITZ!Box-Modell)? NAS vorhanden?
3. **Q3 Wohnung:** Miete oder Eigentum? Heizkörper (Ventilhersteller) oder Fußbodenheizung? Elektrische Rollläden vorhanden? Netzbetreiber/Smart Meter (z. B. Wiener Netze)?
4. **Q4 Fernzugriff:** Abo (einfach, ~75 €/Jahr, vor Abschluss Preis prüfen) oder VPN (kostenlos, etwas mehr Aufwand)?
5. **Q5 Schloss:** gewünscht? Hausverwaltung/Schließanlage und Haushaltsversicherung schon gefragt?
6. **Q6 Sprachsteuerung/Kameras** geplant? (entscheidet Green vs. Mini-PC)
7. **Q7 Priorität im Planer:** sollen simulierte Smart-Home-Geräte (P2) vor anderen Planer-Themen kommen?
