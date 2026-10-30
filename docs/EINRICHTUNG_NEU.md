# Einrichtungsvorschlag neu: technischer Entwurf

Entwurf vom 23.10.2026 für mgritsch04/wohnungsplaner-3d#436 (Teilaufgaben mgritsch04/wohnungsplaner-3d#437 bis #443). Code: [`src/design/`](../src/design/README.md). Alle Testwohnungen sind frei erfunden.

**Kurz:** Der Vorschlag arbeitet wie eine Innenarchitektin. Die App liest jeden Raum genau (Stufe 0), Claude entwirft erst ein Wohnkonzept für die ganze Wohnung (Stufe 1) und dann je Raum ein Raumprogramm mit Zonen, Plätzen und Beziehungen (Stufe 2). Ein Rechenverfahren stellt millimetergenau auf und hält feste Regeln ein (Stufe 3), eine Begehung mit rund 35 Plausibilitätsregeln prüft jeden Raum (Stufe 4), Claude bessert nach Bild und Befunden nach (Stufe 5), zuletzt kommen echte Produkte mit erneuter Prüfung (Stufe 6).

Verbindlich sind die Schnittstellen in [`src/design/types.ts`](../src/design/types.ts); wo dieser Entwurf davon abweicht, gilt der Code.

## 1. Ziel und Maßstab

G soll beim Vorschlag sagen können: „wow, gut eingerichtet und hat einen Plan“. Das heißt:
- **Schön:** erkennbare Idee je Raum, ruhige Zonen, ein Blickfang, Farben und Materialien aus einer Palette, Licht in Ebenen, Textilien und Deko in sinnvoller Menge.
- **Sinnvoll:** jedes Möbel hat einen Grund und einen logischen Platz; man kommt überall bequem durch; Türen, Fenster, Schränke lassen sich öffnen; nichts, wo man „warum?“ fragt.
- **Vollständig:** jeder Raum kann, wofür er da ist (Schlafzimmer mit Bett, WC mit Handwaschbecken), nichts Wichtiges fehlt, nichts ist doppelt.

Messbar (Abnahme, Abschnitt 5): keine schweren Befunde in allen Testwohnungen, Punktzahl im Schnitt mindestens 85, kein Raum unter 75, alle Mängel aus Abschnitt 2 behoben, Urteil einer unabhängigen Claude-Prüfung mit Bildern mindestens 8 von 10 je Hauptraum, dann Gs Test mit der eigenen Wohnung.

## 2. Ist-Analyse

### 2.1 Ablauf heute (kurz)
`runDesign` (designRun.ts) fragt je Raum Claude (gründlich: Opus, zweite Runde mit Platzierungsbericht). `buildDesignPrompt` (design.ts) liefert Wünsche, Palette, Produktliste und eine Raumzeile (Fläche, Außenmaß, Anzahl Türen und Fenster; Wandliste nur bei Küchen). Claude antwortet mit Leitfaden (Zonen, Blickfang, Wege) und Möbelliste, ausdrücklich ohne Positionen. `finishRoom` ergänzt Pflichtmöbel. `suggestFurnishing` (suggest/furnishing.ts) stellt in fester Rollenreihenfolge auf (erste passende Stelle, Varianten je Wand), `scoreLayout` wählt die beste Variante. Küchen über `furnishWithKitchens`.

### 2.2 Testaufbau
Zwei erfundene Wohnungen, im Container mit echtem Claude (Opus, „gründlich“, je Raum zwei Runden, 28 Anfragen) eingerichtet, in 2D und 3D fotografiert und mit einem eigenen Prüfwerkzeug ausgewertet:
- **A**, 83 m², Wiener Altbau-Typ: langer Gang, Abstellraum, Bad, getrenntes WC, „Zimmer 1“, „Zimmer 2“, Küche, Wohnzimmer, Balkon.
- **B**, 52 m²: Vorraum, Bad mit WC, Wohnküche als Durchgangszimmer zum Schlafzimmer, Balkon.
Wünsche: Lesen, Kochen, PC-Spiele, Arbeitsplatz mit Monitor, viel Stauraum, Gästeschlafplatz, Leseecke, Pflanzen, Esstisch für 4, skandinavisch.

### 2.3 Mängelliste mit Ursache

| # | Mangel (Beispiel aus dem Test) | Ursache im Ablauf |
|---|---|---|
| M1 | **Weg zugestellt:** In B ist die Wohnküche das Durchgangszimmer. Sessel und zwei Pflanzen stehen an der Wand zwischen Eingang und Schlafzimmertür, Sofa und Couchtisch mitten im Raum. Vom Eingang kommt man nicht mehr ins Schlafzimmer und nicht auf den Balkon. Die App-Bewertung gibt 88/100. | Der Aufsteller kennt keine Wege zwischen Türen, nur 70 cm frei vor jeder Tür. Pflanzen und Stehlampen gelten als „nicht im Weg“ (solid:false). Claude kennt die Lage der Türen nicht und kann den Durchgang nicht einplanen. |
| M2 | **Tür blockiert:** In B steht der Kühlschrank vor der Balkontür, in A stehen Geschirrspüler und Spülenschrank im Türaufschlag der Küche („Küche vom Gang aus nicht erreichbar“). | Küchenzeile wird ohne Türschwung-Prüfung gegen die Wand gesetzt; Claude sieht nur „Tür bei 155–245 cm“, nicht wohin sie führt. |
| M3 | **Doppelt geplant:** A hat zwei Esstische für 4 (Wohnzimmer und Küche) und zwei Gästeschlafplätze (Schlafsofa und Tagesbett). | Jeder Raum wird in einer eigenen Anfrage mit denselben Wünschen geplant, ohne Wohnkonzept und ohne Wissen, was die anderen Räume bekommen. |
| M4 | **Sanitär erfunden:** Im Bad von A plant Claude ein zusätzliches Wand-WC, obwohl es ein eigenes WC gibt. Im WC dagegen fehlt das Handwaschbecken (passte nicht). | Ohne Wohnungsüberblick weiß Claude nicht, dass es ein WC gibt; Sanitär wird wie ein Möbel behandelt; „passt nicht“ wird still weggelassen. |
| M5 | **Konzept nicht umgesetzt:** Claude plant in A „Bücher- und Sideboardwand gegenüber vom Sofa“ als Blickfang und eine Leseecke. Aufgestellt steht das Sideboard neben dem Sofa, die Regale an einer anderen Wand, der Sessel 19 cm neben einem Esszimmerstuhl eingeklemmt. | Die Zonen und der Blickfang aus Claudes Leitfaden sind nur Anzeigetext. Der Aufsteller arbeitet nach fester Reihenfolge und erster passender Stelle. |
| M6 | **Pflanze mitten im Gang / neben der Tür.** Pflanzen stehen 3–4 m vom Fenster, auch „in Ecken“, die keine sind. | `roomEdges` zerlegt eine gerade Wand an jeder Stelle, an der eine andere Wand anstößt, in mehrere Stücke. Deren Enden gelten als Ecken, liegen aber mitten an der Wand oder neben einer Tür (der Gang in A hat 9 statt 4 Wandstücke). Pflanzen zählen beim Prüfen nicht als Hindernis. |
| M7 | **Raum ohne sein Hauptmöbel** (aus einem echten Test: Schlafzimmer ohne Bett). | Raumtyp wird aus dem Namen geraten („Zimmer 1“ = unbekannt) und nicht überall Claudes Typ verwendet; ein fehlendes Möbel kostet in der Bewertung nur 12 Punkte, eine Variante ohne Bett kann gewinnen. |
| M8 | **Deko ohne Sinn:** Tischlampe mitten auf dem Esstisch, zwei Kräutertöpfe auf dem Küchenboden in der Ecke, Bettteppich fast ganz unter dem Bett, im Gang drei Deckenleuchten, vier Poster, zwei Läufer und zwei Schuhschränke. | Es gibt keine Regeln dafür, worauf etwas steht und wie viel wovon sinnvoll ist; jede Position wird nur auf Kollision geprüft. |
| M9 | **Eng und unbequem:** Waschmaschine 14 cm neben dem WC, Nachttisch 47 cm hinter der Schlafzimmertür, Bett 38 cm vor dem Bürostuhl. | Nur Mindestabstände für einzelne Möbel, keine Bewegungsflächen nach Neufert und keine Zonen. |
| M10 | **Bewertung misst das Falsche:** Fast alle Räume bekommen 100/100, auch mit eingeklemmtem Sessel oder zugestelltem Weg. | `scoreLayout` zählt nur Überlappung, Erreichbarkeit einzelner Möbel und fehlende Stücke. |
| M11 | **Zweite Runde bringt wenig:** Claude bekommt nur einen Textbericht und darf nur die Liste ändern, nicht die Anordnung. | Kritik ohne Bild und ohne Einfluss auf die Plätze. |
| M12 | **Echte Produkte ändern Maße**, die Aufstellung wird danach nicht neu geprüft; die Zone eines Möbels geht beim Ersetzen verloren (`replaceWithFound`). | Produktsuche nach dem Aufstellen ohne erneute Prüfung. |

Bekannt und schon behoben bzw. in Arbeit: doppelte Küchenhälften (mgritsch04/wohnungsplaner-3d#434/#435), Vorhang-Maße (#431).

## 3. Wie Profis und Forschung das lösen

**Arbeitsweise einer Innenarchitektin:** 1. Bedarf (wer wohnt hier, Alltag, Gäste, Hobbys), 2. Bestandsaufnahme (Maße, Türen, Fenster, Licht, Wege, Blickachsen), 3. Funktionen auf Räume verteilen, 4. je Raum Zonen und Laufwege, 5. Ankermöbel je Zone, 6. Begleitmöbel nach festen Beziehungen, 7. Licht in drei Ebenen, Textilien, Deko, 8. Begehung und Korrektur.

**Faustregeln (Auswahl, Quelle Neufert und gängige Einrichtungsregeln):** Hauptwege 90 cm, Nebenwege 60–70 cm; vor Schränken 70–90 cm; neben dem Bett 60–70 cm; hinter Esstischstühlen 75–90 cm; Couchtisch 40–50 cm vor dem Sofa; Fernseher im 1,5- bis 2,5-fachen Abstand der Diagonale; Arbeitsgang vor der Küchenzeile 100–120 cm; vor WC und Waschtisch 55–75 cm; Bilder mit Mitte bei 145–150 cm und etwa zwei Drittel der Möbelbreite; im Wohnbereich stehen mindestens die vorderen Füße der Sitzmöbel auf dem Teppich; Licht in Grund-, Zonen- und Stimmungslicht, warmweiß 2700–3000 K.

**Forschung zur automatischen Raumplanung:**
| Ansatz | Kern | Was wir übernehmen |
|---|---|---|
| Merrell et al. 2011, Yu et al. 2011 („Make it Home“) | Gestaltungsregeln als Kostenfunktion, Optimierung mit Simulated Annealing | Regeln als gewichtete Kosten, Annealing für die Feinplatzierung |
| Kán & Kaufmann 2017 | Genetischer Algorithmus mit Regel-Kosten, auch Möbelauswahl und Farben | Auswahl und Anordnung zusammen bewerten |
| Holodeck (CVPR 2024) | Sprachmodell liefert räumliche Beziehungen (an Wand, vor, neben, gegenüber), Solver stellt auf | Beziehungs-Vokabular statt Koordinaten-Raten |
| Open-Universe Indoor Scene Generation (2024) | Sprachmodell schreibt ein deklaratives Layout-Programm, das als Optimierungsproblem gelöst wird | Raumkonzept als Programm mit festem Vokabular |
| LayoutVLM (CVPR 2025) | Bild-Sprachmodell gibt Startpositionen und Beziehungen, danach Optimierung | Claudes Positionen als Startwert, Beziehungen als Kosten |
| FlairGPT (2025) | Sprachmodell arbeitet in Designer-Phasen (Zonen, Objekte, Beziehungen), Optimierer stellt auf; Ergebnis: Sprachmodelle allein schaffen kein sauberes Layout, Solver allein keinen Sinn | genau diese Arbeitsteilung |
| Infinigen Indoors (2024) | Regel-Sprache und Simulated Annealing mit diskreten und stetigen Zügen | Zugarten und Temperaturverlauf für den Solver |
| Roomer (2026), AutoLayout (2025) | Vorschlag, dann prüfen vor dem Übernehmen, Reparatur bei Kollision, blockierter Öffnung oder Weg; geschlossene Selbstprüfung | Begehung als Sperre und Reparatur-Schleife |

**Folgerung:** Das Sprachmodell soll denken wie ein Designer (Konzept, Zonen, Beziehungen, Begründung), das Rechenverfahren soll genau sein (Maße, Abstände, Wege). Heute macht Claude nur die Liste und die App rät die Anordnung. Neu macht Claude das Konzept mit Plätzen und die App setzt es sauber um und prüft es.

## 4. Neuer Aufbau

Neuer Ordner `src/design/` (lässt die laufende Pipeline unangetastet, bis die neue besser ist). Händler-Code bleibt in `src/catalog/providers`.

```
Stufe 0  Raum lesen (App)            → RoomAnalysis je Raum, FlatAnalysis
Stufe 1  Wohnkonzept (Claude, 1×)     → FlatConcept: Nutzung, Stil, Funktion→Raum, Typ je Raum
Stufe 2  Raumkonzept (Claude, je Raum)→ RoomProgram: Zonen, Möbel mit Startplatz, Beziehungen
Stufe 3  Aufstellen (Solver)          → Layout (Positionen), nicht platzierbare Teile mit Grund
Stufe 4  Begehung (App)               → Review: Befunde, Punktzahl, Sperre bei schweren Befunden
Stufe 5  Kritik (Claude, ≤ 2 Runden)  → Programm-Änderungen → zurück zu Stufe 3
Stufe 6  Produkte (bestehende Suche)  → echte Produkte, Neuaufstellung und Begehung mit echten Maßen
```

### Stufe 0: Raum lesen (`src/design/analysis/`)
- Wände je Raum zusammengefasst (gerade Wandstücke über Anschlussstellen hinweg vereinigt; behebt M6), mit Himmelsrichtung, Länge, Endpunkten, Öffnungen (Tür: Ziel-Raum, schlägt hinein/hinaus, Schwenkfläche; Fenster: Brüstung, Oberkante) und freien Wandstücken ab 60 cm.
- Echte Ecken (innen/außen), mit Hinweis „Tür in der Nähe“, Abstand zum nächsten Fenster.
- Wege: kürzeste Wege zwischen allen Türen im leeren Raum (Bestand zählt), als Linie und als Schlauch (90 cm in Gang, Vorraum und Durchgangszimmern, sonst 70 cm); bei mehr als vier Türen (Gang, Vorraum) von der Haupttür zu jeder anderen Tür. Durchgangszimmer werden aus dem Wohnungsgraph erkannt (Raum liegt auf dem Weg von der Wohnungstür zu einem anderen Raum).
- Blick beim Eintreten (Haupttür, Richtung in den Raum), Tageslichtbereich je Fenster.
- Vom Nutzer markierte Bereiche (mgritsch04/wohnungsplaner-3d#416) mit Zweck; „frei lassen“ wird zur Sperrfläche.
- Textform für Claude in Raumkoordinaten (cm, Nordwest-Ecke = 0,0, x nach Osten, y nach Süden) wie im Versuch (Anhang A), dazu eine Kurzübersicht der ganzen Wohnung.
- Wiederverwendung: `derivePlan`, `roomEdges`, `shortestWalkPath`, `doorSymbol`/Schwenkflächen aus `model/placement.ts` (exportieren).

### Stufe 1: Wohnkonzept (Claude, ein Aufruf, Opus)
- Eingabe: Wohnungsübersicht, Wünsche, markierte Bereiche des Nutzers, Bestand, Budget.
- Ausgabe: Nutzung (2–3 Sätze), Stil (Leitidee, Materialien, Palette), Funktionen mit genau einem Raum und Grund, je Raum Typ, Rolle, Funktionen, Ankermöbel, Akzentfarbe, „gehört nicht hierher“.
- App prüft und lässt einmal reparieren: jede gewünschte Funktion zugeordnet, Einzelfunktionen (Esstisch, Gästeschlafplatz, Küchenzeile) nur einmal, Schlafzimmer hat „Schlafen“, Sanitär nicht neu.
- Der Typ aus dem Wohnkonzept gilt danach überall (Leitlinien, Pflichtmöbel, Prüfung); behebt M3, M4, M7.

### Stufe 2: Raumkonzept als Layout-Programm (Claude, je Raum parallel; Opus für Wohn-, Schlaf-, Küchen- und Durchgangsräume, Sonnet für kleine Räume)
- Eingabe: Wohnkonzept, Raumskizze aus Stufe 0, feste Regeln (Maße oben), Produkte (eigene und Platzhalter mit Maßen).
- Arbeitsauftrag in Designer-Reihenfolge: Raum lesen → Zonen (Rechteck, Grund) → Ankermöbel → Begleitmöbel mit Beziehungen → Licht, Textil, Deko → Begehung im Kopf.
- Ausgabe (JSON, Schema in Anhang B): `reading`, `zones[]`, `items[]` (catalogId, Zone, Startplatz x/y/Blickrichtung, Beschreibung, Farbe, Grund), `relations[]` aus festem Vokabular, `kitchen` (Wand, von, bis, Module), `walk`, `check`.
- Beziehungs-Vokabular (geschlossen, vom Solver verstanden): `wall` (Rücken an Wand Wn, optional Bereich), `corner` (Ecke zweier Wände), `center` (frei in Zonenmitte), `front-of` (vor B mit Abstand), `left-of`/`right-of` (neben B aus Bs Sicht), `pair` (beidseitig symmetrisch), `facing` (schaut zu B, Abstand), `around` (Stühle um Tisch), `above` (Bild, Spiegel, Pendel, Wandregal über B), `under-front`/`under-all` (Teppich), `on` (Tischlampe, kleine Pflanze auf Ablage oder Fensterbank), `window` (seitlich am oder vor dem Fenster), `near`, `away`, `align`.
- App prüft und lässt einmal reparieren: IDs gültig, Zone im Raum, Pflichtmöbel des Typs da, keine verbotenen Teile (aus dem Wohnkonzept), Anzahl plausibel.

### Stufe 3: Aufstellen (Solver, `src/design/solver/`, deterministisch, im Browser)
- **Abhängige Teile werden nicht optimiert, sondern abgeleitet:** Stühle um Tisch, Nachttische am Bett, Teppich unter Sitzgruppe oder Bett, Bild und Pendel darüber, Tischlampe und kleine Pflanze auf ihrer Ablage, Vorhang am Fenster, Matratze im Bett, Boxen im Regal. Sie wandern mit ihrem „Elternteil“. Optimiert werden nur Hauptstücke (Bett, Sofa, Tisch, Schrank, Regal, Sessel, Schreibtisch, große Pflanzen, Stehlampen, Küchenzeile als Block).
- **Harte Regeln:** im Raum; Möbel einer vom Nutzer markierten Zone liegen in ihr, Sperrflächen („frei lassen“) bleiben leer; keine Überlappung (Pflanzen und Stehlampen zählen mit); zwischen allen Türen eines Raums bleibt ein Weg der verlangten Breite (`checkWalkways`; der Weg aus Stufe 0 ist die Referenz für Umwege, nicht die einzige erlaubte Linie; Teppiche zählen nicht); Türschwenk frei; vor Fenstern nichts über Brüstungshöhe (außer Vorhang); Bewegungsfläche vor jedem Möbel frei (Bewegungsflächen dürfen sich mit Wegen und untereinander überlappen, nicht mit Möbeln); Wandteile an Wand ohne Öffnung; jedes nutzbare Möbel von einer Tür aus erreichbar.
- **Weiche Kosten (gewichtet):** Beziehungen aus dem Programm, Nähe zum Startplatz und zur Zone (Claudes Idee bleibt erhalten), Designer-Regeln (Bett-Kopfteil nicht unter Fenster, Schreibtisch seitlich zum Licht, Sofa nicht mit dem Rücken direkt vor der Zimmertür, Paare symmetrisch, Fluchten bündig, Mittelachsen, Gewicht im Raum verteilt, Blickfang vom Eingang sichtbar), bequeme statt minimale Abstände.
- **Keine Warum-Momente (nach dem ersten Bildvergleich, #442):** Das Sofa schaut zum Fernseher, stark gewichtet; nennt Claude nur „tv facing sofa“, gilt die Gegenrichtung mit, ohne jede Beziehung schaut das einzige Sofa des Raums zum Fernseher. Eine Pflanze ohne Beziehung steht in einer Ecke, am Fenster oder an der Wand und nicht auf dem Weg zwischen den Türen. Ein Sessel für sich schaut zur Sitzgruppe. Läufer und Matten liegen direkt vor ihrem Möbel, egal welchen Abstand das Programm nennt. Die Pendelleuchte eines weggelassenen Tisches fällt mit weg.
- **Verfahren:** 1. Startlösung aus Claudes Plätzen (auf nächste Wand bzw. 90°-Raster einrasten), zusätzlich eine Startlösung „Ankermöbel zuerst“ über Wand-Slots (Fallback, falls Claudes Plätze schlecht sind). 2. Reparatur harter Verstöße mit lokalen Zügen (entlang der Wand schieben, Wand wechseln, drehen, tauschen), nur übernehmen, was die Prüfung besteht. 3. Simulated Annealing mit diskreten und stetigen Zügen, geometrische Abkühlung (etwa 0,25 → 0,001), 2.000–5.000 Schritte je Raum, drei Starts mit festem Seed (wiederholbar). Ziel unter 300 ms je Raum, Belegungsraster 5 cm.
- **Wenn etwas nicht passt:** kleinere Variante desselben Typs (Bett 160 → 140, Sofa 3 → 2, Schreibtisch 140 → 100), sonst weglassen mit Grund. Pflichtmöbel nie still weglassen, sondern als schwerer Befund an Stufe 5.
- Küche: Zeile als Block an der Wand, die Claude wählt; Modulfolge aus dem Programm, vorhandene `kitchenDesign`-Logik für Oberschränke, Arbeitsplatte, Haube weiterverwenden; Türschwenk und Balkontür hart prüfen (behebt M2). Das Kochfeld setzt der Solver selbst (`kitchenTops.ts`): auf den Backofen, sonst auf einen Unterschrank mit 60 cm Arbeitsfläche zur Spüle und 30 cm Abstand zu Hochschrank und Wand, möglichst nicht unter ein Fenster; die Haube hängt darüber, außer dort ist ein Fenster.

### Stufe 4: Begehung (`src/design/review/`)
Prüfliste „würde das jemand so einrichten?“ mit Schwere (S = schwer, sperrt die Anzeige; M = mittel; L = leicht). Jeder Befund hat Text in Alltagssprache, Raum, betroffene Teile und Ort (für die Markierung im Plan).

**A Funktion**
- A1 (S) Pflichtmöbel des Raumtyps fehlen: Schlafzimmer Bett (+ Schrank oder Kommode ab 8 m²: M); Wohnzimmer ein Sofa oder Sessel und Sitzplätze für mindestens 3 (Stühle am Esstisch im selben Raum zählen mit, etwa in der Garçonnière); Küche und jeder Raum mit Küchenzeile (Wohnküche) Spüle, Kochfeld, Kühlschrank, Arbeitsfläche (Unterschrank oder Geschirrspüler); Esszimmer Tisch und Stühle; Arbeitszimmer Schreibtisch und Stuhl; Gang/Vorraum Garderobe; Bad Waschtisch, WC oder Dusche/Wanne (Bestand zählt); WC: WC und Handwaschbecken (Handwaschbecken: M); Kinderzimmer Bett, Stauraum, Tisch; Balkon Sitzplatz ab 2 m².
- A1 (M) Pflichtmöbel des Programms passt nur in einer kleineren Variante hinein (Doppelbett kam als Einzelbett).
- A2 (M) Funktion ohne Grund doppelt in der Wohnung (Esstisch, Gästeschlafplatz, Küchenzeile, Fernseher).
- A3 (S) Sanitärobjekt neu geplant (WC, Waschtisch, Dusche, Wanne), außer ausdrücklich gewünscht oder Handwaschbecken im WC.
- A4 (M) Küche: Arbeitsfläche zwischen Spüle und Kochfeld unter 60 cm, Kochfeld unter 30 cm neben Hochschrank oder Wand, Arbeitsdreieck Kühlschrank–Spüle–Kochfeld unter 3,6 m oder über 7 m. Eine reine Bestandsküche wird nicht bewertet.
- A5 (M) Ankermöbel nicht in seiner Zone (z. B. „Leseecke“ ohne Sessel am Fenster oder in der Ecke; auf dem Balkon zählt der Stuhl als Sitz).

**B Wege und Zugang**
- B1 (S) Kein Durchkommen zwischen zwei Türen eines Raums (Balkontür zählt).
- B2 (M) Hauptweg schmaler als 90 cm (Gang, Vorraum, Durchgangszimmer) bzw. 70 cm (sonst).
- B3 (L) Weg mehr als 25 % plus 50 cm länger als im leeren Raum.
- B4 (S) Etwas steht im Türschwenk (auch Pflanze, Stehlampe).
- B5 (M) Festes Möbel weniger als 50 cm hinter der Tür im Gehbereich.
- B6 (M) Bewegungsfläche fehlt: vor Schrank unter 70 cm, neben dem Bett unter 50 cm (Doppelbett beidseitig), Stuhlzone am Schreibtisch unter 75 cm, vor der Küchenzeile unter 100 cm (unter 120 cm: L), vor WC und Waschtisch unter 55 cm.
- B7 (M) Möbel ist nicht erreichbar.
- B8 (L) Kein Fenster des Raums ist erreichbar (nicht auf dem Balkon).

**C Anordnung**
- C1 Bett: Kopfteil nicht an einer Wand oder Bett frei im Raum (M); Kopfteil unter dem Fenster (L); Doppelbett nur von einer Seite zugänglich (M).
- C2 Sitzgruppe: Couchtisch nicht 30–60 cm vor dem Sofa (M); Sessel nicht der Sitzgruppe zugewandt (M); Sofa mit dem Rücken weniger als 1 m vor der Zimmertür (L); Sofa im Wohnzimmer ab 12 m² ohne Couchtisch (L).
- C3 Fernseher: nicht gegenüber dem Sofa, Abstand außerhalb 1,5–2,5 × Diagonale, vor einem Fenster (M); seitlich oder hinter dem Sofa, mehr als 80° aus seiner Blickrichtung (S). Ohne Fernseher: Sofa schaut auf nichts, kein Fenster, kein großes Bild und keine Sessel im Blickfeld (45°, 6 m) (M).
- C4 Esstisch: Stühle nicht am Tisch (M); Stuhlzone auf mehr als einer Seite unter 75 cm (L); Pendel nicht über dem Tisch (L); Tisch im Arbeitsgang der Küche (M).
- C5 Schreibtisch: Fenster direkt hinter dem Bildschirm oder im Rücken (L).
- C6 (M) Hohes Möbel über 1,2 m frei im Raum (außer bewusst als Raumteiler geplant).
- C7 (M) Etwas Höheres als die Brüstung direkt vor dem Fenster (außer Vorhang).
- C8 (L) Wandmöbel schief oder mit Spalt von 5–30 cm zur Wand.
- C9 (M) Eingeklemmt: zwei feste Möbel enger als 20 cm, wo man sitzt oder durchgeht (Paare wie Nachttisch–Bett und Regal–Regal ausgenommen).

**D Deko, Licht, Textil**
- D1 Pflanze nicht in einer Ecke, nicht neben einem Möbel und nicht am Fenster (M); Pflanze im Wege-Schlauch (S, in jedem Raum); große Pflanze in fensterlosem Raum (L: Schattenpflanze oder Kunstpflanze vorschlagen).
- D2 (M) Kleine Pflanze, Kräutertopf oder Box auf dem Boden statt auf Fensterbank, Regal oder Arbeitsplatte.
- D3 (M) Tischlampe nicht auf Nachttisch, Sideboard, Kommode, Schreibtisch oder Regal.
- D4 (L) Zone ohne Licht (Leseecke ohne Steh- oder Tischlampe, Esstisch ohne Pendel, Schreibtisch ohne Lampe, Sofa ohne Steh- oder Tischlampe daneben; nicht auf dem Balkon); Raum über 10 m² mit nur einer Lichtquelle.
- D5 (L) Teppich: Sitzgruppe steht nicht mit den Vorderfüßen darauf; Bettteppich ragt seitlich weniger als 40 cm heraus; Teppich im Türschwenk; Läufer nicht mittig im Gang.
- D6 (L) Bild oder Spiegel: über Sofa/Bett nicht mittig (über 10 cm) oder nicht 40–90 % der Möbelbreite; über Fenster oder Tür; Badspiegel nicht über dem Waschtisch.
- D7 (L) Vorhang schmaler als das Fenster; Schlafzimmer ohne Verdunkelung, wenn gewünscht.
- D8 (L) Zu viel Gleiches: mehr als eine Deckenleuchte je 6 m² im Gang, mehr als drei Bilder ohne geplante Bildergruppe, gleiche Teile ohne Beziehung.

**E Gesamteindruck**
- E1 Belegung außerhalb des Bereichs je Typ (Wohnen 20–45 %, Schlafen 25–50 %, Arbeiten 20–45 %, Gang bis 20 %): zu voll (M), halbherzig leer unter 15 % in Wohn- und Schlafräumen (M), unter dem Bereich eher leer (L).
- E2 (L) Möbel mehr als 1 m außerhalb seiner Zone; Zonen überlappen stark.
- E3 (L) Zusammengehöriges getrennt (zwei Bücherregale an verschiedenen Wänden derselben Zone, Stühle ohne Tisch).
- E4 (L) Farbe außerhalb der Palette.
- E5 (L) Blickfang von der Haupttür aus verdeckt.
- E6 (M) Eine Hälfte eines Hauptraums ab 12 m² bleibt fast leer (unter 15 % Möbelfläche), in der anderen steht mindestens dreimal so viel (T6: die Bildprüfung nannte „halb eingerichtet“ in fast jedem Raum). Ebenso eine freie Fläche von mehr als etwa 3,6 m Durchmesser ohne Möbel und Teppich (frei zu lassende Bereiche des Nutzers zählen als belegt).

**Punktzahl je Raum:** 100 minus 25 je S, 8 je M, 2 je L (nicht unter 0). „Bestanden“ heißt keine S-Befunde und mindestens 85 Punkte. Dazu Kennzahlen: Weglängen leer/eingerichtet, Belegung, Abweichung vom Programm. Dieselben Regeln nutzt der Solver als Kosten, die Kritik-Stufe als Eingabe und die Tests als Maßstab. In der App erscheint je Raum „Begehung: alle 35 Punkte erfüllt“ oder die Liste der leichten Befunde.

### Stufe 5: Kritik (Claude, höchstens zwei Runden; gründlich Opus, schnell Sonnet)
- Eingabe: Programm, Bild des aufgestellten Raums von oben (Grundriss mit Beschriftung, Zonen, Wegen), Befunde und Punktzahl. Bilder gehen im Claude-Artefakt über `sample` mit `images` (Fähigkeit `{sample:{images:true}}` deklarieren); lokal über den Helfer (Bild als Datei, die Claude Code liest). Ohne Bildunterstützung: Textkarte (Skizze plus Möbelliste mit Plätzen).
- Ausgabe: Änderungen am Programm (Zone verlegen, Beziehung ändern, Teil tauschen, weglassen oder ergänzen), keine Koordinaten-Bastelei. Danach Stufe 3 und 4 neu.
- Abbruch: keine S-Befunde und mindestens 85 Punkte, oder zwei Runden erreicht (dann das beste Ergebnis).
- Blick vor der Abgabe (T6): Ein Hauptraum, der sofort besteht, bekommt trotzdem einen Blick aufs Bild – Claude prüft wie eine Innenarchitektin, was keine Regel sieht (Ausrichtung der Sitzgruppe, Sessel vor dem Fenster, Licht, verteilte Zonen). Übernommen nur, wenn der Raum weiter besteht und höchstens 4 Punkte verliert.

### Stufe 6: Produkte
- Bestehende Produktsuche (productSearch.ts, searchRun.ts) bleibt. Neu: nach dem Ersetzen mit echten Maßen Stufe 3 und 4 erneut; ein Produkt, das einen S-Befund auslöst, wird nicht übernommen (nächster Treffer oder kleinere Größe). Zone und Beziehungen bleiben am Teil (behebt M12).

### Anzeige in der App
- Je Raum: „So ist der Raum gedacht“ (Rolle, Zonen, Blickfang, Wege), Zonen als zarte Flächen im 2D-Plan, je Möbel der Grund (Tooltip), Ergebnis der Begehung.
- Vorschlag erst zeigen, wenn die Begehung bestanden ist (sonst Reparatur, notfalls mit sichtbarem Hinweis).
- Optional später: zwei Varianten je Hauptraum (andere Zonen) zur Auswahl.

## 5. Qualitätssicherung

1. **Plausibilitätsregeln (Stufe 4) als Sperre:** kein Vorschlag mit schwerem Befund.
2. **Sechs Testwohnungen** (im Repo, erfunden, je mit Wünschen): A und B wie oben; C Familie 4 Zimmer mit L-förmigem Wohn-Essraum und Kinderzimmer; D Garçonnière 30 m² (Wohnen und Schlafen in einem Raum); E Altbau mit vielen Türen im Wohnzimmer und schrägem Erker (nicht rechteckig); F Neubau mit offener Wohnküche, Schrankraum und zwei Bädern.
3. **Regressionstests in CI (ohne Claude):** aufgezeichnete Claude-Programme der Testwohnungen als Fixtures → Solver → Begehung: keine S-Befunde, Punktzahl über Schwelle, Kennzahlen als Snapshot. Dazu Invarianten-Tests mit zufälligen Räumen (Rechteck, L-Form, Türen und Fenster zufällig): Wege zwischen Türen bleiben frei, keine Pflanze im Gang-Schlauch, Schlafzimmer ab 7 m² hat ein Bett, kein Sanitär neu, kein Teil im Türschwenk, Ergebnis ist bei gleichem Seed gleich.
4. **Benchmark mit echtem Claude (lokal, Skript):** ganze Pipeline auf allen Testwohnungen, Bericht mit Punktzahlen, Befunden, Weglängen, Screenshots 2D/3D; Vergleich mit dem heutigen Stand (Lauf vom 23.10. als Ausgangswert).
5. **Unabhängige Bildprüfung:** ein eigener Claude-Aufruf (Opus) bewertet jeden Hauptraum anhand der Screenshots nach einer festen Checkliste mit 1–10 („würde eine Innenarchitektin das so abgeben?“). Nur zusätzliches Signal, die Regeln bleiben maßgeblich.
6. **Vorher/Nachher-Seite für G** mit Bildern je Testwohnung, danach Gs Test mit der eigenen Wohnung (echte Daten, daher `user-test`).

## 6. Versuch „Konzept zuerst“ (23.10., Testwohnungen A und B)

Prototyp nur mit Stufe 0 bis 2: Raumskizze als Text, ein Wohnkonzept-Aufruf, dann je Raum ein Raumprogramm mit Opus. Die Möbel wurden **ohne Solver** genau an Claudes Startplätze gestellt, um zu sehen, wie gut der Rohentwurf schon ist. Claudes Antworten liegen unverändert in `src/design/fixtures/recorded/`.

| Prüfpunkt | Heute (Lauf 23.10.) | Konzept zuerst, ohne Solver |
|---|---|---|
| Esstische in A | 2 (Wohnzimmer und Küche) | 1 (Küche, bewusst begründet) |
| Gästeschlafplätze in A | 2 (Schlafsofa und Tagesbett) | 1 (Schlafsofa im Arbeitszimmer) |
| Zusätzliches WC im Bad von A | ja | nein („keine zusätzlichen Sanitärobjekte“) |
| Handwaschbecken im WC von A | fehlt | geplant (40 cm) |
| B: Wege durch die Wohnküche (Eingang, Schlafzimmer, Balkon) | alle drei blockiert | alle drei frei (z. B. Balkon → Schlafzimmer 6,6 m statt 5,8 m im leeren Raum) |
| B: Kühlschrank vor der Balkontür | ja | nein, Küchenzeile zwischen Fenster und Balkontür, Spüle unter dem Fenster |
| A: Küche über die Tür erreichbar | nein (Spüle, Geschirrspüler im Türaufschlag) | ja |
| Tischlampe auf dem Esstisch, Kräuter am Boden | ja | nein (Lampen auf Sideboard, Nachttisch, Schreibtisch; Kräuter auf Fensterbank und Arbeitsplatte) |
| Wohnzimmer A | Sitzgruppe, Esstisch und eingeklemmter Sessel durcheinander | klare Zonen: Sofa mit Blick zum Fernseher an der Südwand, Leseecke am Westfenster mit Regalen, Pflanzenkante an der Fensterseite, Sideboard mit Bild als Blickfang beim Hereinkommen, Weg Gang → Balkon 90 cm frei |

**Was Claude dabei zeigt:** Es liest den Raum wie ein Profi (zum Beispiel B: „Alle drei Türen liegen an den Rändern, deshalb läuft der Verkehr L-förmig an der Nord- und Westseite; der ruhige Rest im Süden und Osten bleibt zum Essen und Wohnen“), begründet jede Zone und prüft selbst Wege, Türschwenk, Fenster, Abstände und Licht in drei Ebenen.

**Was der Rohentwurf noch falsch macht (Aufgabe für Solver, Prüfung und Kritik):**
- Teile, die auf oder über einem anderen stehen (Tischlampe auf dem Sideboard, Oberschrank über der Waschmaschine, Bild über dem Bett), stehen im Versuch noch am Boden und kollidieren (24 Meldungen in A). Der Solver leitet sie aus den Beziehungen ab.
- Einige Abstände sind zu knapp (Sessel 17 cm neben dem Sofa, Lowboard 10 cm neben dem Regal), ein Handwaschbecken steht direkt hinter der WC-Tür, ein Regal 44 cm hinter der Abstellraumtür. Das korrigiert der Solver mit den harten Regeln.
- Claude hat das vorhandene WC noch einmal in die Liste geschrieben und ein paar Beziehungen außerhalb des Vokabulars benutzt („next-to“, „beside“): strenges Schema, Zuordnung von Synonymen und eine Reparatur-Runde (T2).
- Laufzeit: Wohnkonzept 40 s, Raumprogramm meist 1–3 Minuten je Raum mit Opus, einmal 10 Minuten (große Wohnküche). Ein Raum fiel wegen eines Nutzungslimits aus: Wiederholen, Zeitlimit, kleine Räume mit Sonnet.

**Fazit:** Der Ansatz trägt. Schon der Rohentwurf ist sinnvoller als das heutige Endergebnis; mit Solver, Begehung und Kritik kommt die Genauigkeit dazu.

## 7. Umsetzung: Teilaufgaben

Reihenfolge in Wellen. Welle 1 kann parallel starten, sobald T0 die Schnittstellen festgelegt hat. Jede Aufgabe bekommt ein eigenes Issue und einen eigenen PR (Refs statt Closes, `## Testschritte`, Label `auto-user-test`).

| Nr | Aufgabe | Dateien | Hängt ab von | Modell | Umfang |
|---|---|---|---|---|---|
| T0 | Gerüst und Schnittstellen: `src/design/types.ts` (RoomAnalysis, FlatConcept, RoomProgram, Relation, Layout, Finding, Review), Ordner, sechs Testwohnungen als Fixtures (`src/design/fixtures/`), Aufnahme-Skript für echte Läufe | neu | – | Opus | klein |
| T1 | Stufe 0 Raum lesen: zusammengefasste Wände, Ecken, Türziele, Schwenkflächen, Wege-Schläuche, Durchgangszimmer, Textform für Claude; Tests auf allen Testwohnungen | `src/design/analysis/`, Export der Schwenkflächen aus `model/placement.ts` | T0 | Sonnet | mittel |
| T2 | Stufe 1 und 2: Prompts Wohnkonzept und Raumkonzept, JSON-Schemas, Prüfung und Reparatur-Runde, Fake-Antworten für Tests | `src/design/concept/` | T0 (T1-Text kann anfangs aus dem Prototyp kommen) | Opus | mittel |
| T3 | Stufe 3 Solver: Ableitung abhängiger Teile, harte Regeln, Kosten, Startlösungen, Reparatur, Annealing, Größen-Fallback, Küche als Block; Laufzeit-Test | `src/design/solver/` | T0, Schnittstelle von T1 | Opus | groß |
| T4 | Stufe 4 Begehung: alle Regeln A–E mit Texten, Punktzahl, Orte für die Markierung; Tests je Regel mit Gut- und Schlecht-Beispiel | `src/design/review/` | T0, Schnittstelle von T1 | Sonnet | mittel bis groß |
| T5 | Einbau: neuer Ablauf in `designRun`, Kritik-Schleife mit Bild (Artefakt `sample` mit Bildern, lokaler Helfer), Produkte mit Neuaufstellung, Anzeige (Zonen, Gründe, Begehung), alter Ablauf als Rückfall | `assistant/designRun.ts`, `assistant/design.ts`, `assistant/DesignPanel.tsx`, `assistant/productSearch.ts`, Helfer-Skript | T1–T4 | Opus | groß |
| T6 | Benchmark und Vorher/Nachher: Skript für echte Läufe auf allen Testwohnungen, Screenshots, unabhängige Bildprüfung, Bericht und Seite für G; Feinabstimmung der Gewichte | `scripts/`, `e2e/` | T5 | Sonnet | mittel |

- **Welle 1 (parallel, 4 Threads):** T1, T2, T3, T4, sobald T0 die Schnittstellen festgelegt hat.
- **Welle 2:** T5. **Welle 3:** T6, danach Abnahme durch G.

### Stand am 24.10.2026

T0 bis T5 sind gebaut und gemergt (PRs #444 bis #453). Was anders kam als geplant:

- Der Ablauf wohnt in `src/design/run.ts` (`runFurnishing`), die Kritikrunde in `src/design/critique.ts`, die Übernahme ins Projekt in `src/design/apply/` – nicht in `assistant/designRun.ts`. Der Kern bleibt so frei von Oberfläche, und `designRun.ts` ist unverändert der alte Weg.
- Im Panel wählt „Verfahren“ zwischen **Wohnkonzept** (neu, voreingestellt) und **Möbelliste** (alt, Rückfall).
- Bilder: im Artefakt über die Fähigkeit `{ sample: { images: true } }`, lokal über den Helfer ab Version 4 (Bild als Datei im Arbeitsordner, Claude Code liest es mit dem Read-Werkzeug). Ohne Bildunterstützung geht die Textkarte mit.
- Aufstellen und Planprüfung messen denselben Platz (PR #452): Der Streifen, auf dem `placementIssues` besteht, ist Teil der Bewegungsflächen des Solvers. Mit den aufgezeichneten Antworten löst kein übernommenes Möbel mehr einen Befund der Planprüfung aus.
- Gemessen (aufgezeichnete Antworten, Seed 1): Wohnung B erreicht 100 / 92 / 94 / 86 Punkte, alle vier Räume bestanden. Offen sind Räume, die ihre Befunde erst mit einer echten Kritikrunde loswerden (Wohnküche B: Fernseher nicht gegenüber dem Sofa; Garçonnière D: zu wenige Sitzplätze). Das misst T6.

T6 (Benchmark, #443), Stand 24.10.2026:

- Werkzeuge: `e2e/designBenchmark.spec.ts` (`WP_BENCH=1` echter Lauf, `WP_REPLAY=<Lauf>` gleiche Antworten mit neuem Code, `WP_SHOTS=<Lauf>` nur Bilder, `WP_HEUTE=1` alter Ablauf für A/B), `scripts/design-image-review.mjs` (unabhängige Bildprüfung, 1–10 je Hauptraum, feste Liste), `scripts/design-bench-fixture.mjs` (Antworten eines Laufs als Testdatei).
- Regression: `src/design/benchmark.test.ts` spielt die aufgezeichneten Antworten aller sechs Testwohnungen ohne Claude ab und prüft die Abnahme (kein S-Befund, Wohnung ab 85, kein Raum unter 75).
- Gemessen (echtes Claude): alter Ablauf A 76,1 / B 68,4; neu A 98,4, B 97,6, C 94,6, D 96,7, E 94,8, F 92,7. Die Regel-Abnahme ist für alle sechs erfüllt.
- Bildprüfung der Haupträume: neu 4–7 von 10 (alter Ablauf A/B 4–6). Das Ziel 8 ist noch nicht erreicht. Häufig bemängelt: Sofa ohne Gegenüber, leere Raumhälfte, fehlendes Arbeitslicht in Küchen (kein Katalogteil), Pflichtmöbel wird in engen Durchgangsräumen kleiner statt ein Nebenteil wegzulassen.

- Runde gegen die häufigsten Mängel (24.10.): Ein enger Raum lässt eher einen Nachttisch oder ein Regal weg, als das Pflichtmöbel zu verkleinern (Löser, F Schlafzimmer behält das Doppelbett 180, 86 → 94 Punkte). Die Prüfung meldet ein Sofa ohne Gegenüber (C3) und große freie Flächen ohne Möbel (E6), das Raumprogramm verlangt ein Gegenüber für jedes Sofa. Echter Lauf danach: A 96,4 · B 92,8 · C 92,8 · D 94,7 · E 94,0 · F 93,8 (strengere Regeln, daher teils unter den Werten davor). Bildprüfung unverändert 5–7 von 10; häufigste Mängel jetzt: Möbel nur an den Wänden mit leerer Mitte, Sitzgruppe zerfällt (Sessel abgestellt, Sofa neben dem Teppich), Küchen zerstückelt, fehlender Stauraum im Schlafzimmer. Die aufgezeichneten Antworten der Regression bleiben die vom 24.10. Mittag.

- Runde 3 (25.10.): Der Löser meidet in Wohn- und Schlafräumen ab 12 m² große freie Flächen (gleiche Messung wie E6 auf grobem Raster), ein Sessel der Sitzzone steht höchstens 90 cm vom Couchtisch, zwei Küchenzeilen im rechten Winkel schließen ohne Lücke. Leere Teppiche, Stühle, Pflanzen und Lampen zählen in Prüfung und Löser nicht mehr als möbliert. Vom Nutzer markierte Bereiche gelten nur ungefähr: ein Möbel darf bis 60 cm hinausragen (frei zu lassende Bereiche bis 15 cm streifen), statt als Pflichtmöbel zu fehlen. Raumprogramm: zusammenhängende Küchenzeile, Spielfläche im Kinderzimmer, vollständige Leseecke, kein großes Sofa im Arbeitszimmer.
- Gemessen (drei echte Läufe 6–8): Regeln 89–97 Punkte je Wohnung, Bildprüfung im Mittel 5,6 / 5,5 / 5,7 von 10. Die Regel-Runden heben die Bildnote nicht mehr messbar. Die häufigsten Bildmängel bleiben leere Flächen, Sitzecken ohne Ablage und Licht, fehlendes Arbeitslicht in Küchen; viele davon betreffen Teile, die der Katalog nicht hat (Beistelltisch, Unterbauleuchte, Sitzsack).

- Runde 4 (25.10., Bild-Schleife plus Katalog): Der Blick vor der Abgabe sieht den Raum jetzt wie die Bildprüfung, als zwei 3D-Bilder aus der laufenden Ansicht (Eingangsblick bei 1,20 m geschnitten, Draufsicht; `src/assistant/roomShots.ts`), dazu den Plan. Claude benotet den Raum selbst mit derselben Liste und bessert nach, solange die Note unter 8 liegt (`LOOK_ROUNDS`). Katalog: Beistelltisch Ø 45 (eigene Rolle neben Sessel oder Sofa), Pouf/Sitzsack, Lichtleiste unter den Küchen-Oberschränken.
- Gemessen (echter Lauf 9): Claude benotet sich selbst mit 6–7, die unabhängige Bildprüfung gibt im Mittel 5,4 (4–7), also im Rahmen der Läufe 6–8. Ein zweiter Blick änderte Claudes Note nicht, daher nur noch ein Blick. Die häufigsten Mängel sind jetzt Platzierungen innerhalb einer Gruppe: Couchtisch und Teppich nicht direkt vor dem Sofa, Fernseher nicht mittig gegenüber, Lampe und Beistelltisch weit weg vom Sitzplatz, Teppich verrutscht unter dem Bett. Das Programm kann sie nur als Beziehung wünschen, der Löser setzt sie zu weich um.

- Runde 5 (30.10., „wie ein Profi“, mgritsch04/wohnungsplaner-3d#458): Regelwerk mit Kennungen als eine Quelle (`src/design/rulebook.ts`), Bausteine je Raumtyp (`concept/groups.ts`: Sitzgruppe mit Teppich, Lampe und Ablage, Bett mit Nachttischen und Teppich, Ankleideplatz …), Raumfakten (Tageslicht je Fenster, laute und ruhige Wände, Flächenziel), Raumprogramm in acht Schritten wie ein Planer mit Bild des leeren Raums. Stil: Palette mit Rollen (60/30/10), Materialien und Formen im Wohnkonzept, Bildprüfung und Blick prüfen den Stil mit, Begehung meldet zu viele Hölzer und Farben (E4), Sitz mit Blick auf eine Rückenlehne (C2) und übereinanderliegende Teppiche (D5). Zwei Fassungen: „Ideal“ (Claudes Plan mit Platzhaltern) und „Kaufbar“ (echte Produkte); die Produktsuche bekommt Optik, Muss-Funktionen und Stil der Wohnung, bewertet die Treffer danach und zeigt die Abweichung vom Ideal. Neu: Einrichtungsblatt (Markdown) zum Nachbauen. Löser: Couchtisch und Teppich der Sitzgruppe bleiben, eher fällt ein Nebenteil weg.
- Gemessen (echter Lauf mit neuem Prompt, A und B, danach mit neuem Löser nachgespielt): Regeln A 96,2 · B 93,2; Bildprüfung A 5/6/7/5, B 6/6 (vorher A 6/5/6/5, B 6/7), im Mittel weiter um 5,8 von 10; die Prüfung streut bei gleichem Bild um ±1. Die B-Wohnküche fiel im echten Lauf zuerst auf 4 (Löser ließ Couchtisch und Teppich weg) und steht nach dem Löser-Fix auf 6. Häufigste Mängel jetzt: leere Raumhälften neben vollen Ecken (Verteilung auf Raumebene), Lesesessel vor dem Fenster, Küchen mit zu wenig Oberschränken und Arbeitslicht, Schlafzimmer ohne Textilien und Ankleideplatz.

- Eichung und Prüfer (30.10. nachmittags, mgritsch04/wohnungsplaner-3d#459): Drei von Hand nach dem Regelwerk eingerichtete Räume bekamen von der festen Bildnote nur 6 / 7 / 5, also so viel wie Claude (5,8). Die feste Note trennt gute und mittlere Pläne kaum. Der Prüfer bekommt jetzt die Regeln seines Raumtyps, die Aufstellung in Zahlen und den Platzhalter-Hinweis; gemessen wird mit dem Paarvergleich zweier Läufe in beiden Reihenfolgen (gleicher Plan: „gleich“). Neue Pflichtteile: Oberschränke auch über 40-cm-Modulen mit Lichtleiste darunter (K5), Vorhänge an jedem Fenster in Wohn- und Schlafräumen (R8). Paarvergleich neu gegen alt (gleiche Claude-Antworten): A Wohnzimmer und Küche besser, Zimmer 1, Zimmer 2 und B Schlafzimmer gleich, B Wohnküche ohne Sieger.

Offen (Stand 30.10.): Maßstab ist der Paarvergleich, nicht mehr die Bildnote 8. Als Nächstes wirkt am meisten die Verteilung der Zonen auf Raumebene; danach die Abnahme durch G mit der eigenen Wohnung. Bisher: Bildnote 8 braucht eine Verteilung der Zonen auf Raumebene (mehrere Varianten je Raum, die beste nach Bild) und einen Löser, der Gruppen (Sitzgruppe, Bett mit Teppich, Lampe am Sitzplatz) noch fester zusammenhält, danach die Abnahme durch G mit der eigenen Wohnung.
- Dateigrenzen: Welle 1 arbeitet nur in neuen Ordnern unter `src/design/` (plus kleiner Export in `model/placement.ts`), also keine Konflikte mit anderen Threads. Erst T5 fasst die bestehenden Dateien an.
- Der alte Ablauf bleibt bis zur Abnahme als Rückfall, danach wird er auf den neuen umgestellt.

## 8. Risiken und offene Punkte
- **Laufzeit und Kosten:** Raumkonzepte brauchen mit Opus etwa 2–3 Minuten je Raum (drei parallel); eine Wohnung mit 9 Räumen etwa 8–10 Minuten plus Kritik. Kleine Räume mit Sonnet, Kritik nur bei Befunden.
- **Bilder im lokalen Helfer:** der Weg über eine Bilddatei für Claude Code muss gebaut werden; bis dahin Textkarte.
- **Gewichte der Kosten** brauchen Feinabstimmung über die Testwohnungen (T6).
- **Nicht-rechteckige Räume** (Erker, Schrägen im Grundriss) sind schwieriger; Testwohnung E deckt das ab.
- **Geschmack:** Regeln sichern „sinnvoll“; „schön“ sichern Konzept, Palette, Kritik und Gs Urteil.

## Anhang A: Raumskizze (Beispiel Testwohnung B, Wohnküche, so bekommt Claude den Raum)

```
Raum „Wohnküche“: 25,2 m², Innenmaß 588 × 428 cm (rechteckig).
Koordinaten in cm: x von West nach Ost, y von Nord nach Süd, (0,0) = Nordwest-Ecke innen.
Wände:
- W1 Nordwand, 588 cm von (0,0) nach (588,0): Fenster bei x=124–264 (Brüstung 90 cm); Tür T1 bei x=469–559, führt zu „Balkon“, Türblatt schlägt in diesen Raum auf. Freie Wandstücke: x=0–124, x=264–469
- W2 Ostwand, 428 cm von (588,0) nach (588,428): Fenster bei y=174–294 (Brüstung 90 cm). Freie Wandstücke: y=0–174, y=294–428
- W3 Südwand, 588 cm von (588,428) nach (0,428): Tür T2 bei x=24–104, führt zu „Schlafzimmer“, Türblatt schlägt nach außen auf. Freie Wandstücke: x=104–588
- W4 Westwand, 428 cm von (0,428) nach (0,0): Tür T3 bei y=49–139, führt zu „Vorraum“, Türblatt schlägt in diesen Raum auf. Freie Wandstücke: y=139–428
Wege zwischen den Türen (kürzester Weg im leeren Raum, muss frei bleiben):
- T1 → T2: 5,8 m über (514,30) → (64,398)
- T1 → T3: 4,9 m über (514,30) → (30,94)
- T2 → T3: 3,1 m über (64,398) → (30,94)
```
Im Produkt kommen dazu: Ecken mit Türnähe, Durchgangszimmer-Kennzeichen, Wege als Schlauch mit Breite, Bestand mit Maßen.

## Anhang B: Raumprogramm (Schema und Auszug aus dem Versuch, B Wohnküche)

```
{"reading": "…",
 "zones": [{"id","function","rect":[x0,y0,x1,y1],"why"}],
 "items": [{"id","catalogId","zone","x","y","facing":"N|O|S|W","label","color","why"}],
 "relations": [[a, rel, b, wert?], …],
 "kitchen": {"wall","from":[x,y],"to":[x,y],"modules":[…]},
 "walk": "…", "check": ["…"]}
```
Auszug (Antwort von Claude, gekürzt):
- Zonen: kochen [104,0,464,180]; essen [120,180,330,428]; wohnen [330,150,588,428]; lesen [462,150,588,240]
- Küche: W1 von x=104 bis 464: Schubladen 60, Spüle 80 (unter dem Fenster), Geschirrspüler, Backofen, Unterschrank 40, Kühlschrank
- Teile (Auswahl): Esstisch (210,298), vier Stühle, Sofa (375,321) Blick nach Osten, Couchtisch 45 cm davor, Fernseher an der Ostwand südlich des Fensters (Abstand 2,1 m), Lesesessel am Ostfenster mit Stehlampe, große Pflanze neben dem Sofa, Kräuter auf der Fensterbank
- Beziehungen: ["coffee","front-of","sofa",45], ["rug","under-front","sofa"], ["tv","facing","sofa",214], ["pendant_table","above","table"], ["lamp_read","right-of","armchair"]
- Wege: „Vom Vorraum geht man nach Osten durch den 115–120 cm breiten Arbeitsgang vor der Küchenzeile … zum Schlafzimmer direkt nach der Vorraumtür entlang der Westwand nach Süden, in einem 90 cm breiten Streifen zwischen Regal und Kopfende des Tisches.“
