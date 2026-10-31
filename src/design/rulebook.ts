/**
 * The interior designer's rule book (mgritsch04/wohnungsplaner-3d#436): one source for the measures
 * and rules the new furnishing uses. The room programme prompt quotes the rules of its room type
 * with their ids, the furniture groups (`concept/groups.ts`) take their measures from here, the
 * walkthrough (`review/`) checks the ones marked `review`, and the product search the style rules.
 * `docs/EINRICHTUNG_REGELWERK.md` is written from this list (`rulebookMarkdown`, kept in step by
 * `rulebook.test.ts`).
 *
 * Sources: research of 30.10.2026 (Neufert, DIN EN 12464-1, ASR A1.2, DIN 18040-2, NKBA kitchen
 * and bath guidelines, AMK, licht.de, Louis Poulsen and interior design guides). Most of it is a
 * planning recommendation, not a building rule; `source` names where a value comes from, „Faustregel“
 * marks a designer's rule of thumb without a citable source.
 */
import type { RoomType } from './types';

/** H: the furniture cannot be used otherwise; W: a professional would do it differently; T: tip, style. */
export type RuleLevel = 'H' | 'W' | 'T';
/** Where the rule is used: the prompt for Claude, the solver, the walkthrough, the product search. */
export type RuleUse = 'prompt' | 'solver' | 'review' | 'search';

export type RuleArea = 'living' | 'sleeping' | 'dining' | 'kitchen' | 'work' | 'light' | 'room' | 'storage' | 'kids' | 'bath' | 'hall' | 'style';

export interface DesignRule {
  id: string;
  area: RuleArea;
  level: RuleLevel;
  /** The rule with its measure, short enough for the prompt. */
  text: string;
  /** Why a designer does it this way. */
  why: string;
  source: string;
  use: RuleUse[];
}

export const AREA_TITLES: Record<RuleArea, string> = {
  living: 'Wohnen und Sitzgruppe',
  sleeping: 'Schlafen',
  dining: 'Essen',
  kitchen: 'Küche',
  work: 'Arbeiten',
  light: 'Licht',
  room: 'Raum, Wege, Fenster, Proportion',
  storage: 'Stauraum',
  kids: 'Kinderzimmer',
  bath: 'Bad und WC',
  hall: 'Vorraum und Gang',
  style: 'Stil und Gesamtbild',
};

const r = (id: string, area: RuleArea, level: RuleLevel, text: string, why: string, source: string, use: RuleUse[] = ['prompt']): DesignRule => ({ id, area, level, text, why, source, use });

export const RULES: DesignRule[] = [
  // living
  r('W1', 'living', 'W', 'Gesprächsabstand zwischen gegenüberliegenden Sitzen höchstens 2,4 m (Gruppe 2,4–3 m Durchmesser); Sessel zur Gruppe gedreht, nicht in einer Reihe mit dem Sofa.', 'Weiter weg muss man lauter sprechen, die Gruppe zerfällt.', 'Houzz, Ratgeber; Faustregel', ['prompt', 'solver', 'review']),
  r('W2', 'living', 'H', 'Couchtisch 40–45 cm vor der Sofakante (mindestens 30, höchstens 50 cm), mittig vor dem Sofa.', 'In Griffweite vom Sitz und trotzdem Platz für die Beine.', 'Homes & Gardens, livingetc', ['prompt', 'solver', 'review']),
  r('W3', 'living', 'W', 'Couchtisch ½ bis ⅔ so lang wie das Sofa, Höhe gleich der Sitzhöhe oder 2–5 cm darunter.', 'Jeder Platz erreicht den Tisch; die Gruppe wirkt im Verhältnis.', 'livingetc, Wayfair, Ashley'),
  r('W4', 'living', 'W', 'Beistelltisch 5–10 cm neben der Armlehne, etwa auf Armlehnenhöhe; an jedem Sitz ohne Couchtisch-Griffweite (Sessel, Sofaende) eine Ablage.', 'Tasse und Buch ohne Aufstehen abstellen.', 'Wayfair, Ideal Home', ['prompt', 'solver', 'review']),
  r('W5', 'living', 'W', 'Fernseher mittig gegenüber dem Hauptsitz im 1,2- bis 1,6-fachen Abstand der Bilddiagonale (55″: 1,7–2,2 m; bis 2,5 m noch gut), Bildmitte auf 100–110 cm, nicht gegenüber einem Fenster.', 'Bildwinkel 30–40° (SMPTE, THX), Augenhöhe im Sitzen, keine Spiegelung.', 'SMPTE/THX, choose.tv, coolblue', ['prompt', 'solver', 'review']),
  r('W6', 'living', 'W', 'Teppich der Sitzgruppe: mindestens die Vorderfüße aller Sitzmöbel liegen 15–20 cm darauf; er ist breiter als das Sofa (je Seite 15–45 cm) und liegt mittig unter der Gruppe; 30–45 cm Bodenrand zur Wand.', 'Ein zu kleiner Teppich zerteilt die Gruppe statt sie zu fassen.', 'Bed Bath & Beyond, livingetc, Houzz', ['prompt', 'solver', 'review']),
  r('W7', 'living', 'W', 'Ein Blickpunkt je Raum (Fenster mit Ausblick, Medienwand, großes Bild); das Sofa schaut darauf, nie auf eine leere Wand, Türen oder den Rücken eines anderen Möbels.', 'Der Raum bekommt eine Ordnung, der Blick ruht.', 'Vinterior, Rovelab', ['prompt', 'review']),
  r('W8', 'living', 'H', 'Der Laufweg führt um die Sitzgruppe herum, nie zwischen Sofa und Couchtisch oder zwischen Sofa und Fernseher.', 'Sonst läuft man durchs Gespräch und durchs Bild.', 'Houzz („around, not through“)', ['prompt', 'review']),
  r('W9', 'living', 'W', 'Sofa frei im Raum nur mit 75–90 cm Gang dahinter und mit etwas, das den Rücken fasst (Konsole, Sideboard, Leseecke); sonst mit dem Rücken an die Wand; kein Spalt von 15–70 cm dahinter (gilt auch für Schreibtisch und Schränke).', 'Ein frei stehendes Sofa ohne Halt wirkt verloren; ein schmaler Spalt ist weder Gang noch Wand und sammelt nur Staub.', 'coohom, livingetc', ['prompt', 'solver', 'review']),
  // sleeping
  r('S1', 'sleeping', 'W', 'Kopfteil an eine geschlossene Wand, nicht unter ein Fenster, nicht an die Wand zu Bad, Stiegenhaus oder Nachbarwohnung (dort lieber den Schrank als Puffer).', 'Halt im Rücken, kein Zug und kein Lärm am Kopf.', 'Homes & Gardens; Bauakustik-Praxis', ['prompt', 'review']),
  r('S2', 'sleeping', 'W', 'Vom Bett aus sieht man die Tür, das Bett steht aber nicht in der Türachse (Füße nicht zur Tür).', 'Sicherheitsgefühl, und man schaut beim Hereinkommen nicht aufs Bett.', 'Homes & Gardens, livingetc'),
  r('S3', 'sleeping', 'H', 'Neben dem Bett 60 cm frei, besser 70–80 cm; ein Doppelbett von beiden Längsseiten zugänglich; am Fußende 60 cm, mit Durchgang 75–90 cm.', 'Bettmachen, Aufstehen, zu zweit aneinander vorbei.', 'Simba, Casa Padrino', ['prompt', 'solver', 'review']),
  r('S4', 'sleeping', 'W', 'Nachttische als Paar links und rechts, Oberkante ±5 cm zur Matratze, je eine Leseleuchte mit gerichtetem Licht (Unterkante 40–50 cm über der Matratze), einzeln schaltbar.', 'Jeder Schläfer hat Ablage und eigenes Licht, ohne den anderen zu blenden.', 'Simba, licht.de', ['prompt', 'solver', 'review']),
  r('S5', 'sleeping', 'T', 'Teppich unter dem Bett: das untere ⅔ des Bettes darauf, seitlich 45–60 cm sichtbar; Nachttische ganz darauf oder ganz daneben.', 'Morgens auf etwas Weiches treten; das Bett wirkt geerdet.', 'Amanda Katherine, Welsh Design Studio', ['prompt', 'solver']),
  r('S6', 'sleeping', 'W', 'Bild über dem Bett etwa ⅔ der Bettbreite, Unterkante 15–25 cm über dem Kopfteil.', 'Fasst das Bett als Blickpunkt.', 'Montcarta, Edward Martin', ['prompt', 'solver', 'review']),
  r('S7', 'sleeping', 'W', 'Eine Ankleide-Ecke: Spiegel, Ablage (Kommode, Stuhl oder Bank) beim Schrank, wenn die Kleidung keinen eigenen Raum hat.', 'Anziehen braucht einen Platz für Kleidung und einen Blick in den Spiegel.', 'Faustregel', ['prompt', 'review']),
  // dining
  r('E1', 'dining', 'H', 'Je Person 60 cm Tischkante (bequem 70), Tisch 80–90 cm tief.', 'Ellenbogenfreiheit, Platz für Teller und Schüsseln.', 'West Elm, Ratgeber'),
  r('E2', 'dining', 'H', 'Hinter Stühlen 90 cm bis zur Wand oder zum nächsten Möbel; wo jemand dahinter vorbeigeht, 110–120 cm.', 'Stuhl zurückschieben und aufstehen.', 'Room & Board, Ruggable', ['prompt', 'solver', 'review']),
  r('E3', 'dining', 'W', 'Pendelleuchte mittig über der Tischmitte (nicht über der Raummitte), Unterkante 60–70 cm über der Tischplatte; Ø ⅓–½ der Tischbreite; ab 180 cm Tischlänge zwei Pendel oder eine Linearleuchte.', 'Licht auf den Tisch, ohne zu blenden oder die Sicht zu verstellen.', 'Louis Poulsen, Artika', ['prompt', 'solver', 'review']),
  r('E4', 'dining', 'T', 'Teppich unter dem Esstisch je Seite 60 cm größer als der Tisch, damit die Stühle beim Zurückschieben darauf bleiben; sonst lieber keiner.', 'Stühle kippen sonst an der Kante.', 'Ruggable, Rug Love'),
  // kitchen
  r('K1', 'kitchen', 'W', 'Arbeitsdreieck Kühlschrank – Spüle – Kochfeld: jede Seite 1,2–2,7 m, Summe höchstens 7,9 m; kein Durchgangsweg hindurch.', 'Kurze Wege beim Kochen, niemand läuft durch die Arbeitszone.', 'NKBA', ['prompt', 'review']),
  r('K2', 'kitchen', 'H', 'Zwischen Spüle und Kochfeld 60 cm Arbeitsfläche, Ziel 90–120 cm; neben dem Kochfeld je Seite 40 cm, nie direkt an Wand, Hochschrank oder Kühlschrank; neben der Spüle 60 cm Abstellfläche.', 'Hier wird geschnitten, abgestellt und angerichtet.', 'AMK, NKBA, Hornbach', ['prompt', 'solver', 'review']),
  r('K3', 'kitchen', 'W', 'Reihenfolge in der Zeile: Vorrat/Kühlen → Spülen (Geschirrspüler daneben) → Vorbereiten → Kochen → Anrichten; Kochfeld nicht unter dem Fenster und nicht neben der Tür.', 'Der Arbeitsablauf geht in eine Richtung, ohne Kreuzen.', 'AMK-Arbeitsablauf; Faustregel', ['prompt', 'solver']),
  r('K4', 'kitchen', 'H', 'Arbeitsgang vor der Zeile 100–120 cm; zwischen zwei Zeilen oder zur Insel 120 cm.', 'Schubladen und Geschirrspüler öffnen, zu zweit arbeiten.', 'NKBA, Hornbach', ['prompt', 'solver', 'review']),
  r('K5', 'kitchen', 'W', 'Arbeitslicht unter den Oberschränken (Lichtleiste vorn, 500 lx, Ra ≥ 90), nicht nur eine Deckenleuchte im Rücken.', 'Sonst steht man im eigenen Schatten beim Schneiden.', 'licht.de, DIN EN 12464-1', ['prompt', 'review']),
  r('K6', 'kitchen', 'W', 'Oberschränke 50–60 cm über der Arbeitsplatte; Stauraum dort, wo er gebraucht wird (Geschirr bei Spüle und Geschirrspüler, Töpfe beim Kochfeld, Vorräte beim Kühlschrank).', 'Griffbereit ohne Laufen.', 'NKBA, Ratgeber'),
  // work
  r('A1', 'work', 'W', 'Schreibtisch seitlich zum Fenster (Blick parallel zur Fensterfront), nicht mit Blick ins Fenster und nicht mit dem Rücken dazu; Licht für Rechtshänder von links.', 'Keine Blendung, keine Spiegelung im Bildschirm, kein Schatten der Hand.', 'DGUV 215-442', ['prompt', 'review']),
  r('A2', 'work', 'H', 'Hinter dem Tisch mindestens 100 cm Bewegungsfläche für den Stuhl (1,5 m²).', 'Aufstehen und Zurückrollen ohne Anstoßen.', 'ASR A1.2', ['prompt', 'solver', 'review']),
  r('A3', 'work', 'W', 'Arbeitsplatz mit Arbeitsleuchte (500 lx), Ablage oder Regal in Griffnähe; Tisch 160 × 80 cm ideal, mindestens 100 × 60.', 'Ordnung und gutes Licht für langes Arbeiten.', 'DIN EN 12464-1, DGUV 215-410', ['prompt', 'review']),
  // light
  r('L1', 'light', 'W', 'Licht in drei Ebenen je Wohnraum: Grundlicht (Decke), Zonenlicht (Leselampe, Pendel überm Esstisch, Schreibtisch- und Küchenarbeitslicht), Stimmungslicht (Tisch- oder Stehlampe in einer dunklen Ecke).', 'Eine Deckenleuchte allein macht den Raum flach und ungemütlich.', 'licht.de (licht.wissen 14)', ['prompt', 'review']),
  r('L2', 'light', 'W', 'Jede Zone hat ihr eigenes Licht: Sitzgruppe, Leseecke, Essplatz, Arbeitsplatz, Bett, Kochzeile; im Wohnzimmer 3–5 Lichtpunkte.', 'Abends wirkt der Raum dann wie Inseln, nicht wie ein Büro.', 'licht.de; Faustregel', ['prompt', 'review']),
  r('L3', 'light', 'W', 'Warmweiß 2700–3000 K in Wohn- und Schlafräumen, an Arbeitsflächen bis 4000 K; Ra ≥ 80, in Bad und Küche ≥ 90; alles dimmbar.', 'Warmes Licht entspannt, gute Farbwiedergabe zeigt Speisen und Haut richtig.', 'licht.de'),
  r('L4', 'light', 'W', 'Leselampe neben oder leicht hinter dem Sessel, Licht über die Schulter, Schirm-Unterkante 100–120 cm.', 'Licht auf dem Buch, nicht in den Augen.', 'Whitecliff, Ashdeco', ['prompt', 'solver']),
  r('L5', 'light', 'W', 'Badspiegel seitlich oder rundum beleuchtet (Gesichtshöhe, 300 lx), nicht nur von oben.', 'Kein Schatten im Gesicht beim Rasieren und Schminken.', 'licht.de'),
  // room
  r('R1', 'room', 'H', 'Wege: Hauptweg 90 cm, Nebenweg 60–75 cm; nichts im Schwenkbereich einer Tür (plus 10 cm).', 'Durchgehen, ohne seitlich zu drehen; Türen öffnen ganz.', 'Houzz, DIN 18040-2', ['prompt', 'solver', 'review']),
  r('R2', 'room', 'W', 'Beim Hereinkommen fällt der Blick auf etwas Schönes (Fenster, Sitzgruppe, Bild), nicht auf einen Sofarücken, eine Schrankseite oder ein Bett.', 'Der erste Eindruck prägt den Raum.', 'Faustregel', ['prompt', 'review']),
  r('R3', 'room', 'W', 'Hohe Möbel (über der Brüstung) nicht vor Fenster und nicht ins Tageslicht; schwere und hohe Möbel auf die Raumseiten verteilen, nicht alle an eine Wand.', 'Licht bleibt im Raum, der Raum kippt nicht optisch.', 'Faustregel', ['prompt', 'solver', 'review']),
  r('R4', 'room', 'W', 'Ab etwa 3,5–4 m Raumbreite nicht alles an die Wand schieben: Gruppen dürfen frei stehen, die Mitte ist nicht leer, wenn dort kein Weg läuft.', 'Möbel nur an den Wänden wirken wie im Wartezimmer.', 'coohom; Faustregel', ['prompt', 'review']),
  r('R5', 'room', 'T', 'Belegung: in Wohn- und Schlafräumen etwa ein Viertel bis zwei Fünftel des Bodens mit Möbeln (ohne Teppich), mit Teppichen etwa die Hälfte.', 'Weder leer noch vollgestellt.', 'Apartment Therapy; Faustregel', ['prompt', 'review']),
  r('R6', 'room', 'T', 'Tageslicht nutzen: Sitz- und Leseplatz mit Blick nach draußen, Schreibtisch seitlich am Fenster; Süd- und Westfenster bringen Sonne und Wärme (Sitzen, Essen), Nordlicht ist gleichmäßig (Arbeiten), Ostlicht weckt (Schlafen, Frühstück).', 'Die Funktion folgt dem Licht des Tages.', 'fertighaus.de; Faustregel', ['prompt']),
  r('R7', 'room', 'W', 'Bild: Bildmitte auf 145–155 cm, über einem Möbel Unterkante 15–25 cm über Lehne oder Platte und etwa ⅔ seiner Breite; nichts über Fenster oder Tür.', 'Auf Augenhöhe und im Maß des Möbels darunter.', 'Wohnglück, Montcarta', ['prompt', 'solver', 'review']),
  r('R8', 'room', 'W', 'Vorhänge als Paar, Stange 10–15 cm über dem Fenster und 10–25 cm seitlich darüber hinaus, offen neben dem Glas, bis knapp über den Boden.', 'Das Fenster wirkt größer, das Licht bleibt frei.', 'Homes & Gardens, Taskrabbit', ['prompt', 'solver']),
  r('R9', 'room', 'T', 'Pflanzen in Ecken, neben Fenster oder Möbel, nie frei im Raum oder im Weg; kleine Pflanzen auf Fensterbank, Regal oder Sideboard.', 'Sie rahmen und beleben, ohne im Weg zu stehen.', 'Faustregel', ['prompt', 'solver']),
  // storage
  r('ST1', 'storage', 'W', 'Kleiderschrank je Person 100–150 cm breit (Paar mindestens 250 cm), 55–60 cm tief; davor 90–100 cm frei bei Drehtüren.', 'Ein Kubikmeter Kleidung je Person; Türen öffnen ganz.', 'VDM lt. Ratgeber, Lazada', ['prompt', 'solver', 'review']),
  r('ST2', 'storage', 'W', 'Stauraum gehört an den Ort der Nutzung und hinter Fronten; offene Regale nur für Bücher und Schönes.', 'Ordnung ohne Laufen, ruhiges Bild.', 'NKBA; Faustregel', ['prompt']),
  r('ST3', 'storage', 'W', 'Im Vorraum je Person 20–30 cm Garderobe und Platz für 3–4 Paar Schuhe; bei Gang unter 120 cm Möbel höchstens 35 cm tief; Spiegel und Ablage für Schlüssel beim Eingang.', 'Ankommen, ablegen, Blick in den Spiegel beim Gehen.', 'otto.de; Faustregel', ['prompt']),
  // kids
  r('KI1', 'kids', 'W', 'Zusammenhängende Spielfläche von mindestens 2 m² (z. B. 120 × 180 cm), gern auf einem Teppich; Spielzeug in niedrigen Regalen und Kisten.', 'Kinder spielen am Boden; selbst aufräumen können.', 'Faustregel', ['prompt', 'review']),
  r('KI2', 'kids', 'H', 'Hohe Möbel kippsicher an der Wand; Schreibtisch wie A1 seitlich zum Fenster mit Arbeitslicht.', 'Sicherheit, gutes Licht für Hausaufgaben.', 'Herstellervorgabe, DIN EN 12464-1'),
  // bath
  r('B1', 'bath', 'H', 'Vor WC und Waschtisch 75 cm frei (mindestens 55), WC-Achse 45 cm zur Seitenwand; Spiegel über dem Waschtisch, Unterkante 15–25 cm über dem Becken.', 'Sitzen, Bücken, Abtrocknen ohne Anstoßen.', 'NKBA, Geberit/ÖNORM', ['prompt', 'solver', 'review']),
  r('B2', 'bath', 'T', 'Geschlossener Stauraum am Waschtisch, Handtücher in Griffweite der Dusche oder Wanne.', 'Nass aus der Dusche, Handtuch ohne Schritt.', 'Faustregel'),
  // hall
  r('V1', 'hall', 'H', 'Gang 90 cm frei (bequem 100–120); am Eingang etwa 120 × 120 cm frei zum An- und Ausziehen; nichts im Türaufschlag.', 'Ankommen mit Taschen, zu zweit Schuhe ausziehen.', 'DIN 18040-2, Neufert lt. Ratgeber', ['prompt', 'solver', 'review']),
  r('V2', 'hall', 'W', 'Langer Gang: Licht etwa alle 2–3 m; ein Läufer mittig; Bilder auf Augenhöhe geben dem Gang ein Ziel.', 'Kein dunkler Schlauch.', 'Faustregel'),
  // style
  r('SL1', 'style', 'W', 'Ein Stilkonzept für die ganze Wohnung: dieselbe Palette, dieselben Materialien und dieselbe Formensprache in allen Räumen; jeder Raum variiert es nur mit seiner Akzentfarbe.', 'Die Wohnung wirkt wie aus einem Guss, nicht wie zusammengekauft.', 'Faustregel', ['prompt', 'review', 'search']),
  r('SL2', 'style', 'W', 'Farbaufteilung 60/30/10: Hauptfarbe (Wände, große Flächen, große Möbel) 60 %, Zweitfarbe (Möbel, Textilien) 30 %, Akzent (Kissen, Sessel, Bild, Vase) 10 %; höchstens drei bis vier Farben je Raum.', 'Ruhe mit einem bewussten Akzent statt Buntheit.', 'Ideal Home, Homes & Gardens', ['prompt', 'review', 'search']),
  r('SL3', 'style', 'W', 'Höchstens zwei bis drei Holztöne und eine Metallfarbe je Raum; ein Material kommt mindestens zweimal vor (z. B. Eiche am Couchtisch und am Regal, schwarzes Metall an Leuchte und Bilderrahmen).', 'Wiederholung verbindet, zu viele Hölzer wirken unruhig.', 'Faustregel', ['prompt', 'search']),
  r('SL4', 'style', 'T', 'Formen mischen, aber bewusst: zu viel Eckigem etwas Rundes (runder Couch- oder Beistelltisch, runder Spiegel, Pendel), zu glatten Flächen Textur (Wolle, Leinen, Rattan, Holz).', 'Abwechslung in Form und Haptik macht den Raum wohnlich.', 'Faustregel', ['prompt', 'search']),
  r('SL5', 'style', 'T', 'Maßstab: große Räume vertragen wenige große Stücke statt vieler kleiner; kleine Räume helle, leichte Möbel mit sichtbaren Beinen.', 'Viele kleine Teile wirken unruhig, schwere Kästen erdrücken kleine Räume.', 'Faustregel', ['prompt', 'search']),
  r('SL6', 'style', 'T', 'Persönliches zeigen: Bücher, Bilder, Pflanzen, Textilien; lieber wenige gute Stücke als viel Deko. Jeder Wohn- und Schlafraum hat mindestens ein Bild; auf Sideboard, Kommode und Lowboard eine Dreiergruppe in verschiedenen Höhen (Vase, Bücher, Schale).', 'Erst das macht aus einem Plan ein Zuhause.', 'Faustregel', ['prompt', 'solver', 'review']),
  r('SL7', 'style', 'W', 'Produktwahl: ein echtes Produkt passt, wenn Art und Funktion stimmen (z. B. Schlaffunktion, Stauraum, Schubladen), Maße höchstens etwa 15 % abweichen, Farbe und Material zur Palette und zum Rest des Raums passen; ein Stück im richtigen Stil, etwas kleiner, schlägt ein maßgenaues im falschen.', 'Das Gesamtbild zählt, nicht nur der Zentimeter.', 'Faustregel', ['search']),
];

/** Rule areas that matter for a room type, beside the general ones (light, room, storage, style). */
const AREAS_OF: Partial<Record<RoomType, RuleArea[]>> = {
  living: ['living', 'dining', 'work'],
  bedroom: ['sleeping', 'work'],
  kids: ['kids', 'sleeping', 'work'],
  office: ['work', 'living'],
  dining: ['dining'],
  kitchen: ['kitchen', 'dining'],
  bath: ['bath'],
  hall: ['hall'],
};
const GENERAL: RuleArea[] = ['room', 'light', 'storage', 'style'];

/** Rules for the prompt of one room: its own areas first, then the general ones; functions of the room add theirs. */
export function rulesFor(type: RoomType, extra: RuleArea[] = []): DesignRule[] {
  const areas = [...new Set([...(AREAS_OF[type] ?? []), ...extra, ...GENERAL])];
  // hall and bath rooms do not need the living room's style and light rules in full
  const small = type === 'bath' || type === 'hall' || type === 'utility' || type === 'balcony';
  return areas.flatMap((a) => RULES.filter((x) => x.area === a && x.use.includes('prompt') && (!small || x.level !== 'T')));
}

/** The rules as prompt lines: „W2 Couchtisch 40–45 cm …“, grouped by area. */
export function rulebookPrompt(type: RoomType, extra: RuleArea[] = []): string {
  const rules = rulesFor(type, extra);
  const areas = [...new Set(rules.map((x) => x.area))];
  return areas.map((a) => `${AREA_TITLES[a]}:\n${rules.filter((x) => x.area === a).map((x) => `- ${x.id} ${x.text}`).join('\n')}`).join('\n');
}

export const ruleById = (id: string): DesignRule | undefined => RULES.find((x) => x.id === id);

/** The whole rule book as Markdown (docs/EINRICHTUNG_REGELWERK.md). */
export function rulebookMarkdown(): string {
  const use = (x: DesignRule) => x.use.map((u) => ({ prompt: 'Prompt', solver: 'Löser', review: 'Begehung', search: 'Produktsuche' })[u]).join(', ');
  const areas = [...new Set(RULES.map((x) => x.area))];
  return `# Regelwerk der Einrichtung

Eine Quelle für Maße und Regeln des Einrichtungsvorschlags (\`src/design/rulebook.ts\`, mgritsch04/wohnungsplaner-3d#436). Diese Datei wird daraus erzeugt: \`WP_WRITE_RULEBOOK=1 npx vitest run src/design/rulebook.test.ts\`.

- **Stufe:** H = sonst nicht benutzbar (harte Regel), W = ein Profi würde es anders machen (Warnung), T = Tipp und Stil.
- **Genutzt in:** Prompt (Claude bekommt die Regeln seines Raumtyps mit Kennung), Löser (Maße der Möbelgruppen und Kosten), Begehung (Prüfregeln), Produktsuche (Auswahl echter Produkte).
- **Quellen:** Recherche vom 30.10.2026 (Neufert, DIN EN 12464-1, ASR A1.2, DIN 18040-2, NKBA, AMK, licht.de, Louis Poulsen, Einrichtungsratgeber). Vieles ist Planungsempfehlung, keine Bauvorschrift; „Faustregel“ heißt: übliche Praxis ohne belegbare Quelle.

${areas
  .map(
    (a) => `## ${AREA_TITLES[a]}

| Kennung | Stufe | Regel | Warum | Quelle | Genutzt in |
|---|---|---|---|---|---|
${RULES.filter((x) => x.area === a)
  .map((x) => `| ${x.id} | ${x.level} | ${x.text} | ${x.why} | ${x.source} | ${use(x)} |`)
  .join('\n')}`,
  )
  .join('\n\n')}
`;
}
