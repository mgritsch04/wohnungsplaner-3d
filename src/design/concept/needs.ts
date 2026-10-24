/**
 * What a room must have (walk-through rule A1) and which functions of the flat exist only once
 * (A2). The flat concept check uses the single functions, the room programme check the needs of
 * the room type and of the functions the concept gave the room. Existing pieces count.
 */
import type { RoomType } from '../types';
import type { Thing } from './common';

export interface Need {
  /** Everyday name for the problem text („Bett“). */
  label: string;
  has: (t: Thing) => boolean;
  /** Only from this floor area on (m²). */
  minArea?: number;
}

const shape =
  (...s: string[]) =>
  (t: Thing) =>
    s.includes(t.shape);
const bed = shape('bed');
const sofa = shape('sofa', 'sofa-corner');
const seat = (t: Thing) => t.category === 'chair' || t.category === 'sofa';
const diningTable = (t: Thing) => t.category === 'table' && t.height >= 0.6 && Math.max(t.width, t.depth) >= 0.75;
const desk = (t: Thing) => t.category === 'desk';
const storage = (t: Thing) => t.category === 'storage' && ['wardrobe', 'dresser', 'shelf', 'cabinet'].includes(t.shape);
const coats = (t: Thing) => t.shape === 'coat-rack' || t.shape === 'wardrobe' || /garderobe/i.test(t.name);

export const NEEDS: Record<RoomType, Need[]> = {
  living: [{ label: 'Sofa (Sitzplätze für mindestens drei)', has: sofa }],
  bedroom: [{ label: 'Bett', has: bed }],
  kids: [
    { label: 'Bett', has: bed },
    { label: 'Stauraum (Schrank, Kommode oder Regal)', has: storage },
    { label: 'Tisch oder Schreibtisch', has: (t) => desk(t) || t.category === 'table' },
  ],
  office: [
    { label: 'Schreibtisch', has: desk },
    { label: 'Stuhl am Schreibtisch', has: (t) => t.category === 'chair' },
  ],
  dining: [
    { label: 'Esstisch', has: diningTable },
    { label: 'Stühle', has: (t) => t.category === 'chair' },
  ],
  kitchen: [],
  bath: [],
  hall: [{ label: 'Garderobe', has: coats }],
  utility: [],
  balcony: [{ label: 'Sitzplatz', has: seat, minArea: 2 }],
  other: [],
};

/** Functions of the flat that one room takes and no other (A2), with the pieces that give them away. */
export interface SingleFunction {
  /** Everyday name („Esstisch“). */
  label: string;
  /** Matches the function words of the concept („Essen für 4“, „Essplatz“). */
  test: RegExp;
}

export const SINGLE_FUNCTIONS: SingleFunction[] = [
  { label: 'Esstisch', test: /\bess(en|tisch|platz|bereich|ecke|zimmer)|\bdining/i },
  // „Gäste-WC“ is not a guest bed
  { label: 'Gästeschlafplatz', test: /(gäst|gast|guest).*(schlaf|bett|übernacht|sleep|bed)|(schlaf|bett|sleep|bed).*(gäst|gast|guest)|übernachtung/i },
  { label: 'Küchenzeile', test: /\bkoch|küchenzeile|\bcook/i },
];

/** A function word means cooking (needs a kitchen run or an existing kitchen). */
export const isCooking = (f: string) => SINGLE_FUNCTIONS[2].test.test(f);
export const isDining = (f: string) => SINGLE_FUNCTIONS[0].test.test(f);
export const isGuestBed = (f: string) => SINGLE_FUNCTIONS[1].test.test(f);
/** Sleeping of the residents (not the guests). */
export const isSleeping = (f: string) => /schlaf|sleep/i.test(f) && !/gäst|gast|guest/i.test(f);

/** Pieces a function needs in its room (beyond the room type). Work in a room that is not an office may use the dining table. */
export function functionNeeds(functions: readonly string[], type: RoomType = 'other'): Need[] {
  const out: Need[] = [];
  const any = (test: (f: string) => boolean) => functions.some(test);
  if (any(isSleeping)) out.push({ label: 'Bett (Funktion Schlafen)', has: bed });
  if (any(isGuestBed)) out.push({ label: 'Gästeschlafplatz (Schlafsofa, Tagesbett oder Bett)', has: (t) => bed(t) || sofa(t) });
  if (any(isDining)) out.push({ label: 'Esstisch (Funktion Essen)', has: diningTable }, { label: 'Stühle am Esstisch', has: (t) => t.category === 'chair' || t.shape === 'sofa' });
  if (any((f) => /arbeit|büro|homeoffice|schreibtisch|\bpc\b|computer|gaming|monitor/i.test(f))) out.push(type === 'office' || type === 'kids' ? { label: 'Schreibtisch (Funktion Arbeiten)', has: desk } : { label: 'Schreibtisch oder Tisch zum Arbeiten (Funktion Arbeiten)', has: (t) => desk(t) || diningTable(t) });
  if (any((f) => /lesen|leseecke|lese/i.test(f))) out.push({ label: 'Lesesessel oder Sofa (Funktion Lesen)', has: (t) => t.category === 'sofa' });
  if (any((f) => /garderobe/i.test(f))) out.push({ label: 'Garderobe', has: coats });
  if (any((f) => /kleidung|kleider/i.test(f))) out.push({ label: 'Kleiderschrank oder Kommode (Funktion Kleidung)', has: (t) => ['wardrobe', 'dresser'].includes(t.shape) || /schrank/i.test(t.name) });
  return out;
}

/** A guest bed among the programme pieces: a bed outside bed- and kids' rooms, or a piece labelled like one. */
export const looksLikeGuestBed = (t: Thing, label: string, type: RoomType) => (bed(t) && type !== 'bedroom' && type !== 'kids') || /schlafsofa|gästebett|gastbett|tagesbett|daybed|schlafcouch/i.test(label);
export { diningTable };
