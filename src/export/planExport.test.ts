import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createSampleProject } from '../model/sample';
import { PAGE_MARGIN_MM, PX_PER_MM, fitPlanToBox, planBounds, planBoxOnA4, planFileName, scaleBarLength } from './planExport';

describe('plan export', () => {
  it('picks a round scale bar of at most a quarter of the plan width', () => {
    expect(scaleBarLength(8)).toBe(2);
    expect(scaleBarLength(12)).toBe(2.5);
    expect(scaleBarLength(30)).toBe(5);
    expect(scaleBarLength(3)).toBe(0.5);
    expect(scaleBarLength(0)).toBe(0.1);
  });

  it('fits a plan on A4 portrait and landscape at a standard scale', () => {
    const b = { minX: 0, minY: 0, maxX: 12, maxY: 8 }; // 12 × 8 m apartment
    for (const o of ['portrait', 'landscape'] as const) {
      const box = planBoxOnA4(o);
      const fit = fitPlanToBox(b, box.widthMm, box.heightMm);
      expect(fit.widthMm).toBeLessThanOrEqual(box.widthMm);
      expect(fit.heightMm).toBeLessThanOrEqual(box.heightMm);
      // 1:50 would be 240 mm wide – too large for either page
      expect([50, 75, 100, 150]).toContain(fit.denominator);
      // 1 m on paper = 1000 / n mm, expressed in CSS px for the drawing
      expect(fit.pxPerM).toBeCloseTo((1000 / fit.denominator) * PX_PER_MM, 6);
    }
    expect(fitPlanToBox(b, planBoxOnA4('portrait').widthMm, planBoxOnA4('portrait').heightMm).denominator).toBe(75);
    expect(fitPlanToBox(b, planBoxOnA4('landscape').widthMm, planBoxOnA4('landscape').heightMm).denominator).toBe(75);
  });

  it('keeps the page content inside the printable A4 area', () => {
    const p = planBoxOnA4('portrait');
    const l = planBoxOnA4('landscape');
    expect(p.widthMm).toBe(210 - 2 * PAGE_MARGIN_MM);
    expect(p.heightMm).toBeLessThan(297 - 2 * PAGE_MARGIN_MM);
    expect(l.widthMm).toBeLessThan(297 - 2 * PAGE_MARGIN_MM);
    expect(l.heightMm).toBeLessThan(210 - 2 * PAGE_MARGIN_MM);
  });

  it('falls back to a non-standard scale for very large plans', () => {
    const fit = fitPlanToBox({ minX: 0, minY: 0, maxX: 500, maxY: 10 }, 190, 150);
    expect(fit.widthMm).toBeLessThanOrEqual(190);
    expect(fit.denominator).toBeGreaterThan(2000);
  });

  it('measures the sample apartment including furniture', () => {
    const p = createSampleProject();
    const b = planBounds(p, derivePlan(p))!;
    expect(b.maxX - b.minX).toBeGreaterThan(5);
    expect(b.maxY - b.minY).toBeGreaterThan(3);
  });

  it('builds a safe file name with the date', () => {
    expect(planFileName('Meine Wohnung / 2. OG', new Date(2026, 9, 6), 'png')).toBe('Meine-Wohnung-2-OG-grundriss-2026-10-06.png');
    expect(planFileName('', new Date(2026, 0, 1), 'pdf')).toBe('wohnung-grundriss-2026-01-01.pdf');
  });
});
