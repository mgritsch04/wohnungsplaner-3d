# Grundriss-Austauschformat `apartment-plan.json` (Version 1)

Ein offenes, versioniertes JSON-Format, mit dem Grundrisse **außerhalb** der App erzeugt
(z. B. von einem KI-Assistenten aus einem PDF) und in den Wohnungsplaner importiert werden können.
Es ist bewusst getrennt vom vollständigen Projektformat (`wohnungsplaner-project`), das zusätzlich
Einstellungen, Materialien, Underlay usw. enthält.

Import in der App: **Projekt ▾ → Grundriss-JSON importieren…** – die Datei landet zuerst in der
**Import-Prüfung**, wo Elemente kontrolliert, korrigiert oder abgewählt werden können.
Export: **Export ▾ → Grundriss (apartment-plan.json)**.

Schema im Code: `src/formats/floorplan/schema.ts` (Zod). Beispiel: [`examples/apartment-plan.example.json`](examples/apartment-plan.example.json)
(wird von den automatischen Tests validiert).

## Koordinatensystem und Einheiten

| Feld | Bedeutung |
|---|---|
| `units` | `"m"` (Standard), `"cm"` oder `"mm"`. Gilt für **alle** Längen und Koordinaten der Datei. |
| `coordinateSystem.y` | `"down"` (Standard, wie auf Papier/Bildschirm: y wächst nach unten) oder `"up"` (mathematisch). |
| Ursprung | beliebig; üblich ist die linke obere Ecke des Grundrisses. |
| Winkel | Möbel-`rotation` in **Grad**, im Uhrzeigersinn in der Draufsicht (bei `y: "down"`). |

Punkte dürfen als `[x, y]` oder `{ "x": …, "y": … }` geschrieben werden.

## Struktur

```jsonc
{
  "format": "apartment-plan",      // Pflicht
  "version": 1,                    // Pflicht, ganze Zahl
  "units": "cm",
  "coordinateSystem": { "y": "down" },
  "name": "Wohnung Top 5",
  "metadata": { "beliebig": "…" },
  "defaults": { "wallThickness": 12, "wallHeight": 260 },
  "walls": [ … ],                  // Pflicht (darf leer sein)
  "openings": [ … ],
  "rooms": [ … ],
  "furniture": [ … ],
  "sourceDrawing": { "fileName": "plan.pdf", "page": 1, "scale": "1:100", "calibrated": true }
}
```

### Wände (`walls`)

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `id` | nein | Referenz für Öffnungen |
| `start`, `end` | ja | Endpunkte der **Wandachse** (Mittellinie) |
| `thickness` | nein | Wanddicke; fehlt sie, gilt `defaults.wallThickness` bzw. 12 cm (als *geschätzt* markiert) |
| `height` | nein | Wandhöhe (Standard 2,60 m) |
| `status` | nein | `confirmed` · `estimated` · `uncertain` |
| `confidence` | nein | 0…1 (z. B. von einer Erkennung) |
| `note` | nein | Freitext, wird in der Prüfung angezeigt |

Regeln: Wände, deren Endpunkte < 5 mm auseinanderliegen, werden zu einer Ecke verbunden. Endet eine Wand
auf einer anderen (T-Stoß) oder kreuzen sich Wände, werden sie automatisch geteilt. Überlappende,
kollineare Wände werden zusammengeführt und in der Prüfung gemeldet.

### Öffnungen (`openings`)

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `type` | ja | `door`, `window` oder `passage` (Durchgang ohne Türblatt) |
| `wall` + `offset` | entweder | Wand-`id` und Abstand vom Wand-**Start** bis zur **Mitte** der Öffnung |
| `at` | oder | Mittelpunkt der Öffnung; zugeordnet wird die nächstgelegene Wand |
| `width` | ja | lichte Breite |
| `height` | nein | Standard: Tür 2,10 m, Fenster 1,40 m |
| `sillHeight` | nein | Brüstungshöhe; Standard: Fenster 0,90 m, sonst 0 |
| `hinge` | nein | Türanschlag `start`/`end` – bezogen auf die Richtung der Wand in **dieser Datei** |
| `swing` | nein | Aufschlagseite `left`/`right` relativ zur Wandrichtung start→end |
| `status`, `confidence`, `note` | nein | wie bei Wänden |

### Räume (`rooms`)

Räume werden **aus den Wänden** gebildet: Die App sucht die geschlossene Wandfläche, die den
`labelPoint` enthält. `polygon` ist optional und nur informativ (sein Schwerpunkt dient als Ersatz
für einen fehlenden `labelPoint`). `statedArea` (m² bzw. in `units²`) ist eine im Plan angegebene
Fläche – nach dem Import wird sie mit der berechneten Nutzfläche verglichen und Abweichungen > 5 % werden gemeldet.

### Möbel (`furniture`, optional)

`name`, `category` (z. B. `sofa`, `bed`, `table`, `storage`, `kitchen`), `position` (Mittelpunkt),
`rotation` (Grad), `width`/`depth`/`height`, optional `elevation`, `color` (`#rrggbb`),
`price: { amount, status }`, `productUrl`, `retailer`, `brand`.

## Unsicherheit ehrlich kennzeichnen

Erfundene Präzision ist der häufigste Fehler beim automatischen Erstellen. Deshalb:

* Nur Maße als `confirmed` markieren, die im Plan eindeutig lesbar sind.
* Aus dem Maßstab abgeleitete Werte → `estimated`; geratene/unlesbare → `uncertain` plus `note`.
* Lieber eine Wand ohne `thickness` lassen als eine Dicke zu erfinden.

## Vorlage für einen KI-Assistenten

> Erzeuge aus dem angehängten Grundriss eine Datei im Format `apartment-plan` Version 1
> (Spezifikation: siehe Text unten). Verwende `"units": "cm"` und `"coordinateSystem": {"y":"down"}`,
> Ursprung links oben. Gib jede Wand als Achse (Mittellinie) mit `start`, `end` und `thickness` an.
> Türen und Fenster als `openings` mit `wall` + `offset` (Abstand Wandstart → Öffnungsmitte).
> Räume mit `name`, `labelPoint` und – falls im Plan angegeben – `statedArea` in m².
> Markiere jedes Maß, das nicht direkt im Plan steht, mit `"status": "estimated"` oder
> `"uncertain"` und erkläre es in `note`. Erfinde keine Maße. Antworte nur mit gültigem JSON.

## Versionierung

`version` wird erhöht, wenn sich die Bedeutung von Feldern ändert. Die App lehnt neuere Versionen mit
einer klaren Meldung ab, statt sie falsch zu interpretieren. Unbekannte zusätzliche Felder werden ignoriert.
