import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyProject } from '../model/factory';
import { useProjectStore } from '../store/projectStore';
import { deleteDevice, makeLightSmart, unlinkedLights } from './actions';

describe('make an existing light smart (#250)', () => {
  beforeEach(() => {
    const p = createEmptyProject();
    p.lights.push({ id: 'l1', name: 'Stehlampe', x: 1.5, y: 2, elevation: 1.6, temperature: 1800, intensity: 2, on: true });
    useProjectStore.getState().load(p);
  });

  it('links the lamp without adding a second light and takes the product colour range', () => {
    const id = makeLightSmart('l1', 'ikea-kajplats-1055')!;
    const p = useProjectStore.getState().project;
    expect(p.lights).toHaveLength(1);
    expect(p.devices).toHaveLength(1);
    expect(p.devices[0]).toMatchObject({ id, kind: 'light', lightId: 'l1', x: 1.5, y: 2, elevation: 1.6 });
    expect(p.lights[0]).toMatchObject({ temperature: 2200, intensity: 2 });
    expect(unlinkedLights(p)).toHaveLength(0);
  });

  it('is idempotent and keeps the lamp when the device is deleted', () => {
    const id = makeLightSmart('l1')!;
    expect(makeLightSmart('l1')).toBe(id);
    expect(useProjectStore.getState().project.lights[0].temperature).toBe(1800);
    deleteDevice(id);
    const p = useProjectStore.getState().project;
    expect(p.devices).toHaveLength(0);
    expect(p.lights).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.devices).toHaveLength(1);
    expect(makeLightSmart('missing')).toBeNull();
  });
});
