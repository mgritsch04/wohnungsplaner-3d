import { describe, expect, it } from 'vitest';
import type { StylePlan } from '../types';
import { deriveScheme, fitToScheme, parseScheme, schemeColors, schemeText } from './scheme';

const style: StylePlan = {
  idea: 'ruhig',
  materials: [],
  palette: [
    { name: 'Sand', hex: '#d8cdb8', role: 'haupt' },
    { name: 'Salbei', hex: '#8a9a7b', role: 'zweit' },
    { name: 'Terrakotta', hex: '#b5654a', role: 'akzent' },
    { name: 'Weiß', hex: '#f4f2ee', role: 'neutral' },
  ],
};

describe('room colour scheme', () => {
  it('derives wall, furniture, textile and accent from the palette roles', () => {
    const s = deriveScheme(style, 'living');
    expect(s).toEqual({ wall: '#d8cdb8', furniture: '#8a9a7b', textile: '#f4f2ee', accent: '#b5654a' });
  });

  it('lightens the wall of calm rooms and uses the room accent', () => {
    const s = deriveScheme(style, 'bedroom', '#8a9a7b');
    expect(s.accent).toBe('#8a9a7b');
    expect(s.wall).not.toBe('#d8cdb8');
    expect(s.wall > '#d8cdb8').toBe(true);
  });

  it('parseScheme pulls colours outside the palette back and fills gaps', () => {
    const notes: string[] = [];
    const s = parseScheme({ wall: '#d8cdb8', furniture: '#3030ff', accent: '#b5654a', note: 'warm' }, style, 'living', undefined, 'Wohnzimmer', notes)!;
    expect(s.furniture).not.toBe('#3030ff');
    expect(schemeColors(s)).toContain(s.furniture);
    expect(s.textile).toBe('#f4f2ee');
    expect(s.note).toBe('warm');
    expect(notes).toHaveLength(1);
    expect(parseScheme('x', style, 'living', undefined, 'W', [])).toBeUndefined();
  });

  it('fitToScheme keeps neutrals and near colours, replaces strangers', () => {
    const s = deriveScheme(style, 'living');
    expect(fitToScheme('#808080', s).changed).toBe(false);
    expect(fitToScheme('#8c9c7d', s).changed).toBe(false);
    const r = fitToScheme('#2020ff', s);
    expect(r.changed).toBe(true);
    expect(schemeColors(s)).toContain(r.color);
  });

  it('schemeText names the palette colours', () => {
    expect(schemeText(deriveScheme(style, 'living'), style)).toContain('Salbei #8a9a7b');
  });
});
