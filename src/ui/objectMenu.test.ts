import { describe, expect, it } from 'vitest';
import { derivePlan } from '../model/derived';
import { createSampleProject } from '../model/sample';
import { objectMenuModel, type ObjectMenuContext } from './objectMenu';

const editing: ObjectMenuContext = { walking: false, carrying: null, count: 1 };
const ids = (m: ReturnType<typeof objectMenuModel>) => m?.actions.map((a) => a.id);

describe('object context menu (#235)', () => {
  const p = createSampleProject();
  const d = derivePlan(p);

  it('shows name, size and quick actions for furniture; only real price data', () => {
    const f = { ...p.furniture[0], price: undefined, brand: undefined, retailer: undefined, locked: false, quantity: 1 };
    const q = { ...p, furniture: [f] };
    const m = objectMenuModel(q, d, { type: 'furniture', id: f.id }, editing)!;
    expect(m.title).toBe(f.name);
    expect(m.details.some((l) => l.includes('(B × T × H)'))).toBe(true);
    expect(m.details.some((l) => l.includes('€'))).toBe(false);
    expect(ids(m)).toEqual(['rotate-left', 'rotate-right', 'duplicate', 'delete', 'properties']);

    const priced = { ...f, price: { amount: 100, currency: 'EUR' as const, status: 'estimate' as const }, quantity: 2, brand: 'Marke' };
    const m2 = objectMenuModel({ ...p, furniture: [priced] }, d, { type: 'furniture', id: f.id }, editing)!;
    expect(m2.details.find((l) => l.includes('€'))).toMatch(/200.*2 Stk\..*Schätzung/);
    expect(m2.details).toContain('Marke');
  });

  it('offers carrying while walking, dropping while carried, nothing that moves a locked item', () => {
    const f = { ...p.furniture[0], locked: false };
    const q = { ...p, furniture: [f] };
    const t = { type: 'furniture' as const, id: f.id };
    expect(ids(objectMenuModel(q, d, t, { ...editing, walking: true }))).toEqual(['duplicate', 'carry', 'delete', 'properties']);
    expect(ids(objectMenuModel(q, d, t, { ...editing, walking: true, carrying: f.id }))).toEqual(['drop', 'properties']);
    const locked = { ...p, furniture: [{ ...f, locked: true }] };
    expect(ids(objectMenuModel(locked, d, t, editing))).toEqual(['duplicate', 'delete', 'properties']);
    expect(ids(objectMenuModel(locked, d, t, { ...editing, walking: true }))).toEqual(['duplicate', 'delete', 'properties']);
  });

  it('opens and closes doors and windows, not passages', () => {
    const door = p.openings.find((o) => o.kind === 'door')!;
    const m = objectMenuModel(p, d, { type: 'opening', id: door.id }, editing)!;
    expect(m.title).toBe('Tür');
    expect(m.actions[0]).toMatchObject({ id: 'toggle-open', label: door.open ? 'Schließen' : 'Öffnen' });
    const passage = { ...door, id: 'pass', kind: 'passage' as const };
    expect(ids(objectMenuModel({ ...p, openings: [...p.openings, passage] }, d, { type: 'opening', id: 'pass' }, editing))).toEqual(['delete', 'properties']);
  });

  it('uses the same pattern for smart devices (status and switch)', () => {
    const dev = { id: 'dev1', name: 'Flurlicht', kind: 'light' as const, x: 1, y: 1, elevation: 2.4, rotation: 0 };
    const q = { ...p, devices: [dev] } as typeof p;
    const m = objectMenuModel(q, d, { type: 'device', id: 'dev1' }, { ...editing, deviceStatus: { label: 'aus', on: false } })!;
    expect(m.title).toBe('Flurlicht');
    expect(m.details).toContain('Status: aus');
    expect(m.actions[0]).toMatchObject({ id: 'toggle-device', label: 'Einschalten' });
  });

  it('returns null for an object that no longer exists', () => {
    expect(objectMenuModel(p, d, { type: 'furniture', id: 'gone' }, editing)).toBeNull();
    expect(objectMenuModel(p, d, { type: 'wall', id: 'gone' }, editing)).toBeNull();
  });

  it('describes walls and rooms with their measures', () => {
    const wall = p.walls[0];
    expect(objectMenuModel(p, d, { type: 'wall', id: wall.id }, editing)!.details[0]).toMatch(/cm lang · .* cm dick/);
    const room = p.rooms[0];
    expect(objectMenuModel(p, d, { type: 'room', id: room.id }, editing)!.details[0]).toMatch(/m²$/);
  });
});
