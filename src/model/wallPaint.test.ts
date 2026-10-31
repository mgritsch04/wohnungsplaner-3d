import { describe, expect, it } from 'vitest';
import { ensureWallPaint } from './materials';
import { createSampleProject } from './sample';
import { applyFurnishing } from '../suggest/furnishing';

describe('Wandfarbe pro Raum (#462)', () => {
  it('nimmt vorhandene Farbe, sonst legt sie genau einmal an', () => {
    const p = createSampleProject();
    const n = p.materials.length;
    expect(ensureWallPaint(p, '#F2EFE9')).toBe('mat_wall_white');
    expect(p.materials.length).toBe(n);
    const id = ensureWallPaint(p, '#aabbcc');
    expect(ensureWallPaint(p, '#AABBCC')).toBe(id);
    expect(p.materials.filter((m) => m.id === id)).toHaveLength(1);
    expect(p.materials.find((m) => m.id === id)?.color).toBe('#aabbcc');
  });

  it('Übernehmen färbt die Wände des Raums, ein zweites Mal ändert nichts', () => {
    const p = createSampleProject();
    const roomId = p.rooms[0].id;
    const s = { rooms: [], items: [], walls: [{ roomId, color: '#9fb1c2' }, { roomId: 'gibt-es-nicht', color: '#112233' }] };
    applyFurnishing(p, s);
    expect(p.rooms[0].wallMaterialId).toBe('mat_wall_blue');
    const n = p.materials.length;
    applyFurnishing(p, s);
    expect(p.materials.length).toBe(n);
    expect(p.rooms.some((r) => r.id === 'gibt-es-nicht')).toBe(false);
  });

  it('alte Pläne ohne Wandfarbe bleiben gültig', () => {
    const p = createSampleProject();
    expect(p.rooms.every((r) => r.wallMaterialId === undefined)).toBe(true);
    applyFurnishing(p, { rooms: [], items: [] });
    expect(p.rooms.every((r) => r.wallMaterialId === undefined)).toBe(true);
  });
});
