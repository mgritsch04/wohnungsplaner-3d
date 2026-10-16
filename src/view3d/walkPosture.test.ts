import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { ProjectSchema } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { DUCK_MIN_EYE, DUCK_SPEED, goalEyeHeight, walkSpeedFactor } from './walkPosture';

describe('walkthrough posture (#78)', () => {
  it('stands at the eye height, sits at the seated eye height', () => {
    expect(goalEyeHeight({ eye: 1.63, sitEye: 1.2, sitting: false, ducking: false })).toBe(1.63);
    expect(goalEyeHeight({ eye: 1.63, sitEye: 1.2, sitting: true, ducking: false })).toBe(1.2);
    expect(goalEyeHeight({ eye: 1.8, sitEye: 1.05, sitting: true, ducking: false })).toBe(1.05);
  });

  it('ducks when standing, ignores ducking when seated', () => {
    expect(goalEyeHeight({ eye: 1.63, sitEye: 1.2, sitting: false, ducking: true })).toBeCloseTo(1.63 * 0.6, 6);
    expect(goalEyeHeight({ eye: 1.1, sitEye: 1.2, sitting: false, ducking: true })).toBe(DUCK_MIN_EYE);
    expect(goalEyeHeight({ eye: 1.63, sitEye: 1.2, sitting: true, ducking: true })).toBe(1.2);
  });

  it('old projects load with the default seated eye height of 120 cm; the range is enforced', () => {
    const raw = structuredClone(createEmptyProject()) as unknown as { settings: Record<string, unknown> };
    delete raw.settings.sitEyeHeight;
    expect(ProjectSchema.parse(raw).settings.sitEyeHeight).toBe(1.2);
    expect(createEmptyProject().settings.sitEyeHeight).toBe(1.2);
    expect(ProjectSchema.parse({ ...raw, settings: { ...raw.settings, sitEyeHeight: 1.05 } }).settings.sitEyeHeight).toBe(1.05);
    expect(() => ProjectSchema.parse({ ...raw, settings: { ...raw.settings, sitEyeHeight: 0.5 } })).toThrow();
    expect(() => ProjectSchema.parse({ ...raw, settings: { ...raw.settings, sitEyeHeight: 1.7 } })).toThrow();
  });

  it('crouched or seated walks slower', () => {
    expect(walkSpeedFactor({ sitting: false, ducking: false })).toBe(1);
    expect(walkSpeedFactor({ sitting: false, ducking: true })).toBe(DUCK_SPEED);
    expect(walkSpeedFactor({ sitting: true, ducking: false })).toBe(DUCK_SPEED);
    expect(DUCK_SPEED).toBeLessThan(1);
  });

  it('C toggles crouching; sitting or standing up via X/buttons ends it; ignored while seated (#47)', () => {
    const ui = () => useUiStore.getState();
    ui().setWalkSit(false);
    ui().setWalkDuck(false);
    ui().toggleWalkDuck();
    expect(ui().walkDuck).toBe(true);
    ui().toggleWalkDuck();
    expect(ui().walkDuck).toBe(false);
    ui().toggleWalkDuck();
    ui().setWalkSit(true);
    expect(ui().walkDuck).toBe(false);
    ui().toggleWalkDuck();
    expect(ui().walkDuck).toBe(false);
    ui().setWalkSit(false);
    ui().toggleWalkDuck();
    ui().setWalkSit(false); // "Stehen" button
    expect(ui().walkDuck).toBe(false);
  });
});
