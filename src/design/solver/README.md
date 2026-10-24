# Stufe 3 Aufstellen (`solver/`)

Stellt ein `RoomProgram` (Stufe 2) in einem gelesenen Raum (`RoomAnalysis`, Stufe 0) genau auf und liefert ein `Layout`. Ohne Claude-Aufruf, deterministisch: gleicher Seed, gleiches Ergebnis (mgritsch04/wohnungsplaner-3d#440).

```ts
const existing = existingPieces(project, room);
const layout = solveRoom(room, program, { existing, seed: 1 });
// layout.items: Platzierungen, layout.dropped: was fehlt und warum, layout.unsolved: harte Verstöße (soll leer sein)
```

## Ablauf

1. **Modell** (`model.ts`, `items.ts`): Aus dem Programm werden Gruppen („Units“). Ein Hauptmöbel nimmt mit, was an ihm hängt (Stühle `around`, Nachttische, Couchtisch `front-of`, Teppich `under-*`, Bild/Pendel/TV `above`, Lampe `on`); eine Küchenzeile ist eine Gruppe; Vorhänge und Fensterbank-Teile hängen am Fenster. Jedes Teil bekommt Bewegungsflächen nach Neufert (`items.ts`, z. B. Schrank 70 cm, Bett seitlich 50 cm; 3 cm Toleranz). Stühle, die Claude einzeln vor oder neben einen Esstisch stellt, werden eine Gruppe um den Tisch.
2. **Kosten** (`cost.ts`): harte Regeln zählen je Verstoß `HARD` = 4 plus Menge, weiche Regeln (Nähe zum Hint, Drehung, Zone, Beziehungen, Abstände, Komfortflächen) wenig.
   - Gegen Warum-Momente: Das Sofa schaut zum Fernseher (Gewicht 3; aus „tv facing sofa“ folgt die Gegenrichtung, ohne Beziehung gilt sie für das einzige Sofa), eine Pflanze ohne Beziehung steht in einer Ecke, am Fenster oder an der Wand und meidet den Stufe-0-Weg stark, ein Sessel für sich schaut zur Sitzgruppe (C2).
   - Hart: im Raum, keine Überlappung (auch kein Teppich unter Schränken), Türschwenk frei, 50 cm hinter jeder Tür frei, vor Fenstern nichts höher als die Brüstung, „frei lassen“-Bereiche und Nutzerbereiche, Bewegungsflächen, Wandteile nicht über Öffnungen.
   - **Wege** (B1/B2): Ein Laufraster (`grid.ts`, 5 cm) prüft, ob zwischen allen Türen ein Weg der verlangten Breite frei bleibt und jedes Möbel erreichbar ist. Zu Möbeln hält der Weg 3 cm Reserve, weil die Nachprüfung von Stufe 0 auf 5-cm-Zellen misst. Ein Stuhl vor dem Schreibtisch oder am Tisch wird herausgezogen: hinter ihm erreichbar genügt. Der Stufe-0-Weg ist nur Referenz (schwache Anziehung), keine Sperrfläche.
3. **Suche** (`solve.ts`, `search.ts`): drei Starts (Hints, Ankermöbel zuerst, Hints mit Rauschen), Reparatur (bester Einzelzug), Simulated Annealing, inkrementelle Kosten.
4. **Küche** (`kitchenTops.ts`): Das Programm nennt nur die Bodenmodule. Das Kochfeld kommt auf den Backofen, sonst auf einen Unterschrank mit 60 cm Arbeitsfläche zur Spüle und 30 cm zu Hochschrank und Wand, möglichst nicht unter ein Fenster; die Haube hängt darüber, außer vor einem Fenster. Arbeitsplatte und Oberschränke ergänzt die Übernahme ins Projekt.
5. **Ausweichen** (`settle`): Bleibt ein harter Verstoß, wird nacheinander versucht: abhängiges Teil weglassen, Küchenzeile um ein Stauraum-Modul kürzen, kleinere Variante (Bett 160 → 140 → 90, `SMALLER`), zuletzt das unwichtigste Teil weglassen; bevor ein Pflichtteil wegfällt, erst ein optionales und ein neuer Start mit den großen Teilen an anderer Stelle. Alles Weggelassene steht mit Grund in `dropped`, bei Pflichtmöbeln mit „Pflichtmöbel fehlt: “. Die Pendelleuchte eines weggelassenen Tisches fällt mit weg.

## Tests

- `solver.test.ts`: aufgezeichnete Claude-Antworten aller 44 Räume der Testwohnungen A–F, gelesen mit dem Parser von Stufe 2 (`concept/roomProgram.ts`); Determinismus, Laufzeit unter 300 ms je Raum.
- `flats.test.ts`: Testwohnungen C–F mit synthetischen Programmen (`testPrograms.ts`).
- `invariants.test.ts`: zufällige Rechteck- und L-Räume; Wege und Türschwenk bleiben frei.
- `sense.test.ts`: keine Warum-Momente (Sofa zum Fernseher, Pflanze nicht frei und nicht im Weg, Sessel zur Sitzgruppe, Kochfeld und Haube, Läufer direkt vor der Küchenzeile, Pendel fällt mit dem Tisch weg).
- Unabhängige Nachprüfung mit `checkWalkways` aus Stufe 0 (`verify.ts`).
