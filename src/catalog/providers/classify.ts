/**
 * Furniture type (planner category + procedural shape) from what a product page
 * states: its name and its own category / breadcrumb labels. Heuristic word lists
 * (German); never a silent default – when nothing matches, the result says so and
 * the user picks the category.
 */
import type { CategoryId } from '../types';

export interface CategoryGuess {
  category: CategoryId | null;
  /** procedural stand-in shape for the 3D view */
  shape: string | null;
  /** 'sicher': name and page category agree (or only one is known) · 'unsicher': they contradict · 'unbekannt': no match */
  confidence: 'sicher' | 'unsicher' | 'unbekannt';
  /** short German explanation shown next to the category field */
  reason: string;
}

interface Rule {
  re: RegExp;
  category: CategoryId;
  shape: string;
  label: string;
}

/**
 * Order matters: more specific words first ("Tischlampe" before "Tisch",
 * "Couchtisch" before "Couch", "Bürostuhl" before "Stuhl", "Bettsofa" before "Bett").
 */
const RULES: Rule[] = [
  { re: /stehlampe|stehleuchte|bogenlampe|bogenleuchte/i, category: 'lighting', shape: 'floor-lamp', label: 'Stehlampe' },
  { re: /tischlampe|tischleuchte|nachttischlampe|schreibtischlampe|leselampe/i, category: 'lighting', shape: 'table-lamp', label: 'Tischlampe' },
  { re: /pendel(leuchte|lampe)|hängeleuchte|hängelampe|deckenleuchte|deckenlampe|kronleuchter|luster/i, category: 'lighting', shape: 'pendant', label: 'Deckenleuchte' },
  { re: /lampe|leuchte|strahler/i, category: 'lighting', shape: 'table-lamp', label: 'Leuchte' },
  { re: /couchtisch|sofatisch|beistelltisch|wohnzimmertisch/i, category: 'table', shape: 'table', label: 'Couch-/Beistelltisch' },
  { re: /schlafsofa|bettsofa|schlafcouch/i, category: 'sofa', shape: 'sofa', label: 'Schlafsofa' },
  { re: /ecksofa|wohnlandschaft|eckcouch/i, category: 'sofa', shape: 'sofa-corner', label: 'Ecksofa' },
  { re: /sessel/i, category: 'sofa', shape: 'armchair', label: 'Sessel' },
  { re: /sofa|couch|récamiere|recamiere|zweisitzer|dreisitzer/i, category: 'sofa', shape: 'sofa', label: 'Sofa' },
  { re: /schreibtisch|computertisch|arbeitstisch/i, category: 'desk', shape: 'desk', label: 'Schreibtisch' },
  { re: /nachttisch|nachtkästchen|nachtkasten|nachtschrank|nachtkonsole/i, category: 'bed', shape: 'cabinet', label: 'Nachttisch' },
  { re: /tisch/i, category: 'table', shape: 'table', label: 'Tisch' },
  { re: /bürostuhl|drehstuhl|chefsessel|gamingstuhl/i, category: 'chair', shape: 'office-chair', label: 'Bürostuhl' },
  { re: /hocker/i, category: 'chair', shape: 'stool', label: 'Hocker' },
  { re: /stuhl|stühle|sitzbank|essbank|\bbank\b/i, category: 'chair', shape: 'chair', label: 'Stuhl' },
  { re: /matratze|topper/i, category: 'textile', shape: 'mattress', label: 'Matratze' },
  { re: /boxspring|bettgestell|matratze|bett(en)?\b/i, category: 'bed', shape: 'bed', label: 'Bett' },
  { re: /teppich|läufer/i, category: 'textile', shape: 'rug', label: 'Teppich' },
  { re: /vorhang|vorhänge|gardine|\bschals?\b/i, category: 'textile', shape: 'curtain', label: 'Vorhang' },
  { re: /kühlschrank|herd|backofen|geschirrspüler|dunstabzug|mikrowelle|waschmaschine|trockner/i, category: 'appliance', shape: 'box', label: 'Gerät' },
  { re: /spüle|arbeitsplatte|küchenzeile|küchenblock|unterschrank|oberschrank|hängeschrank/i, category: 'kitchen', shape: 'k-base', label: 'Küchenelement' },
  { re: /waschbecken|waschtisch|spiegelschrank|dusche|badewanne/i, category: 'bathroom', shape: 'washbasin', label: 'Badmöbel' },
  { re: /wandgarderobe|garderobenhaken|hakenleiste|kleiderhaken/i, category: 'storage', shape: 'coat-rack', label: 'Wandgarderobe' },
  { re: /staubsauger/i, category: 'appliance', shape: 'vacuum', label: 'Staubsauger' },
  { re: /aufbewahrungsbox|aufbewahrungskiste|\bkiste\b|\bbox\b|korb/i, category: 'storage', shape: 'box', label: 'Box' },
  { re: /kleiderschrank|drehtürenschrank|schwebetürenschrank|garderobenschrank/i, category: 'storage', shape: 'wardrobe', label: 'Kleiderschrank' },
  { re: /kommode|sideboard|lowboard|highboard|anrichte|tv-element|tv-möbel/i, category: 'storage', shape: 'cabinet', label: 'Kommode/Sideboard' },
  { re: /regal|bücherregal|standregal|wandregal/i, category: 'storage', shape: 'shelf', label: 'Regal' },
  { re: /schrank|vitrine|aufbewahrung/i, category: 'storage', shape: 'cabinet', label: 'Schrank' },
  // real or artificial plants (#269) – not stands, pots or plant lights
  { re: /(?:pflanze|palme|kaktus|sukkulente|orchidee|monstera|ficus|bonsai)(?!n?(?:ständer|hocker|regal|leuchte|lampe|licht|kübel|topf|tisch|säule))/i, category: 'decor', shape: 'plant', label: 'Pflanze' },
  { re: /bilderrahmen|\bbild\b|poster|kunstdruck|leinwandbild|wandbild/i, category: 'decor', shape: 'picture', label: 'Bild' },
  { re: /spiegel/i, category: 'decor', shape: 'panel', label: 'Spiegel' },
  { re: /pflanze|vase|spiegel|deko|bilderrahmen/i, category: 'decor', shape: 'box', label: 'Deko' },
];

const match = (text: string) => RULES.find((r) => r.re.test(text)) ?? null;

/**
 * @param name product name from the page
 * @param hints page category labels, most general first (e.g. breadcrumb "Wohnzimmer › Sessel")
 */
export function classifyProduct(name: string | null, hints: string[] = []): CategoryGuess {
  const fromName = name ? match(name) : null;
  // most specific label first: last breadcrumb entries describe the product best
  let fromHints: Rule | null = null;
  let hintText = '';
  for (const h of [...hints].reverse()) {
    const r = match(h);
    if (r) {
      fromHints = r;
      hintText = h;
      break;
    }
  }
  if (fromName && fromHints) {
    if (fromName.category === fromHints.category) {
      return { category: fromName.category, shape: fromName.shape, confidence: 'sicher', reason: `Name und Seitenkategorie („${hintText}“): ${fromName.label}` };
    }
    return {
      category: fromName.category,
      shape: fromName.shape,
      confidence: 'unsicher',
      reason: `Widerspruch: Name deutet auf ${fromName.label}, Seitenkategorie „${hintText}“ auf ${fromHints.label} – bitte prüfen`,
    };
  }
  if (fromName) return { category: fromName.category, shape: fromName.shape, confidence: 'sicher', reason: `aus dem Namen: ${fromName.label}` };
  if (fromHints) return { category: fromHints.category, shape: fromHints.shape, confidence: 'sicher', reason: `aus der Seitenkategorie „${hintText}“: ${fromHints.label}` };
  return { category: null, shape: null, confidence: 'unbekannt', reason: 'Produkttyp nicht erkannt – bitte Kategorie wählen' };
}
