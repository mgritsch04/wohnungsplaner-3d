# Regelwerk der Einrichtung

Eine Quelle für Maße und Regeln des Einrichtungsvorschlags (`src/design/rulebook.ts`, mgritsch04/wohnungsplaner-3d#436). Diese Datei wird daraus erzeugt: `WP_WRITE_RULEBOOK=1 npx vitest run src/design/rulebook.test.ts`.

- **Stufe:** H = sonst nicht benutzbar (harte Regel), W = ein Profi würde es anders machen (Warnung), T = Tipp und Stil.
- **Genutzt in:** Prompt (Claude bekommt die Regeln seines Raumtyps mit Kennung), Löser (Maße der Möbelgruppen und Kosten), Begehung (Prüfregeln), Produktsuche (Auswahl echter Produkte).
- **Quellen:** Recherche vom 30.10.2026 (Neufert, DIN EN 12464-1, ASR A1.2, DIN 18040-2, NKBA, AMK, licht.de, Louis Poulsen, Einrichtungsratgeber). Vieles ist Planungsempfehlung, keine Bauvorschrift; „Faustregel“ heißt: übliche Praxis ohne belegbare Quelle.

## Wohnen und Sitzgruppe

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| W1 | W | Gesprächsabstand zwischen gegenüberliegenden Sitzen höchstens 2,4 m (Gruppe 2,4–3 m Durchmesser); Sessel zur Gruppe gedreht, nicht in einer Reihe mit dem Sofa. | Weiter weg muss man lauter sprechen, die Gruppe zerfällt. | Houzz, Ratgeber; Faustregel | Prompt, Löser, Begehung |
| W2 | H | Couchtisch 40–45 cm vor der Sofakante (mindestens 30, höchstens 50 cm), mittig vor dem Sofa. | In Griffweite vom Sitz und trotzdem Platz für die Beine. | Homes & Gardens, livingetc | Prompt, Löser, Begehung |
| W3 | W | Couchtisch ½ bis ⅔ so lang wie das Sofa, Höhe gleich der Sitzhöhe oder 2–5 cm darunter. | Jeder Platz erreicht den Tisch; die Gruppe wirkt im Verhältnis. | livingetc, Wayfair, Ashley | Prompt |
| W4 | W | Beistelltisch 5–10 cm neben der Armlehne, etwa auf Armlehnenhöhe; an jedem Sitz ohne Couchtisch-Griffweite (Sessel, Sofaende) eine Ablage. | Tasse und Buch ohne Aufstehen abstellen. | Wayfair, Ideal Home | Prompt, Löser, Begehung |
| W5 | W | Fernseher mittig gegenüber dem Hauptsitz im 1,2- bis 1,6-fachen Abstand der Bilddiagonale (55″: 1,7–2,2 m; bis 2,5 m noch gut), Bildmitte auf 100–110 cm, nicht gegenüber einem Fenster. | Bildwinkel 30–40° (SMPTE, THX), Augenhöhe im Sitzen, keine Spiegelung. | SMPTE/THX, choose.tv, coolblue | Prompt, Löser, Begehung |
| W6 | W | Teppich der Sitzgruppe: mindestens die Vorderfüße aller Sitzmöbel liegen 15–20 cm darauf; er ist breiter als das Sofa (je Seite 15–45 cm) und liegt mittig unter der Gruppe; 30–45 cm Bodenrand zur Wand. | Ein zu kleiner Teppich zerteilt die Gruppe statt sie zu fassen. | Bed Bath & Beyond, livingetc, Houzz | Prompt, Löser, Begehung |
| W7 | W | Ein Blickpunkt je Raum (Fenster mit Ausblick, Medienwand, großes Bild); das Sofa schaut darauf, nie auf eine leere Wand, Türen oder den Rücken eines anderen Möbels. | Der Raum bekommt eine Ordnung, der Blick ruht. | Vinterior, Rovelab | Prompt, Begehung |
| W8 | H | Der Laufweg führt um die Sitzgruppe herum, nie zwischen Sofa und Couchtisch oder zwischen Sofa und Fernseher. | Sonst läuft man durchs Gespräch und durchs Bild. | Houzz („around, not through“) | Prompt, Begehung |
| W9 | W | Sofa frei im Raum nur mit 75–90 cm Gang dahinter und mit etwas, das den Rücken fasst (Konsole, Sideboard, Leseecke); sonst mit dem Rücken an die Wand; kein Spalt von 15–70 cm dahinter (gilt auch für Schreibtisch und Schränke). | Ein frei stehendes Sofa ohne Halt wirkt verloren; ein schmaler Spalt ist weder Gang noch Wand und sammelt nur Staub. | coohom, livingetc | Prompt, Löser, Begehung |

## Schlafen

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| S1 | W | Kopfteil an eine geschlossene Wand, nicht unter ein Fenster, nicht an die Wand zu Bad, Stiegenhaus oder Nachbarwohnung (dort lieber den Schrank als Puffer). | Halt im Rücken, kein Zug und kein Lärm am Kopf. | Homes & Gardens; Bauakustik-Praxis | Prompt, Begehung |
| S2 | W | Vom Bett aus sieht man die Tür, das Bett steht aber nicht in der Türachse (Füße nicht zur Tür). | Sicherheitsgefühl, und man schaut beim Hereinkommen nicht aufs Bett. | Homes & Gardens, livingetc | Prompt |
| S3 | H | Neben dem Bett 60 cm frei, besser 70–80 cm; ein Doppelbett von beiden Längsseiten zugänglich; am Fußende 60 cm, mit Durchgang 75–90 cm. | Bettmachen, Aufstehen, zu zweit aneinander vorbei. | Simba, Casa Padrino | Prompt, Löser, Begehung |
| S4 | W | Nachttische als Paar links und rechts, Oberkante ±5 cm zur Matratze, je eine Leseleuchte mit gerichtetem Licht (Unterkante 40–50 cm über der Matratze), einzeln schaltbar. | Jeder Schläfer hat Ablage und eigenes Licht, ohne den anderen zu blenden. | Simba, licht.de | Prompt, Löser, Begehung |
| S5 | T | Teppich unter dem Bett: das untere ⅔ des Bettes darauf, seitlich 45–60 cm sichtbar; Nachttische ganz darauf oder ganz daneben. | Morgens auf etwas Weiches treten; das Bett wirkt geerdet. | Amanda Katherine, Welsh Design Studio | Prompt, Löser |
| S6 | W | Bild über dem Bett etwa ⅔ der Bettbreite, Unterkante 15–25 cm über dem Kopfteil. | Fasst das Bett als Blickpunkt. | Montcarta, Edward Martin | Prompt, Löser, Begehung |
| S7 | W | Eine Ankleide-Ecke: Spiegel, Ablage (Kommode, Stuhl oder Bank) beim Schrank, wenn die Kleidung keinen eigenen Raum hat. | Anziehen braucht einen Platz für Kleidung und einen Blick in den Spiegel. | Faustregel | Prompt, Begehung |

## Essen

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| E1 | H | Je Person 60 cm Tischkante (bequem 70), Tisch 80–90 cm tief. | Ellenbogenfreiheit, Platz für Teller und Schüsseln. | West Elm, Ratgeber | Prompt |
| E2 | H | Hinter Stühlen 90 cm bis zur Wand oder zum nächsten Möbel; wo jemand dahinter vorbeigeht, 110–120 cm. | Stuhl zurückschieben und aufstehen. | Room & Board, Ruggable | Prompt, Löser, Begehung |
| E3 | W | Pendelleuchte mittig über der Tischmitte (nicht über der Raummitte), Unterkante 60–70 cm über der Tischplatte; Ø ⅓–½ der Tischbreite; ab 180 cm Tischlänge zwei Pendel oder eine Linearleuchte. | Licht auf den Tisch, ohne zu blenden oder die Sicht zu verstellen. | Louis Poulsen, Artika | Prompt, Löser, Begehung |
| E4 | T | Teppich unter dem Esstisch je Seite 60 cm größer als der Tisch, damit die Stühle beim Zurückschieben darauf bleiben; sonst lieber keiner. | Stühle kippen sonst an der Kante. | Ruggable, Rug Love | Prompt |

## Küche

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| K1 | W | Arbeitsdreieck Kühlschrank – Spüle – Kochfeld: jede Seite 1,2–2,7 m, Summe höchstens 7,9 m; kein Durchgangsweg hindurch. | Kurze Wege beim Kochen, niemand läuft durch die Arbeitszone. | NKBA | Prompt, Begehung |
| K2 | H | Zwischen Spüle und Kochfeld 60 cm Arbeitsfläche, Ziel 90–120 cm; neben dem Kochfeld je Seite 40 cm, nie direkt an Wand, Hochschrank oder Kühlschrank; neben der Spüle 60 cm Abstellfläche. | Hier wird geschnitten, abgestellt und angerichtet. | AMK, NKBA, Hornbach | Prompt, Löser, Begehung |
| K3 | W | Reihenfolge in der Zeile: Vorrat/Kühlen → Spülen (Geschirrspüler daneben) → Vorbereiten → Kochen → Anrichten; Kochfeld nicht unter dem Fenster und nicht neben der Tür. | Der Arbeitsablauf geht in eine Richtung, ohne Kreuzen. | AMK-Arbeitsablauf; Faustregel | Prompt, Löser |
| K4 | H | Arbeitsgang vor der Zeile 100–120 cm; zwischen zwei Zeilen oder zur Insel 120 cm. | Schubladen und Geschirrspüler öffnen, zu zweit arbeiten. | NKBA, Hornbach | Prompt, Löser, Begehung |
| K5 | W | Arbeitslicht unter den Oberschränken (Lichtleiste vorn, 500 lx, Ra ≥ 90), nicht nur eine Deckenleuchte im Rücken. | Sonst steht man im eigenen Schatten beim Schneiden. | licht.de, DIN EN 12464-1 | Prompt, Begehung |
| K6 | W | Oberschränke 50–60 cm über der Arbeitsplatte; Stauraum dort, wo er gebraucht wird (Geschirr bei Spüle und Geschirrspüler, Töpfe beim Kochfeld, Vorräte beim Kühlschrank). | Griffbereit ohne Laufen. | NKBA, Ratgeber | Prompt |

## Arbeiten

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| A1 | W | Schreibtisch seitlich zum Fenster (Blick parallel zur Fensterfront), nicht mit Blick ins Fenster und nicht mit dem Rücken dazu; Licht für Rechtshänder von links. | Keine Blendung, keine Spiegelung im Bildschirm, kein Schatten der Hand. | DGUV 215-442 | Prompt, Begehung |
| A2 | H | Hinter dem Tisch mindestens 100 cm Bewegungsfläche für den Stuhl (1,5 m²). | Aufstehen und Zurückrollen ohne Anstoßen. | ASR A1.2 | Prompt, Löser, Begehung |
| A3 | W | Arbeitsplatz mit Arbeitsleuchte (500 lx), Ablage oder Regal in Griffnähe; Tisch 160 × 80 cm ideal, mindestens 100 × 60. | Ordnung und gutes Licht für langes Arbeiten. | DIN EN 12464-1, DGUV 215-410 | Prompt, Begehung |

## Licht

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| L1 | W | Licht in drei Ebenen je Wohnraum: Grundlicht (Decke), Zonenlicht (Leselampe, Pendel überm Esstisch, Schreibtisch- und Küchenarbeitslicht), Stimmungslicht (Tisch- oder Stehlampe in einer dunklen Ecke). | Eine Deckenleuchte allein macht den Raum flach und ungemütlich. | licht.de (licht.wissen 14) | Prompt, Begehung |
| L2 | W | Jede Zone hat ihr eigenes Licht: Sitzgruppe, Leseecke, Essplatz, Arbeitsplatz, Bett, Kochzeile; im Wohnzimmer 3–5 Lichtpunkte. | Abends wirkt der Raum dann wie Inseln, nicht wie ein Büro. | licht.de; Faustregel | Prompt, Begehung |
| L3 | W | Warmweiß 2700–3000 K in Wohn- und Schlafräumen, an Arbeitsflächen bis 4000 K; Ra ≥ 80, in Bad und Küche ≥ 90; alles dimmbar. | Warmes Licht entspannt, gute Farbwiedergabe zeigt Speisen und Haut richtig. | licht.de | Prompt |
| L4 | W | Leselampe neben oder leicht hinter dem Sessel, Licht über die Schulter, Schirm-Unterkante 100–120 cm. | Licht auf dem Buch, nicht in den Augen. | Whitecliff, Ashdeco | Prompt, Löser |
| L5 | W | Badspiegel seitlich oder rundum beleuchtet (Gesichtshöhe, 300 lx), nicht nur von oben. | Kein Schatten im Gesicht beim Rasieren und Schminken. | licht.de | Prompt |

## Raum, Wege, Fenster, Proportion

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| R1 | H | Wege: Hauptweg 90 cm, Nebenweg 60–75 cm; nichts im Schwenkbereich einer Tür (plus 10 cm). | Durchgehen, ohne seitlich zu drehen; Türen öffnen ganz. | Houzz, DIN 18040-2 | Prompt, Löser, Begehung |
| R2 | W | Beim Hereinkommen fällt der Blick auf etwas Schönes (Fenster, Sitzgruppe, Bild), nicht auf einen Sofarücken, eine Schrankseite oder ein Bett. | Der erste Eindruck prägt den Raum. | Faustregel | Prompt, Begehung |
| R3 | W | Hohe Möbel (über der Brüstung) nicht vor Fenster und nicht ins Tageslicht; schwere und hohe Möbel auf die Raumseiten verteilen, nicht alle an eine Wand. | Licht bleibt im Raum, der Raum kippt nicht optisch. | Faustregel | Prompt, Löser, Begehung |
| R4 | W | Ab etwa 3,5–4 m Raumbreite nicht alles an die Wand schieben: Gruppen dürfen frei stehen, die Mitte ist nicht leer, wenn dort kein Weg läuft. | Möbel nur an den Wänden wirken wie im Wartezimmer. | coohom; Faustregel | Prompt, Begehung |
| R5 | T | Belegung: in Wohn- und Schlafräumen etwa ein Viertel bis zwei Fünftel des Bodens mit Möbeln (ohne Teppich), mit Teppichen etwa die Hälfte. | Weder leer noch vollgestellt. | Apartment Therapy; Faustregel | Prompt, Begehung |
| R6 | T | Tageslicht nutzen: Sitz- und Leseplatz mit Blick nach draußen, Schreibtisch seitlich am Fenster; Süd- und Westfenster bringen Sonne und Wärme (Sitzen, Essen), Nordlicht ist gleichmäßig (Arbeiten), Ostlicht weckt (Schlafen, Frühstück). | Die Funktion folgt dem Licht des Tages. | fertighaus.de; Faustregel | Prompt |
| R7 | W | Bild: Bildmitte auf 145–155 cm, über einem Möbel Unterkante 15–25 cm über Lehne oder Platte und etwa ⅔ seiner Breite; nichts über Fenster oder Tür. | Auf Augenhöhe und im Maß des Möbels darunter. | Wohnglück, Montcarta | Prompt, Löser, Begehung |
| R8 | W | Vorhänge als Paar, Stange 10–15 cm über dem Fenster und 10–25 cm seitlich darüber hinaus, offen neben dem Glas, bis knapp über den Boden. | Das Fenster wirkt größer, das Licht bleibt frei. | Homes & Gardens, Taskrabbit | Prompt, Löser |
| R9 | T | Pflanzen in Ecken, neben Fenster oder Möbel, nie frei im Raum oder im Weg; kleine Pflanzen auf Fensterbank, Regal oder Sideboard. | Sie rahmen und beleben, ohne im Weg zu stehen. | Faustregel | Prompt, Löser |

## Stauraum

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| ST1 | W | Kleiderschrank je Person 100–150 cm breit (Paar mindestens 250 cm), 55–60 cm tief; davor 90–100 cm frei bei Drehtüren. | Ein Kubikmeter Kleidung je Person; Türen öffnen ganz. | VDM lt. Ratgeber, Lazada | Prompt, Löser, Begehung |
| ST2 | W | Stauraum gehört an den Ort der Nutzung und hinter Fronten; offene Regale nur für Bücher und Schönes. | Ordnung ohne Laufen, ruhiges Bild. | NKBA; Faustregel | Prompt |
| ST3 | W | Im Vorraum je Person 20–30 cm Garderobe und Platz für 3–4 Paar Schuhe; bei Gang unter 120 cm Möbel höchstens 35 cm tief; Spiegel und Ablage für Schlüssel beim Eingang. | Ankommen, ablegen, Blick in den Spiegel beim Gehen. | otto.de; Faustregel | Prompt |

## Kinderzimmer

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| KI1 | W | Zusammenhängende Spielfläche von mindestens 2 m² (z. B. 120 × 180 cm), gern auf einem Teppich; Spielzeug in niedrigen Regalen und Kisten. | Kinder spielen am Boden; selbst aufräumen können. | Faustregel | Prompt, Begehung |
| KI2 | H | Hohe Möbel kippsicher an der Wand; Schreibtisch wie A1 seitlich zum Fenster mit Arbeitslicht. | Sicherheit, gutes Licht für Hausaufgaben. | Herstellervorgabe, DIN EN 12464-1 | Prompt |

## Bad und WC

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| B1 | H | Vor WC und Waschtisch 75 cm frei (mindestens 55), WC-Achse 45 cm zur Seitenwand; Spiegel über dem Waschtisch, Unterkante 15–25 cm über dem Becken. | Sitzen, Bücken, Abtrocknen ohne Anstoßen. | NKBA, Geberit/ÖNORM | Prompt, Löser, Begehung |
| B2 | T | Geschlossener Stauraum am Waschtisch, Handtücher in Griffweite der Dusche oder Wanne. | Nass aus der Dusche, Handtuch ohne Schritt. | Faustregel | Prompt |

## Vorraum und Gang

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| V1 | H | Gang 90 cm frei (bequem 100–120); am Eingang etwa 120 × 120 cm frei zum An- und Ausziehen; nichts im Türaufschlag. | Ankommen mit Taschen, zu zweit Schuhe ausziehen. | DIN 18040-2, Neufert lt. Ratgeber | Prompt, Löser, Begehung |
| V2 | W | Langer Gang: Licht etwa alle 2–3 m; ein Läufer mittig; Bilder auf Augenhöhe geben dem Gang ein Ziel. | Kein dunkler Schlauch. | Faustregel | Prompt |

## Stil und Gesamtbild

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
| SL1 | W | Ein Stilkonzept für die ganze Wohnung: dieselbe Palette, dieselben Materialien und dieselbe Formensprache in allen Räumen; jeder Raum variiert es nur mit seiner Akzentfarbe. | Die Wohnung wirkt wie aus einem Guss, nicht wie zusammengekauft. | Faustregel | Prompt, Begehung, Produktsuche |
| SL2 | W | Farbaufteilung 60/30/10: Hauptfarbe (Wände, große Flächen, große Möbel) 60 %, Zweitfarbe (Möbel, Textilien) 30 %, Akzent (Kissen, Sessel, Bild, Vase) 10 %; höchstens drei bis vier Farben je Raum. | Ruhe mit einem bewussten Akzent statt Buntheit. | Ideal Home, Homes & Gardens | Prompt, Begehung, Produktsuche |
| SL3 | W | Höchstens zwei bis drei Holztöne und eine Metallfarbe je Raum; ein Material kommt mindestens zweimal vor (z. B. Eiche am Couchtisch und am Regal, schwarzes Metall an Leuchte und Bilderrahmen). | Wiederholung verbindet, zu viele Hölzer wirken unruhig. | Faustregel | Prompt, Produktsuche |
| SL4 | T | Formen mischen, aber bewusst: zu viel Eckigem etwas Rundes (runder Couch- oder Beistelltisch, runder Spiegel, Pendel), zu glatten Flächen Textur (Wolle, Leinen, Rattan, Holz). | Abwechslung in Form und Haptik macht den Raum wohnlich. | Faustregel | Prompt, Produktsuche |
| SL5 | T | Maßstab: große Räume vertragen wenige große Stücke statt vieler kleiner; kleine Räume helle, leichte Möbel mit sichtbaren Beinen. | Viele kleine Teile wirken unruhig, schwere Kästen erdrücken kleine Räume. | Faustregel | Prompt, Produktsuche |
| SL6 | T | Persönliches zeigen: Bücher, Bilder, Pflanzen, Textilien; lieber wenige gute Stücke als viel Deko. Jeder Wohn- und Schlafraum hat mindestens ein Bild; auf Sideboard, Kommode und Lowboard eine Dreiergruppe in verschiedenen Höhen (Vase, Bücher, Schale). | Erst das macht aus einem Plan ein Zuhause. | Faustregel | Prompt, Löser, Begehung |
| SL7 | W | Produktwahl: ein echtes Produkt passt, wenn Art und Funktion stimmen (z. B. Schlaffunktion, Stauraum, Schubladen), Maße höchstens etwa 15 % abweichen, Farbe und Material zur Palette und zum Rest des Raums passen; ein Stück im richtigen Stil, etwas kleiner, schlägt ein maßgenaues im falschen. | Das Gesamtbild zählt, nicht nur der Zentimeter. | Faustregel | Produktsuche |
