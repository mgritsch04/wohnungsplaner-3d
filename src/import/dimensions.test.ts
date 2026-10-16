import { describe, expect, it } from 'vitest';
import { checkScale, matchDimensions, parseDimensionText, scaleCheckMessage, type LineSegment, type PlanText } from './dimensions';

/**
 * Synthetic dimension chains (100 px = 1 m): a horizontal chain 90–350–610 px
 * above the plan and a vertical one 90–510 px on the left, drawn like CAD
 * output (dimension line, extension lines, 45° ticks, text above the line).
 */
function drawing() {
  const seg = (x1: number, y1: number, x2: number, y2: number): LineSegment => ({ x1, y1, x2, y2 });
  const segments: LineSegment[] = [seg(90, 50, 610, 50), seg(50, 90, 50, 510)];
  for (const x of [90, 350, 610]) segments.push(seg(x, 40, x, 95), seg(x - 4, 54, x + 4, 46));
  for (const y of [90, 510]) segments.push(seg(40, y, 95, y), seg(46, y + 4, 54, y - 4));
  // a wall face line that runs through a dimension text further right
  segments.push(seg(700, 30, 700, 200), seg(650, 120, 900, 120));
  const text = (str: string, cx: number, cy: number, dir: { x: number; y: number }, width = 20): PlanText => ({
    str,
    x: cx - (dir.x * width) / 2,
    y: cy - (dir.y * width) / 2,
    dir,
    width,
    height: 10,
  });
  const texts: PlanText[] = [
    text('2,60', 220, 46, { x: 1, y: 0 }), // metres
    text('260', 480, 46, { x: 1, y: 0 }, 15), // centimetres
    text('4,20', 46, 300, { x: 0, y: -1 }), // vertical, reading upwards, left of its line
    text('2020', 300, 300, { x: 1, y: 0 }), // a number without a dimension line
    text('12,34 m²', 300, 330, { x: 1, y: 0 }, 40), // room area, not a dimension
    text('1,00', 700, 116, { x: 1, y: 0 }), // a line runs through the text – ambiguous
  ];
  return { segments, texts };
}

describe('dimension texts', () => {
  it('parses metre, centimetre and superscript notations', () => {
    expect(parseDimensionText('3,50')).toBe(3.5);
    expect(parseDimensionText('3.50')).toBe(3.5);
    expect(parseDimensionText('3,51⁵')).toBeCloseTo(3.515, 6);
    expect(parseDimensionText('350')).toBe(3.5);
    expect(parseDimensionText('88⁵')).toBeCloseTo(0.885, 6);
    expect(parseDimensionText('12,34 m²')).toBeNull();
    expect(parseDimensionText('Bad')).toBeNull();
    expect(parseDimensionText('5')).toBeNull();
    expect(parseDimensionText('0,10')).toBeNull(); // too small to check a scale
  });

  it('pairs texts with their dimension line and ticks', () => {
    const { segments, texts } = drawing();
    const m = matchDimensions(texts, segments);
    expect(m.map((x) => x.text).sort()).toEqual(['2,60', '260', '4,20']);
    const by = (t: string) => m.find((x) => x.text === t)!;
    expect(by('2,60').spanPx).toBeCloseTo(260, 6);
    expect(by('260').spanPx).toBeCloseTo(260, 6);
    expect(by('4,20').spanPx).toBeCloseTo(420, 6);
    expect(by('4,20').center.y).toBeCloseTo(300, 6);
  });

  it('confirms a matching scale and warns about a deviating one', () => {
    const { segments, texts } = drawing();
    const m = matchDimensions(texts, segments);
    const ok = checkScale(m, 0.01);
    expect(ok.status).toBe('ok');
    expect(ok.consistent).toHaveLength(3);
    expect(Math.abs(ok.deviation!)).toBeLessThan(1e-9);
    expect(scaleCheckMessage(ok)).toMatch(/passen zum Maßstab \(3 Maße/);
    const off = checkScale(m, 0.0105);
    expect(off.status).toBe('mismatch');
    expect(off.deviation).toBeCloseTo(0.05, 6);
    expect(scaleCheckMessage(off)).toMatch(/Abweichung \+5,0 %.*nicht automatisch geändert/);
  });

  it('gives no verdict on too few or contradicting dimensions', () => {
    const { segments, texts } = drawing();
    const m = matchDimensions(texts, segments);
    expect(checkScale([], 0.01).status).toBe('none');
    expect(scaleCheckMessage(checkScale([], 0.01))).toBeNull();
    expect(checkScale(m.slice(0, 1), 0.01).status).toBe('unclear');
    const contradicting = [m[0], { ...m[1], value: m[1].value * 1.3 }];
    expect(checkScale(contradicting, 0.01).status).toBe('unclear');
  });
});
