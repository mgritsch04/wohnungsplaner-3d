import { describe, expect, it } from 'vitest';
import { put, rectRoom, review } from './testkit';

const has = (r: ReturnType<typeof review>, rule: string, text?: RegExp) => r.findings.some((f) => f.rule === rule && (!text || text.test(f.text)));
const room = (w: number, d: number) => rectRoom(w, d, { doors: [{ wall: 'S', at: w - 0.6 }], windows: [{ wall: 'N', at: w / 2 }] });

describe('L6 / L7 Licht (Recherche 6.11.)', () => {
  it('L6 a large living room with one ceiling light is too dark, with three lamps it is fine', () => {
    const pendant = put('generic-pendant', { x: 3, y: 2.5, elevation: 1.9 });
    const one = review({ room: room(6, 5), type: 'living', items: [pendant] });
    expect(one.findings.find((f) => f.rule === 'L6')?.severity).toBe('L');
    const three = review({ room: room(6, 5), type: 'living', items: [pendant, put('generic-floor-lamp', { x: 0.4, y: 4.5 }), put('generic-floor-lamp', { x: 5.6, y: 0.4 }), put('generic-pendant', { x: 1.5, y: 1.5, elevation: 1.9 })] });
    expect(has(three, 'L6')).toBe(false);
  });
  it('L7 two floor lamps side by side are a heap', () => {
    const r = review({ room: room(5, 4), type: 'living', items: [put('generic-floor-lamp', { x: 0.4, y: 3.6 }), put('generic-floor-lamp', { x: 1.0, y: 3.6 })] });
    expect(has(r, 'L7', /keinen Meter/)).toBe(true);
  });
  it('L7 a long room lit only at one end has a dark half', () => {
    const r = review({ room: room(8, 3.5), type: 'living', items: [put('generic-floor-lamp', { x: 0.4, y: 3.1 }), put('generic-pendant', { x: 1.5, y: 1.7, elevation: 1.9 })] });
    expect(has(r, 'L7', /dunkel/)).toBe(true);
    const lit = review({ room: room(8, 3.5), type: 'living', items: [put('generic-floor-lamp', { x: 0.4, y: 3.1 }), put('generic-pendant', { x: 4, y: 1.7, elevation: 1.9 }), put('generic-floor-lamp', { x: 7.6, y: 0.4 })] });
    expect(has(lit, 'L7')).toBe(false);
  });
});
