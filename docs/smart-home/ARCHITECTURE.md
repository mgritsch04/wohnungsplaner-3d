# Smart Home – Architektur

_Stand: 2026-10-16 · Status: **PLANNED** (Konzept, nichts installiert)._
Quellen: offizielle Home-Assistant-Dokumentation (geprüft über deren Quelltexte auf GitHub, da die Webseiten aus der Rechercheumgebung nicht direkt abrufbar waren). Kennzeichnung: ✔ = in offizieller Quelle geprüft · ◐ = Sekundärquelle · ✘ = nicht geprüft, Annahme.

## 1. Überblick

```
                 Internet (optional)
                        │  VPN / Home Assistant Cloud (kein offener Port)
┌──────────────────── Heimnetz (LAN, IPv6 lokal aktiv) ─────────────────────────┐
│                                                                               │
│  Router (z. B. FRITZ!Box)          Handy: Companion App (Matter-Inbetriebnahme, │
│        │                                  Benachrichtigungen)                  │
│  ┌─────┴───────────────────────────────┐                                      │
│  │ Home-Assistant-Host (HAOS)          │   Wohnungsplaner (Browser-App)        │
│  │  ├─ Core: Integrationen, Automationen│◄── später: „Planner Bridge“ (§5)     │
│  │  ├─ ZHA ──► Zigbee-Funk (USB, Verl.)│                                      │
│  │  ├─ Matter Server (App)             │                                      │
│  │  ├─ OpenThread Border Router (App)* │                                      │
│  │  ├─ ESPHome-Geräte, BT-Proxies      │                                      │
│  │  └─ Backups → lokal / NAS / Cloud   │                                      │
│  └─────────────────────────────────────┘                                      │
│        Zigbee-Netz (Licht, Sensoren, Kontakte, Steckdosen, Thermostate)        │
│        Thread-Netz (Matter-over-Thread-Geräte, z. B. Schloss)                  │
│        Wi-Fi-Geräte (Shelly, Saugroboter, Präsenzsensor)                       │
└───────────────────────────────────────────────────────────────────────────────┘
 * Thread entweder über einen zweiten Funkstick am HA-Host oder über einen vorhandenen
   Border Router (Apple/Google) – siehe HARDWARE_AND_DEVICES.md.
```

## 2. Komponenten

| Ebene | Wahl | Begründung |
|---|---|---|
| Betriebssystem | **Home Assistant OS** auf eigener Hardware ✔ | Einzige Variante mit Apps (früher „Add-ons“), Ein-Klick-Updates und vollem Backup. „Supervised“ und „Core“ sind seit 2025.6 abgekündigt ◐, nur noch 64-Bit-Systeme. Container-Variante ohne Apps (Thread/Matter brauchen Apps) ✔ |
| Zigbee | **ZHA** (integriert) mit eigenem Koordinator-Stick ✔ | Einfach, UI-geführt, automatische Netzwerk-Backups und Migrationsassistent für Koordinatorwechsel ✔. Zigbee2MQTT nur bei Bedarf an exotischen Geräten (braucht MQTT-Broker) |
| Matter | **Matter Server App** ✔ | Inbetriebnahme nur über die Companion App (Bluetooth am Handy) ✔ |
| Thread | **OpenThread Border Router App** auf eigenem Funkstick oder fremder Border Router ✔ | Thread-Netzdaten speichert HA, nicht der Stick ✔ |
| Wi-Fi-Geräte | lokale Integrationen (z. B. Shelly) | ohne Cloud steuerbar |
| Bluetooth | ESPHome-Bluetooth-Proxies (ESP32, möglichst mit Ethernet) ✔ | Reichweite für BLE-Sensoren |
| Fernzugriff | **Home Assistant Cloud (Nabu Casa)** oder **VPN** (WireGuard/Tailscale) ✔ | kein offener Port; funktioniert auch hinter CG-NAT ✔ |
| Backups | eingebautes Backup-System (seit 2025.1), verschlüsselt, mehrere Ziele ✔ | siehe [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md) |

## 3. Datenmodell in Home Assistant ✔
Integration → **Gerät** → **Entitäten** (z. B. Steckdose = Schalter + Leistungssensor). Geräte/Entitäten liegen in genau einem **Bereich** (Area = Raum); Bereiche gehören zu **Etagen** (Floor). **Labels** markieren quer (z. B. „sicherheitskritisch“). Darauf bauen **Szenen** (Soll-Zustände), **Skripte** (Abläufe), **Automationen** (Auslöser → Bedingungen → Aktionen) und **Blueprints** (Vorlagen). „Services“ heißen in der Oberfläche jetzt „Actions“; die API-Namen bleiben (`call_service`).

**Konvention für dieses Projekt:** HA-Bereiche heißen wie die Räume im Wohnungsplaner; Etage = Wohnung. Das ermöglicht später die automatische Zuordnung (siehe [APARTMENT_PLANNER_INTEGRATION.md](APARTMENT_PLANNER_INTEGRATION.md)).

## 4. Lokal vs. Cloud

| Funktion | lokal | Cloud nötig |
|---|---|---|
| Zigbee-, Thread/Matter-Geräte, Shelly, ESPHome | ✔ | – |
| Automationen, Szenen, Dashboards im Heimnetz | ✔ | – |
| Fernzugriff | VPN ✔ | Home Assistant Cloud (optional) |
| Sprachassistenten Alexa/Google | – | ja (Cloud-Dienste) |
| Saugroboter je nach Marke | teilweise | z. B. Roborock: Anmeldung über Cloud, Steuerung lokal ◐ (siehe Geräte-Dokument) |
| Off-site-Backup | NAS ✔ | Cloud/OneDrive/Google Drive (optional) |

**Ziel:** Alles Wesentliche (Licht, Heizung, Sicherheit) funktioniert ohne Internet. Cloud-abhängige Geräte nur, wo es keine sinnvolle lokale Alternative gibt.

## 5. Schnittstellen und Integrationsgrenzen
* **WebSocket-API** `ws(s)://<host>/api/websocket` ✔: Anmeldung mit Token, `get_states`, `subscribe_entities`, `subscribe_events`, `call_service`; Registries `config/area_registry/list`, `config/floor_registry/list`, `config/device_registry/list`, `config/entity_registry/list_for_display` – **lesen ohne Admin-Rechte**, Ändern nur als Admin ✔.
* **REST-API** ✔: `GET /api/states`, `POST /api/services/<domain>/<service>` usw.; Bereiche/Etagen nur über WebSocket.
* **Anmeldung für Web-Apps** ✔: HA-eigener Login-Ablauf (`/auth/authorize` → `/auth/token`, `client_id` = URL der App), kurzlebige Tokens (30 min) + Refresh-Token, widerrufbar; Browser-Zugriff braucht `http: cors_allowed_origins`.
* **Wichtig** ✔: Langzeit-Tokens gelten 10 Jahre und haben die **vollen Rechte** des Benutzers; Nicht-Admin-Benutzer können trotzdem **alle Aktionen** auslösen (keine Entitäts-Rechte in der Oberfläche). Eine echte Beschränkung muss deshalb ein vorgeschalteter Dienst leisten.
* **Grenze zum Wohnungsplaner:** Der Planer bleibt Quelle der Wahrheit für Geometrie; HA für Gerätezustände. Planer speichert nur HA-IDs (Area/Device/Entity), nie Zugangsdaten. Details und Varianten: [APARTMENT_PLANNER_INTEGRATION.md](APARTMENT_PLANNER_INTEGRATION.md) §6, Sicherheit: [SECURITY_AND_NETWORK.md](SECURITY_AND_NETWORK.md).

## 6. Datenflüsse
1. Gerät → Funk (Zigbee/Thread/Wi-Fi) → Integration → Zustand in HA → Recorder-Datenbank (Verlauf, Standard 10 Tage ✔).
2. Automation: Ereignis → Bedingungen → Aktion → Gerät.
3. Backup: täglich → lokal + NAS + extern (verschlüsselt).
4. Später Planer: Bridge abonniert Zustände (nur freigegebene Entitäten) → Planer zeigt sie; Aktionen nur über Freigabeliste.

## 7. Betrieb
Monatliche HA-Version (Patch-Releases dazwischen) ✔ – Ablauf: Hinweise zu „Backward-incompatible changes“ lesen → Backup → Update (nicht am ersten Tag) → Reparaturen/Protokolle prüfen. Datenbank klein halten (häufige Leistungs-/Signalwerte vom Recorder ausschließen ✔). Ausfallmeldungen per Companion App. Details: [INSTALLATION_AND_SETUP.md](INSTALLATION_AND_SETUP.md) §6.
