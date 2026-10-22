/**
 * Door widths of recognised plans (#267). A gap in the wall is the shell dimension (Rohbaumaß); the
 * clear width between the jambs is smaller. The plan's own label next to the door ("80 / 200") gives it
 * directly; without a label the usual jamb allowance is taken off the gap.
 */
import type { Vec2 } from '../model/vec';
import type { DraftOpening } from './draft';
import type { PlacedText } from './rooms';

/** "80 / 200", "90x210", "0,80 / 2,00" – clear width / height of a door. */
const DOOR_LABEL = /^\s*(\d+(?:[.,]\d+)?)\s*[/x×]\s*(\d+(?:[.,]\d+)?)\s*$/i;
/** Jamb and lining allowance taken off a shell gap (m), both sides together. */
export const JAMB_ALLOWANCE = 0.1;
const MIN_DOOR_WIDTH = 0.6;
const MAX_DOOR_WIDTH = 1.4;
/** A label belongs to a door if its centre is this far (m) from the opening centre at most. */
const LABEL_REACH = 0.9;

/** Clear width in metres from a "80 / 200" label, or undefined. Values below 10 count as metres, others as cm. */
export function doorLabelWidth(str: string): number | undefined {
  const m = DOOR_LABEL.exec(str);
  if (!m) return undefined;
  const num = (t: string) => parseFloat(t.replace(',', '.'));
  const w = num(m[1]);
  const h = num(m[2]);
  const toM = (v: number) => (v < 10 ? v : v / 100);
  const width = toM(w);
  // a door label has a height of about 2 m after the width
  if (toM(h) < 1.8 || toM(h) > 2.6 || width < MIN_DOOR_WIDTH || width > MAX_DOOR_WIDTH) return undefined;
  return width;
}

const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

/** Narrow recognised doors to their clear width; the centre stays where the gap is. Returns the changed count too. */
export function applyDoorWidths(openings: DraftOpening[], texts: PlacedText[] | undefined): { openings: DraftOpening[]; labelled: number; reduced: number } {
  const labels = (texts ?? []).flatMap((t) => {
    const w = doorLabelWidth(t.str);
    return w === undefined ? [] : [{ at: { x: t.x, y: t.y } as Vec2, width: w }];
  });
  const taken = new Set<number>();
  let labelled = 0;
  let reduced = 0;
  const out = openings.map((o) => {
    if (o.kind !== 'door') return o;
    let best = -1;
    let bestD = LABEL_REACH;
    labels.forEach((l, i) => {
      const d = dist(l.at, o.center);
      if (!taken.has(i) && d <= bestD) {
        best = i;
        bestD = d;
      }
    });
    if (best >= 0 && labels[best].width <= o.width + 0.02) {
      taken.add(best);
      labelled++;
      return { ...o, width: labels[best].width, note: `${o.note ?? 'Tür'} – Breite aus der Beschriftung im Plan` };
    }
    if (o.width - JAMB_ALLOWANCE >= MIN_DOOR_WIDTH) {
      reduced++;
      return { ...o, width: o.width - JAMB_ALLOWANCE, note: `${o.note ?? 'Tür'} – lichte Breite (Rohbaulücke minus Zarge)` };
    }
    return o;
  });
  return { openings: out, labelled, reduced };
}
