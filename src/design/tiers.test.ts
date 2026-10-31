import { describe, expect, it } from 'vitest';
import { DEFAULT_TIER, tierInfo, tierPrice, tierPromptLine, tierTotals, TIERS } from './tiers';

const total = { real: 500, placeholder: 2000, unpriced: 1 };

describe('Budget-Stufen', () => {
  it('rechnet Platzhalter je Stufe, gefundene Produkte bleiben', () => {
    expect(tierPrice(total, 'guenstig')).toEqual({ real: 500, placeholder: 1200, sum: 1700 });
    expect(tierPrice(total, 'mittel').sum).toBe(2500);
    expect(tierPrice(total, 'schoen').sum).toBe(500 + 3600);
  });
  it('ist aufsteigend und kennt eine Standardstufe', () => {
    const sums = tierTotals(total).map((t) => t.sum);
    expect(sums).toEqual([...sums].sort((a, b) => a - b));
    expect(tierTotals(total)).toHaveLength(TIERS.length);
    expect(tierInfo(undefined).id).toBe(DEFAULT_TIER);
  });
  it('gibt Claude die Qualität der Stufe vor', () => {
    expect(tierPromptLine('guenstig')).toContain('günstigste');
    expect(tierPromptLine('schoen')).toContain('hochwertig');
  });
});
