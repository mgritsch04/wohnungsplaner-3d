import { describe, expect, it } from 'vitest';
import shortcutsSource from './useShortcuts.ts?raw';
import walkSource from '../view3d/WalkControls.tsx?raw';
import { SHORTCUT_GROUPS, TOOL_KEYS } from './shortcutCatalog';
const listed = new Set(SHORTCUT_GROUPS.flatMap((g) => g.items.flatMap((i) => i.match)));

describe('keyboard overview (#59)', () => {
  it('lists every key the editor handler reacts to', () => {
    const code = shortcutsSource;
    const keys = new Set<string>();
    for (const m of code.matchAll(/\bkey === '([^']+)'/g)) keys.add(m[1].toLowerCase());
    for (const m of code.matchAll(/e\.key === '([^']+)'/g)) keys.add(m[1].toLowerCase());
    for (const m of code.matchAll(/e\.key === 'Arrow(\w+)'/g)) keys.add(`arrow${m[1].toLowerCase()}`);
    if (code.includes("e.key.startsWith('Arrow')")) ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].forEach((k) => keys.add(k));
    for (const k of Object.keys(TOOL_KEYS)) keys.add(k);
    expect(keys.size).toBeGreaterThan(15);
    expect([...keys].filter((k) => !listed.has(k))).toEqual([]);
  });

  it('lists the Alt+digit camera bookmark keys the editor handler reacts to (#55)', () => {
    expect(shortcutsSource).toMatch(/\^Digit\(\[1-9\]\)\$/);
    for (let i = 1; i <= 9; i++) expect(listed.has(`Digit${i}`)).toBe(true);
  });

  it('lists every key the walkthrough reacts to', () => {
    const code = walkSource;
    const codes = new Set<string>();
    for (const m of code.matchAll(/'((?:Key[A-Z])|(?:Arrow\w+)|(?:Shift(?:Left|Right)))'/g)) codes.add(m[1]);
    expect(codes.size).toBeGreaterThan(8);
    expect([...codes].filter((c) => !listed.has(c))).toEqual([]);
  });

  it('shows every tool key once with a label', () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.title === 'Werkzeuge')!.items;
    for (const k of Object.keys(TOOL_KEYS)) expect(tools.filter((t) => t.match.includes(k))).toHaveLength(1);
    expect(tools.every((t) => t.action && !/^[a-z]+$/.test(t.action))).toBe(true);
  });
});
