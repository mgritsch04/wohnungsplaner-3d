import { describe, expect, it } from 'vitest';
import { findCatalogItem } from '../../catalog/generic';
import { TEST_FLATS, type FlatKey } from './flats';
import { RECORDED } from './recorded';

describe.each(Object.keys(RECORDED) as FlatKey[])('recorded answers for flat %s', (key) => {
  const run = RECORDED[key]!;
  const rooms = Object.keys(TEST_FLATS[key].rooms);

  it('name only rooms of the flat and only catalogue items that exist', () => {
    expect(Object.keys(run.programs).every((r) => rooms.includes(r))).toBe(true);
    expect(run.concept.rooms.map((r) => r.room).sort()).toEqual([...rooms].sort());
    for (const [room, prog] of Object.entries(run.programs)) {
      for (const it of prog.items) expect(findCatalogItem(it.catalogId), `${room}: ${it.catalogId}`).toBeTruthy();
      for (const m of [prog.kitchen ?? []].flat().flatMap((k) => k.modules)) expect(findCatalogItem(m), `${room}: ${m}`).toBeTruthy();
    }
  });

  it('give every function of the concept to a room of the flat', () => {
    expect(run.concept.functions.length).toBeGreaterThan(5);
    expect(run.concept.functions.every((f) => rooms.includes(f.room))).toBe(true);
  });
});
