# Smart Home im Wohnungsplaner – Integrationskonzept

_Stand: 2026-10-16 · Status: **nur geplant** – nichts davon ist umgesetzt._
Grundlagen: [ARCHITECTURE.md](ARCHITECTURE.md) (Home-Assistant-Seite), [SECURITY_AND_NETWORK.md](SECURITY_AND_NETWORK.md), Planer-Architektur [`../architecture.md`](../architecture.md).

## 1. Ziel
Smart-Home-Geräte sollen im 2D-Plan und in der 3D-Ansicht als eigene Objekte erscheinen: platzieren, Wirkbereiche sehen (Bewegungsmelder-Kegel, Lichtkegel, Kontakt an Fenster/Tür), Szenen und Automationen **simulieren** – und später optional mit echten Home-Assistant-Geräten verknüpft werden (zuerst nur lesend).

## 2. Leitlinien
* **Eine Quelle der Wahrheit bleibt `src/model`.** Geräte sind Teil des Projekts (Schema-Version erhöhen, Migration). Abgeleitete Darstellung (Kegel, Zonen) entsteht wie die Wandgeometrie in einer `derive…`-Funktion, nicht im Modell.
* **Planer ohne Home Assistant voll nutzbar.** Live-Anbindung ist ein optionaler Adapter (`src/smarthome/adapters/…`), analog zu den Händler-Providern; der Geometrie-Kern kennt kein HA.
* **Kein Zugangsschlüssel im Browser.** Der Planer ist eine reine Browser-App. Ein Home-Assistant-Token mit vollen Benutzerrechten darf nie im Frontend oder im Projekt-Export liegen (Details §6).
* **Simulation ≠ Realität.** Simulierte Zustände sind klar gekennzeichnet; echte Zustände tragen Zeitstempel und „veraltet“-Markierung.

## 3. Datenmodell (Entwurf)

```ts
// neues Array im Projekt: project.devices
interface SmartDevice {
  id: string;
  name: string;
  kind: 'light' | 'switch' | 'dimmer' | 'plug' | 'motion' | 'presence' | 'contact'
      | 'blind' | 'lock' | 'vacuum' | 'climate' | 'thermostat' | 'leak' | 'smoke' | 'hub' | 'other';
  // Lage im Plan (Meter, gleiche Konventionen wie Möbel)
  x: number; y: number; elevation: number; rotation: number;
  // optional: an Bauteil gebunden (Kontakt an Öffnung, Thermostat an Heizkörper, Lampe an Leuchte)
  attachedTo?: { type: 'opening' | 'furniture' | 'light' | 'wall'; id: string };
  roomId?: string;                         // für Bereiche/Areas
  size?: { width: number; depth: number; height: number };
  protocol?: 'zigbee' | 'thread' | 'matter' | 'wifi' | 'bluetooth' | 'zwave' | 'proprietary';
  product?: { brand?: string; model?: string; productUrl?: string; catalogId?: string };
  coverage?: { type: 'cone' | 'circle' | 'sector'; range: number; angleDeg?: number; heightRange?: [number, number] };
  power?: 'mains' | 'battery' | 'usb';
  simulated?: DeviceState;                 // Zustand in der Simulation
  binding?: { haEntityIds: string[]; haDeviceId?: string; haAreaId?: string }; // Zuordnung, keine Zugangsdaten
}
type DeviceState = { on?: boolean; brightness?: number; colorTemp?: number; position?: number; locked?: boolean; occupied?: boolean; open?: boolean; temperature?: number };
```

* Vorhandene **Leuchten** (`project.lights`) bleiben die Lichtquellen der Szene; ein `SmartDevice` vom Typ `light` verweist per `attachedTo` darauf und steuert in der Simulation `on`/Helligkeit/Farbtemperatur.
* **Fensterkontakt** hängt an einer Öffnung (`opening`), **Rollo** an einem Fenster → 3D-Fenster wird abgedunkelt, Lichtberechnung (Tageszeit) berücksichtigt die Rollostellung.
* **Saugroboter**: Position + Basisstation; später Karte als Overlay (nur lesend).

## 4. Darstellung
| Gerät | 2D | 3D |
|---|---|---|
| Bewegungs-/Präsenzmelder | Symbol + Erfassungskegel (Reichweite/Winkel, halbtransparent), Überdeckung pro Raum in % | Kegel als transparentes Volumen, nur im „Smart-Home-Layer“ |
| Licht/Schalter | Symbol, Verbindungslinie Schalter → Leuchte | Lichtquelle (bestehende Beleuchtung) folgt dem simulierten Zustand |
| Kontakt | an der Öffnung, Farbe offen/zu | Fenster-/Türflügel offen/zu (später) |
| Rollo | Balken am Fenster mit Position | Behang in Prozent, wirkt auf Tageslicht |
| Schloss | Symbol an Eingangstür, **sicherheitskritisch markiert** | – |
| Thermostat/Klima | am Heizkörper/Raum, Soll/Ist | Farbskala pro Raum (optional) |

Ein eigener Ebenenschalter „Smart Home“ blendet alles ein/aus; die Planungsansicht bleibt sonst unverändert (Leistung: Kegel als wenige Dreiecke, nur bei Änderung neu berechnet – gleiches Muster wie die Kollisionsmarker).

## 5. Simulation (ohne echte Geräte)
* **Szenen**: Liste von Soll-Zuständen pro Gerät; Anwenden ändert nur `simulated`, als ein Undo-Schritt.
* **Automationen (vereinfacht)**: „Wenn Melder X belegt → Licht Y an (Dauer Z)“; Zeitleiste/Abspielen mit Tageszeit-Regler; kein Anspruch, HA-Automationen 1:1 nachzubilden.
* **Export (später)**: aus Szenen/Bereichen einen YAML-Entwurf für Home Assistant erzeugen – nur als Vorschlag zum Prüfen, nie automatisch einspielen.

## 6. Verbindung zu Home Assistant (später, optional)
**Schnittstellen** (offizielle Dokumentation, siehe [ARCHITECTURE.md](ARCHITECTURE.md)): WebSocket-API (`auth`, `subscribe_entities`/`subscribe_events`, `get_states`, Registries für Areas/Geräte/Entitäten, `call_service`) und REST-API.

**Empfohlene Architektur – kleiner Backend-Dienst („Planner Bridge“)**, z. B. als Home-Assistant-App/Add-on oder Container im Heimnetz:
1. hält das Token eines **eigenen, nicht-administrativen HA-Benutzers** serverseitig (nie im Browser);
2. bietet dem Planer eine **schmale, erlaubnislisten-basierte API**: lesend `areas`, `devices`, `entities` (nur freigegebene), Zustände per Server-Sent Events/WebSocket; schreibend nur ausdrücklich freigegebene Aktionen (Phase 5);
3. Planer-Anmeldung an der Bridge (z. B. über HA-Login/OAuth-ähnlichen Flow von HA oder eigenes Passwort), nur im Heimnetz bzw. über VPN erreichbar;
4. protokolliert Aktionen; Schlösser/Alarm sind standardmäßig **nicht** schaltbar.

Alternative für Einzelnutzer ohne Backend: HAs eigener Anmeldefluss (Login-Seite von HA, Token nur im Speicher der Sitzung, CORS-Freigabe in HA). Einfacher, aber jede Planer-Sitzung hätte die vollen Rechte des angemeldeten HA-Benutzers – nur mit einem eingeschränkten Benutzer vertretbar.

**Zuordnung Planer ↔ HA**: Assistent schlägt Zuordnung über Bereich (HA-Area ↔ Planer-Raum) und Gerätetyp vor; Nutzer bestätigt. Gespeichert werden nur IDs (`binding`), keine Zugangsdaten. Nicht mehr vorhandene Entitäten → Markierung „nicht gefunden“; Zustände älter als N Minuten → „veraltet“ (grau, Zeitstempel).

## 7. Produktdaten und Modelle
* Gerätekatalog analog zum Möbelkatalog (`kind`, Maße, Protokoll, Stromversorgung, typische Reichweite – Werte **nur aus Herstellerangaben**, sonst leer).
* 3D: einfache prozedurale Formen (Melder, Schalter, Steckdose, Thermostat, Saugroboter); echte GLB nur, wenn Hersteller sie bereitstellt und Nutzung erlaubt.

## 8. Stufenplan
Siehe [ROADMAP.md](ROADMAP.md) – Phasen 1–6 mit Abnahmekriterien.
