# Architektur

## Grundprinzip: eine Quelle der Wahrheit

```
           ┌────────────────────────── Project (Zod-Schema, versioniert) ─────────────────────────┐
           │ nodes · walls(a,b,thickness,height) · openings(wallId, offset…) · rooms(nodeIds)    │
           │ furniture · lights · materials · settings · underlay                                │
           └──────────────┬───────────────────────────────────────────────────────────────────────┘
                          │ derivePlan()  (rein, testbar, nie gespeichert)
                          ▼
     Wand-Fußabdrücke mit Gehrung · Wandstücke um Öffnungen · Knotenfüllungen · Raum-Innenpolygone/Flächen
          │                         │                              │                     │
     2D-Editor (SVG)          3D-Renderer (R3F)            Kollision (Begehung)     Validierung/Budget
```

* **Wandgraph:** Wände verbinden *Knoten*. Wird eine Ecke verschoben, folgen alle angeschlossenen
  Wände – Ecken können nicht „aufreißen“. T-Stöße und Kreuzungen teilen Wände automatisch
  (`model/operations.ts → insertWall`).
* **Räume** sind Zyklen von Knoten entlang der Wandachsen; Innenpolygon, Nutzfläche und Umfang
  werden daraus abgeleitet (Versatz um die halbe Wanddicke). Umschlossene Flächen werden über eine
  planare Flächensuche erkannt (`model/roomDetection.ts`).
* **Öffnungen** referenzieren ihre Wand und liegen über `offset` (Abstand Wandstart → Mitte) fest.
  Beim Teilen einer Wand werden sie korrekt umgehängt.
* Alle Änderungen laufen über `useProjectStore.apply()` (strukturierte Kopie → Mutation → neuer
  Zustand). Das liefert Undo/Redo; Ziehen nutzt Transaktionen (ein Undo-Schritt pro Zug).

## Module

| Ordner | Inhalt |
|---|---|
| `src/model` | Schema, Einheiten, Vektorgeometrie, Operationen, abgeleitete Geometrie, Validierung |
| `src/editor2d` | SVG-Editor: Werkzeuge, Fang, Hit-Test, Zeichnung, Underlay, Import-Overlay |
| `src/view3d` | React-Three-Fiber-Szene, Wand-/Bodengeometrie, Möbelmodelle, Licht, Begehung, Kollision, Leistung |
| `src/import` | Datei-Prüfung, PDF (pdf.js), Underlay/Kalibrierung, Import-Entwurf + Prüfung, Erkennung |
| `src/import/recognition` | Adapter-Schnittstelle, Raster-Detektor (Web Worker), Vektor-Detektor, gemeinsame Nachbearbeitung |
| `src/formats` | Projektformat + Migration, Projektpaket mit Assets, `apartment-plan.json` |
| `src/catalog` | Generischer Katalog, Produktlisten-Import |
| `src/kitchen` | Küchenzeilen, Arbeitsplatten, Konfliktprüfung, Stückliste |
| `src/budget` | Kostenberechnung, CSV-Einkaufsliste |
| `src/persistence` | IndexedDB (Projekte, Assets, Metadaten), Autosave |
| `src/ui` | Layout, Panels, Dialoge, Tastenkürzel |

## Koordinatensystem

* Intern **Meter**; Anzeige/Eingabe in cm. Winkel in Radiant.
* **Plan (2D):** x nach rechts, y nach unten. Positive Drehung = im Uhrzeigersinn auf dem Bildschirm.
* **Welt (3D):** X = Plan-x, Z = Plan-y, **Y = Höhe** (Boden bei 0). Plan-Drehung r ↦ `rotation.y = −r`.
* Möbel: Ursprung = Mitte der Grundfläche am Boden, lokale +y-Achse (Plan) bzw. +Z (3D) = **Vorderseite**.

## Underlay & Kalibrierung

Das importierte Bild ist ein eigenes Objekt (`project.underlay`) und **nie** Teil der Geometrie.
Abbildung Bildpixel → Plan: `plan = position + rotate(pixel · metersPerPixel, rotation)`.
Ohne Kalibrierung wird nur ein vorläufiger Anzeige-Maßstab verwendet und der Plan als
**„Nicht kalibriert“** markiert. Die Maßstabsangabe (z. B. 1:100, nur PDFs) wird als
„angenommen“ geführt; erst die Zwei-Punkt-Kalibrierung setzt `calibrated = true`.
Bilder und Original-PDFs liegen als Blobs in IndexedDB und werden beim Projektexport eingebettet.

## Erkennung (Beta)

1. **Vektor-PDF:** Linien werden aus den Zeichenbefehlen extrahiert; parallele, achsparallele
   Linienpaare mit wandtypischem Abstand (5–60 cm) werden zu Wänden.
2. **Raster (Scan/Bild):** Otsu-Schwelle, Lauflängen-Analyse für dicke dunkle Striche, im Web Worker.
3. Gemeinsame Nachbearbeitung: Zusammenführen, Lücken 0,5–2,6 m → Öffnungskandidaten (Fenster/Tür/
   Durchgang per Heuristik), Eckverbindung auf Wandachsen.
4. Ergebnis ist immer ein **Entwurf** mit Status/Konfidenz, der geprüft werden muss.

Externe KI-Dienste sind *nicht* eingebunden. Die Schnittstelle `FloorPlanRecognizer`
(`src/import/recognition/types.ts`) ist dafür vorbereitet; ein Remote-Adapter müsste über einen
eigenen Server-Proxy laufen (keine API-Schlüssel im Browser) und nur nach ausdrücklicher Zustimmung hochladen.

## Leistung

* 3D-Geometrie wird nur neu erzeugt, wenn sich die Architektur ändert (Schlüssel über Knoten/Wände/Öffnungen/Räume/Materialien); Möbel werden einzeln memoisiert.
* Gemeinsame Geometrien (Einheitsbox/-zylinder) und ein Material-Cache; Geometrien werden beim Austausch freigegeben.
* Three.js und pdf.js werden erst bei Bedarf geladen (Code-Splitting); die Bilderkennung läuft im Web Worker.
* Planungsmodus: Lambert-Materialien, keine Schatten, Pixelverhältnis ≤ 1,25.
  Realismus: PBR + prozedurale Texturen in realen Maßen, weiche Schatten, Umgebungslicht.
* Adaptive Qualität: `PerformanceMonitor` mit Mittelungsfenster; bei *anhaltend* niedriger Bildrate
  wird zuerst das Pixelverhältnis gesenkt, erst nach wiederholtem Abfall wird der Planungsmodus vorgeschlagen.
