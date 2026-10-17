import { create } from 'zustand';

/**
 * Gamepad input for the walkthrough (#29). Pure helpers (dead zone, response curve, mapping
 * of a "standard" gamepad to walk input) plus a small polling source. Browsers only report
 * gamepad state on request, so WalkControls polls once per frame.
 *
 * Standard mapping (Xbox/PlayStation): left stick = walk, right stick = look,
 * A/✕ = select/drop, X/□ = open/close door or window, Y/△ = carry, B/○ = crouch,
 * LB/L1 = sit/stand, RT/R2 or left stick click = faster.
 */

/** Radial dead zone (share of full deflection) – hides the drift of worn sticks. */
export const DEAD_ZONE = 0.15;
/** Exponent of the response curve: small deflections turn slowly for fine aiming. */
export const LOOK_EXPONENT = 2;
/** Look speed at full deflection (radians per second). */
export const LOOK_RATE = 2.4;

export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, LS: 10 } as const;

export interface Stick {
  x: number;
  y: number;
}

/**
 * Radial dead zone with rescaling: inside `dz` → 0, beyond it the magnitude grows again
 * from 0 to 1, so there is no jump at the edge. Magnitude is clamped to 1 (diagonals of
 * square-gated sticks would otherwise walk faster).
 */
export function applyDeadZone(x: number, y: number, dz = DEAD_ZONE): Stick {
  const m = Math.hypot(x, y);
  if (!(m > dz)) return { x: 0, y: 0 };
  const scaled = Math.min(1, (m - dz) / (1 - dz));
  return { x: (x / m) * scaled, y: (y / m) * scaled };
}

/** Response curve on the magnitude, direction unchanged. */
export function applyCurve(s: Stick, exponent = LOOK_EXPONENT): Stick {
  const m = Math.hypot(s.x, s.y);
  if (m === 0) return { x: 0, y: 0 };
  const k = Math.pow(m, exponent) / m;
  return { x: s.x * k, y: s.y * k };
}

/** Minimal shape of a browser Gamepad that the mapping needs (tests pass plain objects). */
export interface PadLike {
  connected: boolean;
  mapping?: string;
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value?: number }[];
}

export interface PadInput {
  /** walk: x = right, z = forward, magnitude ≤ 1 */
  move: { x: number; z: number };
  /** look rate (−1…1, curved): x = turn right, y = look down */
  look: Stick;
  run: boolean;
  /** buttons currently held, by index */
  held: boolean[];
}

const isPressed = (pad: PadLike, i: number) => {
  const b = pad.buttons[i];
  return !!b && (b.pressed || (b.value ?? 0) > 0.5);
};

/** Maps one gamepad's state to walk input (stick y axes point down, so forward = −y). */
export function readPad(pad: PadLike): PadInput {
  const a = pad.axes;
  const left = applyDeadZone(a[0] ?? 0, a[1] ?? 0);
  const right = applyCurve(applyDeadZone(a[2] ?? 0, a[3] ?? 0));
  return {
    move: { x: left.x, z: -left.y },
    look: right,
    run: isPressed(pad, BUTTON.RT) || isPressed(pad, BUTTON.LS),
    held: pad.buttons.map((_, i) => isPressed(pad, i)),
  };
}

/** First connected pad – a pad with "standard" mapping wins over others. */
export function pickPad(pads: readonly (PadLike | null | undefined)[]): PadLike | null {
  let other: PadLike | null = null;
  for (const p of pads) {
    if (!p || !p.connected) continue;
    if (p.mapping === 'standard') return p;
    other ??= p;
  }
  return other;
}

/** Whether a gamepad is connected (for the hint over the 3D view). */
export const useGamepadState = create<{ connected: boolean; setConnected: (c: boolean) => void }>((set, get) => ({
  connected: false,
  setConnected: (c) => {
    if (get().connected !== c) set({ connected: c });
  },
}));

export interface GamepadFrame extends PadInput {
  /** buttons that went down since the previous poll */
  pressed: Set<number>;
}

/**
 * Polling source: `poll()` returns the current input with edge-detected button presses,
 * or null without a pad. A disconnected pad yields null at once, so movement stops.
 * Buttons already held when a pad appears do not count as presses.
 */
export function createGamepadSource(getPads: () => readonly (PadLike | null | undefined)[] = defaultPads) {
  let prev: boolean[] | null = null;
  return {
    poll(): GamepadFrame | null {
      let pad: PadLike | null;
      try {
        pad = pickPad(getPads());
      } catch {
        pad = null;
      }
      useGamepadState.getState().setConnected(!!pad);
      if (!pad) {
        prev = null;
        return null;
      }
      const input = readPad(pad);
      const pressed = new Set<number>();
      if (prev) input.held.forEach((h, i) => h && !prev![i] && pressed.add(i));
      prev = input.held;
      return { ...input, pressed };
    },
    /** forget held buttons (e.g. when the walkthrough ends) */
    reset() {
      prev = null;
      useGamepadState.getState().setConnected(false);
    },
  };
}

function defaultPads(): readonly (PadLike | null)[] {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  return navigator.getGamepads();
}
