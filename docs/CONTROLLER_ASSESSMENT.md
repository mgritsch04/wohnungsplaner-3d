# Gamepad-Steuerung für die Begehung – Machbarkeitsbewertung

_Bewertung vom 2026-10-16 · **Basis umgesetzt 2026-10-17** (#29)._

## Umgesetzt (2026-10-17)
- `src/view3d/input/gamepad.ts`: radiale Totzone 0,15 mit Neuskalierung, Ansprechkurve (Exponent 2) für den Blick, Abfrage per `navigator.getGamepads()` pro Frame, Tastendrücke als Flanke (gehaltene Tasten beim Verbinden zählen nicht), Trennen stoppt sofort.
- `WalkControls` nutzt Tastatur/Maus und Gamepad gleichzeitig; Bewegung läuft über dieselben Kollisions-Teilschritte.
- Belegung (Standard-Mapping): linker Stick gehen, rechter Stick umsehen, RT oder linken Stick drücken = schneller, A auswählen/absetzen, X Tür/Fenster, Y tragen, B ducken, LB sitzen/stehen. Hinweiszeile in der Begehung, solange ein Controller verbunden ist.
- Noch offen (Ausbau): Einstellungen für Empfindlichkeit/Invertieren/Totzone, Vibration.

## Ist-Zustand
- `src/view3d/WalkControls.tsx`: Tastatur (WASD/Pfeile, Shift) über ein `Set` gedrückter Tasten, Maus über Pointer-Lock (`movementX/Y`) bzw. Ziehen. Pro Frame (`useFrame`) wird aus Vorwärts-/Seitwärts-Anteil eine Bewegung berechnet und in Teilschritten über `resolveCollisions()` (`collision.ts`) gegen Wände/Möbel geprüft.
- Blickrichtung: `yaw`/`pitch` in Refs; Augenhöhe fix.
- Es gibt **keine Eingabe-Abstraktion**: Tastatur und Maus sind direkt im Bewegungscode verdrahtet.

## Bewertung
| Punkt | Einschätzung |
|---|---|
| Architektur | Gut geeignet: Bewegung und Kollision sind bereits pro Frame und unabhängig von der Eingabequelle. Es fehlt nur eine Schicht „Eingabe → Bewegungsvektor + Blickdelta“. |
| Linker Stick Bewegung / rechter Stick Blick | Direkt abbildbar: Stick-Achsen ersetzen `fx/fz` (analog statt ±1) bzw. `movementX/Y` (Rate statt Delta: Grad pro Sekunde × Auslenkung). |
| Totzone, Empfindlichkeit, Beschleunigung, Invertieren | Radiale Totzone (~0,15) mit Neuskalierung; Ansprechkurve (z. B. Exponent 1,5–2) für feines Zielen; Einstellungen in `settings` oder lokal (localStorage) speichern. |
| Erkennung / Trennen | Gamepad-API: `gamepadconnected`/`gamepaddisconnected` + Abfrage `navigator.getGamepads()` pro Frame (Chrome liefert Zustände nur per Polling). Bei Trennung Eingaben sofort nullen (wie heute bei Fokusverlust). |
| Kollision / Konsistenz | Unverändert nutzbar; Bewegung muss über dieselben Teilschritte laufen → identisches Verhalten zu Tastatur. Analoge Geschwindigkeit begrenzen (Betrag ≤ 1). |
| Interaktion/Auswahl | Begehung hat heute keine Auswahl. Für Controller: Fadenkreuz + Raycast aus Bildschirmmitte, Taste A = auswählen. Separater Ausbauschritt. |
| Browser/Plattform | Gamepad-API in Chrome, Edge, Firefox, Safari verfügbar; Belegung „standard mapping“ bei Xbox/PlayStation meist korrekt, bei anderen Pads abweichend. Erst nach einem Tastendruck des Nutzers sichtbar (Datenschutzregel der Browser). Benötigt sicheren Kontext (https/localhost) – erfüllt. |

## Empfehlung
1. Kleine Eingabe-Abstraktion `src/view3d/input/` mit `KeyboardMouseSource` und `GamepadSource`, die pro Frame `{ move: {x, z}, look: {yaw, pitch}, run: boolean }` liefern; `WalkControls` summiert die Quellen.
2. Gamepad-Quelle mit Polling, Totzone, Kurve, Invertierung; Einstellungen im Projekt-Tab.
3. Unit-Tests für Totzone/Kurven (rein rechnerisch), E2E mit simuliertem `navigator.getGamepads`.

## Aufwand (grob)
| Umfang | Inhalt | Aufwand |
|---|---|---|
| Basis-Prototyp | Bewegung + Blick per Sticks, feste Totzone, Laufen per Taste, Trennen sicher | ca. 0,5–1 Tag |
| Ausgereift | Einstellungen (Empfindlichkeit, Invertieren, Totzone), Hinweis-Overlay mit Belegung, Fadenkreuz-Auswahl, Vibrationsfeedback optional, Tests | ca. 2–3 Tage |

Betroffene Dateien: `src/view3d/WalkControls.tsx` (umbauen auf Eingabequellen), neu `src/view3d/input/*`, `src/ui/panels/ProjectPanel.tsx` (Einstellungen), `src/view3d/Scene3D.tsx` (Overlay-Text), Tests.

## Risiken
- Abweichende Tastenbelegung je Controller-Modell; Driften alter Sticks (→ Totzone konfigurierbar).
- Polling-Last vernachlässigbar; Pointer-Lock und Gamepad gleichzeitig müssen sauber zusammenspielen.
- Browser zeigen Gamepads erst nach erster Eingabe – Nutzerhinweis nötig.
