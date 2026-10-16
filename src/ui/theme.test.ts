/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// read the files directly: Vitest does not process CSS (also not with ?raw)
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const themeCss = read('../theme.css');
const stylesCss = read('../styles.css');
const versionsCss = read('../versions/versions.css');

/** Reads all `--name: value;` declarations of a CSS block. */
function readTokens(css: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim());
  return tokens;
}

/** Body of the first rule with this selector after `from` (token blocks have no nested braces). */
function ruleBody(css: string, selector: string, from = 0): string {
  const at = css.indexOf(`${selector} {`, from);
  if (at < 0) throw new Error(`rule ${selector} not found`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
}

const lightCss = ruleBody(themeCss, '\n:root');
const darkCss = ruleBody(themeCss, ":root[data-theme='dark']");
const systemDarkCss = ruleBody(themeCss, ":root:not([data-theme='light'])", themeCss.indexOf('@media (prefers-color-scheme: dark)'));

const tokens = readTokens(lightCss);
const darkTokens = new Map([...tokens, ...readTokens(darkCss)]);

function color(name: string, from: Map<string, string> = tokens): string {
  let v = from.get(name);
  // follow var(--x) aliases
  for (let i = 0; v && v.startsWith('var(') && i < 5; i++) v = from.get(v.slice(6, -1));
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`token --${name} is not a 6-digit hex colour: ${v}`);
  return v;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('design tokens (#96–#98)', () => {
  it('computes WCAG contrast correctly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });

  // text / background pairs that occur in the UI – WCAG AA for normal text: 4.5:1
  const pairs: [string, string][] = [
    ['color-text', 'color-bg'],
    ['color-text', 'color-surface'],
    ['color-text', 'color-surface-hover'],
    ['color-text', 'color-surface-pressed'],
    ['color-text-muted', 'color-surface'],
    ['color-text-muted', 'color-bg'],
    ['color-text-muted', 'color-surface-alt'],
    ['color-text-muted', 'color-surface-hover'],
    ['color-text-subtle', 'color-surface'],
    ['color-text-code', 'color-surface'],
    ['color-accent', 'color-surface'],
    ['color-accent', 'color-surface-alt'],
    ['color-accent-hover', 'color-surface'],
    ['color-on-accent', 'color-accent'],
    ['color-on-accent', 'color-accent-hover'],
    ['color-on-accent', 'color-accent-pressed'],
    ['color-accent-soft-text', 'color-accent-soft'],
    ['color-accent-soft-text', 'color-accent-soft-hover'],
    ['color-danger', 'color-surface'],
    ['color-danger-hover', 'color-danger-soft'],
    ['color-danger-strong', 'color-danger-soft'],
    ['color-danger-strong', 'color-danger-soft-strong'],
    ['color-on-danger', 'color-danger'],
    ['color-on-danger', 'color-danger-hover'],
    ['color-warning', 'color-warning-soft'],
    ['color-warning', 'color-surface'],
    ['color-warning-strong', 'color-warning-soft-strong'],
    ['color-success-strong', 'color-success-soft'],
    ['color-neutral-strong', 'color-neutral-soft'],
    ['color-text', 'color-info-soft'],
    ['color-toast-text', 'color-toast-bg'],
    ['color-toast-text', 'color-toast-error-bg'],
  ];
  it.each(pairs)('%s on %s reaches WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(color(fg), color(bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(pairs)('dark mode: %s on %s reaches WCAG AA (4.5:1)', (fg, bg) => {
    expect(contrast(color(fg, darkTokens), color(bg, darkTokens))).toBeGreaterThanOrEqual(4.5);
  });

  it('defines the type scale in rem and a system font stack (no web fonts)', () => {
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl']) expect(tokens.get(`font-size-${step}`)).toMatch(/^[0-9.]+rem$/);
    expect(tokens.get('font-family')).toMatch(/system-ui/);
    expect(themeCss + stylesCss).not.toMatch(/@font-face|fonts\.googleapis|url\(\s*['"]?https?:/);
  });

  it('keeps hard-coded colours out of the UI styles (only the 3D backdrop and the print sheet keep fixed colours)', () => {
    const ui = stylesCss.split('/* ---------- print view / plan export')[0].replace(/\.scene3d \{[^}]*\}/, '');
    expect(ui.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
    expect(versionsCss.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) ?? []).toEqual([]);
  });

  it('only uses tokens that are defined', () => {
    const used = new Set([...(stylesCss + versionsCss + themeCss).matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
    const missing = [...used].filter((t) => !tokens.has(t));
    expect(missing).toEqual([]);
  });
});

describe('dark mode tokens (#73)', () => {
  const themed = (m: Map<string, string>) => [...m.keys()].filter((k) => k.startsWith('color-') || k.startsWith('shadow-')).sort();

  it('gives every colour and shadow token a dark value – and changes nothing else', () => {
    const dark = readTokens(darkCss);
    expect(themed(dark)).toEqual(themed(tokens));
    expect([...dark.keys()].filter((k) => !k.startsWith('color-') && !k.startsWith('shadow-'))).toEqual([]);
  });

  it('really is dark (not a copy of the light values)', () => {
    for (const t of ['color-bg', 'color-surface', 'color-text', 'color-border']) expect(darkTokens.get(t)).not.toBe(tokens.get(t));
    expect(contrast(color('color-bg', darkTokens), '#000000')).toBeLessThan(1.5);
    expect(contrast(color('color-surface', darkTokens), '#000000')).toBeLessThan(1.5);
  });

  it('uses the same values for „Dunkel“ and for „System“ with a dark system theme', () => {
    const norm = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
    expect(norm(systemDarkCss)).toBe(norm(darkCss));
    expect(themeCss).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme='light'\]\) \{/);
  });

  it('switches native controls and scrollbars via color-scheme', () => {
    expect(lightCss).toMatch(/color-scheme: light;/);
    expect(darkCss).toMatch(/color-scheme: dark;/);
    expect(systemDarkCss).toMatch(/color-scheme: dark;/);
  });

  it('keeps the print sheet white in dark mode', () => {
    const page = stylesCss.match(/\n\.print-page \{([^}]*)\}/)?.[1] ?? '';
    expect(page).toMatch(/background: #ffffff;/);
    expect(page).toMatch(/color-scheme: light;/);
    // secondary text on the sheet must not follow the (light-on-dark) UI token
    const muted = stylesCss.match(/\n\.print-page \.muted \{([^}]*)\}/)?.[1] ?? '';
    expect(contrast(muted.match(/color: (#[0-9a-f]{6});/i)?.[1] ?? '#ffffff', '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});
