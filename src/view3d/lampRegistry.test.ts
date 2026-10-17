import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { flushLampShadowUpdates, LAMP_SHADOW_MIN_INTERVAL_MS, MAX_SHADOW_LAMPS, registerShadowLamp, requestLampShadowUpdate, setLampLevel } from './lampRegistry';

const light = () => new THREE.PointLight('#fff', 1, 5);

describe('lamp shadows (#130)', () => {
  it('limits shadow-casting lamps, preferring lamps over automatic room lights', () => {
    setLampLevel(1);
    const room = light();
    const offRoom = registerShadowLamp(room, 1);
    const lamps = Array.from({ length: MAX_SHADOW_LAMPS }, light);
    const offs = lamps.map((l) => registerShadowLamp(l));
    expect(lamps.every((l) => l.castShadow)).toBe(true);
    expect(room.castShadow).toBe(false);
    offs[0]();
    expect(lamps[0].castShadow).toBe(false);
    expect(room.castShadow).toBe(true);
    offs.slice(1).forEach((off) => off());
    offRoom();
  });

  it('casts shadows only while lamps are on and renders the maps only on request', () => {
    setLampLevel(1);
    const l = light();
    const off = registerShadowLamp(l);
    expect(l.castShadow).toBe(true);
    expect(l.shadow.autoUpdate).toBe(false);
    l.shadow.needsUpdate = false;
    flushLampShadowUpdates();
    expect(l.shadow.needsUpdate).toBe(false);
    requestLampShadowUpdate();
    flushLampShadowUpdates();
    expect(l.shadow.needsUpdate).toBe(true);
    l.shadow.needsUpdate = false;
    setLampLevel(0);
    expect(l.castShadow).toBe(false);
    setLampLevel(0.5);
    expect(l.castShadow).toBe(true);
    expect(l.shadow.needsUpdate).toBe(true);
    off();
    setLampLevel(1);
  });

  it('re-renders the maps at most every 250 ms while things keep changing, and always the last change (#231)', () => {
    setLampLevel(1);
    const l = light();
    const off = registerShadowLamp(l);
    const t0 = 1e7;
    requestLampShadowUpdate();
    flushLampShadowUpdates(t0);
    l.shadow.needsUpdate = false;
    // a carried item moves every frame
    for (let f = 1; f <= 10; f++) {
      requestLampShadowUpdate();
      flushLampShadowUpdates(t0 + f * 16);
    }
    expect(l.shadow.needsUpdate).toBe(false);
    flushLampShadowUpdates(t0 + LAMP_SHADOW_MIN_INTERVAL_MS);
    expect(l.shadow.needsUpdate).toBe(true);
    off();
  });
});
