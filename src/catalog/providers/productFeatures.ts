/**
 * Shape details a product page states in its text (#273, stage 3): kind of table base, round
 * top, colour words for top/body and frame, and part sizes (top thickness, leg size, seat
 * height). Heuristic German word lists; nothing is guessed when the page says nothing, and the
 * earliest mention wins (the product's own details come before recommendations).
 */
import type { TableBase } from '../../model/schema';

export interface ProductFeatures {
  base?: TableBase;
  round?: boolean;
  /** colour of top / body / cover, from a colour word in the page text */
  color?: string;
  /** colour of frame / legs */
  secondaryColor?: string;
  /** in cm, as stated */
  topThickness?: number;
  legSize?: number;
  seatHeight?: number;
}

const BASES: [RegExp, TableBase][] = [
  [/kufen|u-gestell|u-f(u|ü)(ß|ss)/i, 'sled'],
  [/x-(gestell|f(u|ü)(ß|ss)|beine?)|kreuzgestell|gekreuzte\s+beine|a-gestell|bockgestell/i, 'x'],
  [/s(ä|ae)ulen(f(u|ü)(ß|ss)|gestell)|mittelf(u|ü)(ß|ss)|tellerf(u|ü)(ß|ss)|sockelf(u|ü)(ß|ss)|tulpenf(u|ü)(ß|ss)|trompetenf(u|ü)(ß|ss)/i, 'pedestal'],
  [/wangengestell|seitenwangen|wangenf(u|ü)(ß|ss)|plattenf(ü|ue)(ß|ss)e|plattengestell/i, 'panel'],
  [/(4|vier)\s*(tisch)?beine|vierfu(ß|ss)|beingestell/i, 'legs4'],
];

/** Common German colour and wood names → a representative colour. */
const COLOR_WORDS: [RegExp, string][] = [
  [/anthrazit/i, '#3a3d40'],
  [/dunkelgrau/i, '#4d5054'],
  [/hellgrau/i, '#c4c6c8'],
  [/grau/i, '#8a8d90'],
  [/schwarz/i, '#1f1f1f'],
  [/creme/i, '#efe8d8'],
  [/wei(ß|ss)/i, '#f2f2f0'],
  [/beige|sand/i, '#d6c7a8'],
  [/taupe/i, '#8b7d6b'],
  [/cognac/i, '#9a5b2e'],
  [/sonoma/i, '#c9a77c'],
  [/wildeiche|asteiche/i, '#b8895a'],
  [/eiche/i, '#c49a6c'],
  [/nussbaum|walnuss/i, '#6e4b33'],
  [/buche/i, '#d2a679'],
  [/kiefer/i, '#d9b77e'],
  [/akazie|teak|mango/i, '#9c6b3f'],
  [/braun/i, '#6b4a32'],
  [/chrom|edelstahl|silber|alu/i, '#b8bcc0'],
  [/gold|messing/i, '#b8963e'],
  [/kupfer/i, '#b87333'],
  [/oliv/i, '#6b6b3a'],
  [/gr(ü|ue)n/i, '#5a7a52'],
  [/petrol/i, '#2f5f66'],
  [/dunkelblau|navy/i, '#2a3550'],
  [/blau/i, '#3f5a7a'],
  [/bordeaux/i, '#6a2433'],
  [/rot/i, '#9a2f2f'],
  [/rosa/i, '#d9a5a8'],
  [/senf|gelb/i, '#c49a2c'],
  [/orange/i, '#cc7a35'],
];

const colorWord = (value: string) => COLOR_WORDS.find(([re]) => re.test(value))?.[1];

/** "Label: Wert" or a table row "Label<TAB>Wert" / "Label\nWert" (innerText of a data table). */
function labelled(text: string, label: string): string[] {
  const re = new RegExp(`(?:${label})[^\\n:\\t]{0,25}?(?::|\\t|\\n)\\s*([^\\n\\t;]{1,50})`, 'gi');
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** First length after a label, in cm (accepts "2,5 cm", "25 mm", "8 x 8 cm" → first number). */
function length(text: string, label: string, min: number, max: number): number | undefined {
  const re = new RegExp(`(?:${label})[^\\d\\n]{0,25}?(\\d+(?:[.,]\\d+)?)(?:\\s*[x×]\\s*\\d+(?:[.,]\\d+)?)?\\s*(mm|cm)\\b`, 'i');
  const m = text.match(re);
  if (!m) return undefined;
  const v = parseFloat(m[1].replace(',', '.')) / (m[2].toLowerCase() === 'mm' ? 10 : 1);
  return v >= min && v <= max ? Math.round(v * 10) / 10 : undefined;
}

export function featuresFromText(text: string, name: string | null = null): ProductFeatures {
  const f: ProductFeatures = {};
  let first = Infinity;
  for (const [re, base] of BASES) {
    const i = text.search(re);
    if (i >= 0 && i < first) {
      first = i;
      f.base = base;
    }
  }
  if ((name && /\brund(e|er|es)?\b/i.test(name)) || labelled(text, 'form|tischform|plattenform').some((v) => /^\s*rund/i.test(v))) f.round = true;
  const frameLabel = 'farbe\\s+(?:des\\s+)?(?:unter)?gestells?|gestellfarbe|farbe\\s+(?:der\\s+)?f(?:ü|ue)(?:ß|ss)e|farbe\\s+(?:der\\s+)?beine|(?:unter)?gestell|f(?:ü|ue)(?:ß|ss)e|beine|kufen';
  const mainLabel = 'farbe\\s+(?:der\\s+)?(?:tisch)?platte|plattenfarbe|farbe\\s+(?:des\\s+)?korpus|korpusfarbe|farbe\\s+(?:der\\s+)?front|frontfarbe|bezugsfarbe|farbe\\s+(?:des\\s+)?bezugs?|(?:tisch)?platte|korpus|bezug|farbe';
  f.secondaryColor = labelled(text, frameLabel).map(colorWord).find(Boolean);
  f.color = labelled(text, mainLabel).map(colorWord).find(Boolean);
  f.topThickness = length(text, 'plattenst(?:ä|ae)rke|plattendicke|st(?:ä|ae)rke\\s+(?:der\\s+)?(?:tisch)?platte|tischplattenst(?:ä|ae)rke|materialst(?:ä|ae)rke\\s+(?:der\\s+)?(?:tisch)?platte', 0.8, 12);
  f.legSize = length(text, '(?:bein|fu(?:ß|ss)|f(?:ü|ue)(?:ß|ss)e|gestell)(?:st(?:ä|ae)rke|dicke|durchmesser|breite|querschnitt)|st(?:ä|ae)rke\\s+(?:der\\s+)?(?:beine|f(?:ü|ue)(?:ß|ss)e)', 1, 20);
  f.seatHeight = length(text, 'sitzh(?:ö|oe)he', 30, 80);
  for (const k of Object.keys(f) as (keyof ProductFeatures)[]) if (f[k] === undefined) delete f[k];
  return f;
}
