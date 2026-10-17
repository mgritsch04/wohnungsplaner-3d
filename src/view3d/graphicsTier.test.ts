import { describe, expect, it } from 'vitest';
import { isSoftwareRenderer, resolveGraphicsTier, tierSettings, useGraphicsTierStore } from './graphicsTier';

const pc = { phone: false, coarsePointer: false, softwareRenderer: false, declined: false };

describe('graphics level of realism mode (#192)', () => {
  it('automatic: "high" only on a desktop with a real graphics card that keeps up', () => {
    expect(resolveGraphicsTier('auto', pc)).toBe('high');
    expect(resolveGraphicsTier('auto', { ...pc, phone: true })).toBe('normal');
    expect(resolveGraphicsTier('auto', { ...pc, coarsePointer: true })).toBe('normal');
    expect(resolveGraphicsTier('auto', { ...pc, softwareRenderer: true })).toBe('normal');
    expect(resolveGraphicsTier('auto', { ...pc, declined: true })).toBe('normal');
  });

  it('a manual choice wins over the device', () => {
    expect(resolveGraphicsTier('high', { ...pc, phone: true })).toBe('high');
    expect(resolveGraphicsTier('normal', pc)).toBe('normal');
  });

  it('"high" is finer than "normal"', () => {
    const hi = tierSettings('high');
    const lo = tierSettings('normal');
    expect(hi.envSize).toBeGreaterThan(lo.envSize);
    expect(hi.envStepHours).toBeLessThan(lo.envStepHours);
    expect(lo.aoQuality).toBe('medium'); // as before #192
  });

  it('recognises software renderers', () => {
    expect(isSoftwareRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)')).toBe(true);
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true);
    expect(isSoftwareRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe(false);
  });

  it('remembers the choice on this device', () => {
    useGraphicsTierStore.getState().setPref('high');
    expect(localStorage.getItem('wp.graphicsTier')).toBe('high');
    useGraphicsTierStore.getState().setPref('auto');
    expect(localStorage.getItem('wp.graphicsTier')).toBeNull();
  });
});
