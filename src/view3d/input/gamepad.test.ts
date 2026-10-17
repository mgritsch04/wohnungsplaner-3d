import { describe, expect, it } from 'vitest';
import { applyCurve, applyDeadZone, BUTTON, createGamepadSource, pickPad, readPad, useGamepadState, type PadLike } from './gamepad';

const pad = (axes: number[], held: number[] = [], extra: Partial<PadLike> = {}): PadLike => ({
  connected: true,
  mapping: 'standard',
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: held.includes(i), value: held.includes(i) ? 1 : 0 })),
  ...extra,
});

describe('gamepad input (#29)', () => {
  it('dead zone hides stick drift and rescales without a jump', () => {
    expect(applyDeadZone(0.1, -0.05)).toEqual({ x: 0, y: 0 });
    const just = applyDeadZone(0.16, 0);
    expect(just.x).toBeGreaterThan(0);
    expect(just.x).toBeLessThan(0.02);
    expect(applyDeadZone(1, 0).x).toBeCloseTo(1);
    // square-gated diagonal is clamped to magnitude 1
    const d = applyDeadZone(1, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
  });

  it('response curve slows small deflections and keeps the direction', () => {
    const c = applyCurve({ x: 0.5, y: 0 });
    expect(c.x).toBeCloseTo(0.25);
    const full = applyCurve({ x: 0.6, y: -0.8 });
    expect(full.x).toBeCloseTo(0.6);
    expect(full.y).toBeCloseTo(-0.8);
    expect(applyCurve({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it('maps left stick to walking (up = forward), right stick to looking, RT/stick click to run', () => {
    const r = readPad(pad([0, -1, 1, 0]));
    expect(r.move.z).toBeCloseTo(1);
    expect(r.move.x).toBeCloseTo(0);
    expect(r.look.x).toBeCloseTo(1);
    expect(r.run).toBe(false);
    expect(readPad(pad([0, 0, 0, 0], [BUTTON.RT])).run).toBe(true);
    expect(readPad(pad([0, 0, 0, 0], [BUTTON.LS])).run).toBe(true);
    // analog trigger value counts without the pressed flag
    const p = pad([0, 0, 0, 0]);
    (p.buttons as { pressed: boolean; value: number }[])[BUTTON.RT] = { pressed: false, value: 0.8 };
    expect(readPad(p).run).toBe(true);
  });

  it('prefers a connected pad with standard mapping', () => {
    const odd = pad([0, 0], [], { mapping: '' });
    const std = pad([0, 0]);
    expect(pickPad([null, odd, std])).toBe(std);
    expect(pickPad([odd])).toBe(odd);
    expect(pickPad([pad([0, 0], [], { connected: false }), null])).toBeNull();
  });

  it('reports button presses once (edge), ignores buttons held when the pad appears, stops on disconnect', () => {
    let pads: (PadLike | null)[] = [pad([0, 0], [BUTTON.A])];
    const src = createGamepadSource(() => pads);
    expect(src.poll()?.pressed.size).toBe(0); // A already held on first sight
    expect(useGamepadState.getState().connected).toBe(true);
    pads = [pad([0, 0], [])];
    expect(src.poll()?.pressed.size).toBe(0);
    pads = [pad([0, 0], [BUTTON.A, BUTTON.Y])];
    expect([...src.poll()!.pressed].sort()).toEqual([BUTTON.A, BUTTON.Y]);
    expect(src.poll()?.pressed.size).toBe(0); // still held: no repeat
    pads = [null];
    expect(src.poll()).toBeNull();
    expect(useGamepadState.getState().connected).toBe(false);
    // a throwing getGamepads (e.g. blocked by permissions policy) counts as no pad
    const broken = createGamepadSource(() => {
      throw new Error('blocked');
    });
    expect(broken.poll()).toBeNull();
  });
});
