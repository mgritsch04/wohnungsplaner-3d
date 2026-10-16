# Wohnungsplaner 3D

Browserbasierter Wohnungsplaner mit **präzisem 2D-Grundriss-Editor** und **begehbarer 3D-Ansicht**,
die beide auf **demselben Datenmodell** arbeiten. Grundrisse können gezeichnet, als PDF/Bild
hinterlegt und kalibriert, automatisch (Beta) erkannt oder als JSON importiert werden.
Möbel, Küche, Materialien, Licht und Budget sind integriert. Alles läuft lokal im Browser –
kein Konto, kein Server, keine Uploads.

> Entwurfswerkzeug ohne Gewähr. Bau-, Elektro-, Sanitär- und Lüftungsvorschriften werden nicht geprüft.

## Schnellstart

```bash
npm install
npm run dev        # Entwicklungsserver (http://localhost:5173)
npm run build      # Typecheck + Produktions-Build nach dist/
npm run preview    # Build lokal ansehen
npm test           # Unit-/Integrationstests (Vitest)
npm run lint       # ESLint
npx playwright test  # End-to-End-Tests im echten Browser (baut und startet vite preview)
```

Voraussetzung: Node.js ≥ 20. Für die E2E-Tests wird Chromium von Playwright genutzt
(`npx playwright install chromium`, falls nicht vorhanden; ein vorinstalliertes Chromium unter
`/opt/pw-browsers/chromium` oder `PW_CHROMIUM_PATH` wird automatisch verwendet).

## Funktionsumfang (Stand)

| Bereich | Status |
|---|---|
| 2D-Editor: Raster/Fang, Zoom/Pan, Wände zeichnen mit Längeneingabe, Räume (Rechteck oder Fläche anklicken), Ecken/Wände ziehen, Türen/Fenster/Durchgänge, Bemaßung (lichte Innenmaße), Flächen, Messen, Undo/Redo, Tastenkürzel | ✅ |
| Numerische Eingabe aller Maße (cm): Raum-Innenmaße, Wandlänge/-dicke/-höhe/-winkel, Öffnungsposition/-maße, Möbelmaße/-position | ✅ |
| 3D: Wände mit Dicke/Höhe und echten Öffnungen, Böden/Decken, Türblätter, Fenster, Materialien, Übersicht/Orbit, Schnittansicht, Auswahl und Verschieben von Möbeln | ✅ |
| Begehung: WASD + Maus (Pointer-Lock), Augenhöhe 1,65 m, Kollision mit Wänden und Möbeln, Türen passierbar | ✅ |
| Import PDF/PNG/JPG als Underlay: Seitenwahl, Deckkraft, Position, Drehung, Zuschneiden, Sperren, Ein/Aus | ✅ |
| Maßstab: Zwei-Punkt-Kalibrierung (Pflicht), Maßstabsangabe 1:N (als „angenommen“), Kontrollmessungen mit Abweichung | ✅ |
| Automatische Erkennung (Beta): Vektor-PDFs und Rasterbilder, achsparallele Wände + Öffnungskandidaten, Prüfansicht mit Status | ✅ (Heuristik, siehe Grenzen) |
| `apartment-plan.json`: Import (mit Prüfung) und Export, dokumentiert, versioniert | ✅ |
| Katalog: ~50 generische Objekte mit typischen Maßen, Suche/Filter, prozedurale Modelle | ✅ |
| GLB/glTF-Import: Upload (.glb, eigenständige .gltf, Draco lokal), Prüfung, Maße aus Modell mit Einheitenvorschlag, als Katalogobjekt oder Modell für ein vorhandenes Möbel, Ersatzmodell bei Fehlern, im Projektexport enthalten | ✅ |
| Echte Produkte: „Produkt von Händlerseite übernehmen“ (schema.org-Daten aus eingefügter Seite) und Produktlisten (CSV/JSON) – keine offizielle IKEA/Möbelix-API | ✅ (siehe [docs/INTEGRATIONS_IKEA.md](docs/INTEGRATIONS_IKEA.md)) |
| Küchenplaner: Module an Wand ausrichten, Breiten, Frontfarbe, Arbeitsplatten-Generierung, Konfliktprüfung, Stückliste | ✅ |
| Materialien & Licht: Wand-/Bodenmaterialien je Raum/Wandseite, Tageszeit, Belichtung, Leuchten mit Farbtemperatur | ✅ |
| Planungs- und Realismusmodus (Umgebungsverdeckung, SMAA, Tonemapping, Himmel, Oberflächenstrukturen, leuchtende Lampen), adaptive Qualität, FPS-Anzeige | ✅ |
| Architektur-Details: Sockelleisten, Fensterbänke innen/außen, Fensterflügel mit Griffen, Türzargen mit Bekleidung und Drücker | ✅ |
| Speichern: Autosave (IndexedDB), Projektliste, Projektpaket-Export/-Import inkl. Plan-Bildern | ✅ |
| Budget: Summen, Kategorien/Händler, fehlende Preise, Schätzung vs. bestätigt, CSV-Einkaufsliste | ✅ |

## Bedienung in Kürze

* **Raum anlegen:** links „Raum mit Maßen anlegen“ (Innenmaße) oder Werkzeug **Raum (R)** und Rechteck aufziehen.
* **Wände zeichnen:** **W**, klicken; während des Zeichnens eine Zahl tippen = Länge in cm, Enter. Schließen der Kontur erzeugt automatisch einen Raum.
* **Maße ändern:** Element anklicken → rechts Werte in cm eingeben (Enter oder Feld verlassen).
* **Plan importieren:** Tab **Import** → PDF/Bild → **Maßstab kalibrieren** (zwei Punkte, reale Länge) → nachzeichnen oder **Erkennung starten** → prüfen → übernehmen.
* **3D:** oben 2D / 2D + 3D / 3D; **Begehen** für die Ich-Perspektive.
* **Türen/Fenster öffnen:** in 3D Doppelklick oder Taste **O** (ausgewählte Tür/Fenster), beim Begehen **E** (oder Klick, **O**) aufs Ziel im Fadenkreuz; auch im Eigenschaften-Panel. Ein geöffneter Flügel zählt in der Kollisionsprüfung, eine geschlossene Tür versperrt beim Begehen den Weg.
* Alle Kürzel: **?** oben rechts.

## Architektur

React 19 + TypeScript + Vite · Three.js über React Three Fiber/Drei · Zustand (State, Undo/Redo) ·
Zod (Schemas) · idb-keyval (IndexedDB) · pdf.js · Vitest + Playwright.
Der 2D-Editor ist bewusst SVG-basiert: präzise Vektorgrafik, einfaches Hit-Testing in Weltkoordinaten,
keine zusätzliche Canvas-Bibliothek.

Details: [docs/architecture.md](docs/architecture.md) – Datenmodell, Koordinatensystem, Underlay,
Erkennung, Leistungskonzept.

**Koordinaten:** intern Meter. Plan: x rechts, y unten. 3D: Y = Höhe, X/Z = Plan x/y.

## Dateiformate

* **Projekt** (`format: "wohnungsplaner-project"`, `schemaVersion`) – vollständiger Zustand; Migrationen in `src/formats/project/projectFile.ts`. Neuere Versionen werden mit klarer Meldung abgelehnt.
* **Projektpaket** (`*.wohnplan.json`, `format: "wohnungsplaner-package"`) – Projekt + alle referenzierten Dateien (Plan-Bild, Original-PDF, GLB-Modelle) Base64-eingebettet, damit beim Export nichts verloren geht.
* **Grundriss** (`apartment-plan.json`) – Austauschformat für externe Tools/KI-Assistenten: [docs/apartment-plan-format.md](docs/apartment-plan-format.md).
* **Produktliste** (CSV/JSON): [docs/catalog-format.md](docs/catalog-format.md).

## Datenschutz

Pläne, Projekte und Produktlisten werden ausschließlich lokal im Browser (IndexedDB) verarbeitet
und gespeichert. Es gibt keine Uploads und keine externen Dienste. Löschen eines Projekts entfernt
auch seine nicht mehr verwendeten Plan-Dateien.

## Bekannte Grenzen

* **Erkennung:** nur achsparallele (horizontale/vertikale) Wände; Wände müssen als dicke, gefüllte
  Striche (Raster) bzw. parallele Linienpaare (Vektor) gezeichnet sein. Schräge Wände, Bögen,
  schraffierte Wände mit dünnen Konturen und Bemaßungstexte werden nicht ausgewertet. Tür/Fenster-Typ
  ist eine Heuristik; Höhen sind Standardannahmen. Ergebnisse immer prüfen.
* Maßstabsangabe 1:N setzt voraus, dass das PDF im Originalpapiermaß vorliegt – daher nur „angenommen“.
* Möbelmodelle sind prozedurale Näherungen (als „Näherungsmodell“ gekennzeichnet); maßgeblich sind die Maße. Für echte Optik ein GLB-Modell hinterlegen.
* Mehrfachauswahl, gekrümmte Wände, mehrere Geschosse und Treppen sind noch nicht umgesetzt.
* Speicherung ist browserlokal: anderes Gerät/Browser → Projektpaket exportieren/importieren.
* Leistung (gemessen, `src/model/perf.test.ts`, Node): abgeleitete Geometrie + 3D-Wandmeshes für
  4 Räume ≈ 7 ms, 25 Räume ≈ 35 ms, 100 Räume/220 Wände ≈ 40 ms. Bei jeder Änderung wird der Plan
  komplett neu abgeleitet; sehr große Pläne (> ~500 Wände, > ~1000 Objekte) können den SVG-Editor und
  die 3D-Ansicht verlangsamen (kein Instancing für Möbel). Software-Rendering (ohne GPU, z. B. in CI)
  liefert im Realismusmodus nur wenige FPS – echte GPUs sind deutlich schneller, wurden hier aber nicht gemessen.
* Generische Preise sind grobe Schätzwerte, keine Händlerangebote.

## Roadmap

1. Mehrfachauswahl, Kopieren/Einfügen ganzer Räume, Hilfslinien/Bemaßungsketten
2. Bessere Erkennung: schräge Wände, Bemaßungstexte (PDF-Text) zur automatischen Maßstabsprüfung, optionaler Server-Adapter (mit Zustimmung)
3. Instancing/LOD für sehr große Szenen, komprimierte Texturen, optionale Nachbearbeitungseffekte
4. Partner-/Affiliate-Feeds für Produktdaten, sofern rechtlich und vertraglich möglich
5. Geschosse, Treppen, Dachschrägen

## Tests

* `npm test` – Datenmodell, Einheiten, Wandverbindungen, Öffnungen, Raumerkennung, 2D→3D-Geometrie,
  Kollision, Formate (Roundtrip, Versionen, Fehler), Kalibrierung, Dateiprüfung, Import-Konflikte,
  Erkennung, Budget/CSV, Katalog-Import, Küche, Store (Undo/Redo, Transaktionen), IndexedDB-Persistenz.
* `npx playwright test` – App-Start ohne Konsolenfehler, Raum per Maßeingabe, Möbel ziehen/drehen/löschen,
  Wände mit Längeneingabe, Persistenz nach Reload, JSON-Import mit Prüfung, Bildimport + Kalibrierung +
  Erkennung, Begehung, CSV-Export.
