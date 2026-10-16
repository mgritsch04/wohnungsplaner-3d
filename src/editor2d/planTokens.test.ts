/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The 2D plan keeps its light surface in dark mode, so its hint colours (#82) must
// keep their light values in the dark theme and stay readable on the plan background.
// relative to the project root (Vitest runs there) – independent of the test environment's import.meta.url
const themeCss = readFileSync(resolve('src/theme.css'), 'utf8');
const editorSrc = readFileSync(resolve('src/editor2d/Editor2D.tsx'), 'utf8');
const drawingSrc = readFileSync(resolve('src/editor2d/PlanDrawing.tsx'), 'utf8');
const PLAN_TOKENS = ['color-plan-ok', 'color-plan-warn', 'color-plan-halo', 'color-plan-visible', 'color-plan-hidden', 'color-plan-viewpoint', 'color-plan-group', ...['bg', 'grid', 'grid-major', 'wall', 'wall-line', 'opening', 'furniture-line', 'dimension', 'text', 'text-muted'].map((t) => `color-plan-${t}`)];

const valuesOf = (name: string) => [...themeCss.matchAll(new RegExp(`--${name}\\s*:\\s*(#[0-9a-f]{6})`, 'gi'))].map((m) => m[1].toLowerCase());

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('plan hint tokens (#82)', () => {
  it('have the same value in the light and both dark blocks', () => {
    for (const t of PLAN_TOKENS) {
      const v = valuesOf(t);
      expect(v).toHaveLength(3); // :root, [data-theme=dark], prefers-color-scheme: dark
      expect(new Set(v).size).toBe(1);
    }
  });

  it('are readable on the plan background (WCAG AA 4.5:1)', () => {
    const planBg = valuesOf('color-plan-bg')[0];
    // the editor draws its background with this token (fallback = the same value, for the PNG export)
    expect(editorSrc).toContain(`var(--color-plan-bg, ${planBg})`);
    const halo = valuesOf('color-plan-halo')[0];
    for (const t of ['color-plan-ok', 'color-plan-warn', 'color-plan-viewpoint', 'color-plan-text', 'color-plan-text-muted', 'color-plan-opening', 'color-plan-group']) {
      const c = valuesOf(t)[0];
      expect(contrast(c, planBg!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c, halo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('uses fallbacks equal to the tokens (the PNG export renders the plan without a stylesheet, #104)', () => {
    const uses = [...(editorSrc + drawingSrc).matchAll(/var\(--(color-plan-[a-z-]+), (#[0-9a-f]{6})\)/gi)];
    expect(uses.length).toBeGreaterThan(8);
    for (const [, name, fallback] of uses) expect(valuesOf(name)[0], name).toBe(fallback.toLowerCase());
  });
});
