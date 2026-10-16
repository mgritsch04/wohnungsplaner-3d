import { describe, expect, it } from 'vitest';
import { applyDraft } from '../formats/floorplan/convert';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import type { Underlay } from '../model/schema';
import { offsetPolygon, pointInPolygon, polygonArea, type Vec2 } from '../model/vec';
import type { DraftWall, ReconstructionDraft } from './draft';
import { detectRasterWalls } from './recognition/raster';
import { outputToDraft } from './recognition/runRecognition';
import { renderSyntheticPlan } from './recognition/syntheticPlans';
import { interiorPoint, parseAreaText, proposeRooms, refreshRoomProposals, roomsInsideExistingRooms } from './rooms';

const c30 = Math.cos(Math.PI / 6);
const s30 = Math.sin(Math.PI / 6);
/** Two rooms: a 2 × 4 m room on the left, and a room with a 30° wall on the right (centerlines, metres). */
const P = { tl: { x: 1, y: 1 }, tm: { x: 3, y: 1 }, corner: { x: 5, y: 1 }, slopeEnd: { x: 5 + 3 * c30, y: 1 + 3 * s30 }, br: { x: 5 + 3 * c30, y: 5 }, bm: { x: 3, y: 5 }, bl: { x: 1, y: 5 } };
const wall = (a: Vec2, b: Vec2, thickness = 0.2): DraftWall => ({ id: `w${a.x},${a.y}-${b.x},${b.y}`, a, b, thickness, height: 2.5, status: 'estimated', accepted: true });
const twoRooms = [wall(P.tl, P.corner), wall(P.corner, P.slopeEnd), wall(P.slopeEnd, P.br), wall(P.br, P.bl), wall(P.bl, P.tl), wall(P.tm, P.bm)];
const rightCenterline = [P.tm, P.corner, P.slopeEnd, P.br, P.bm];
const rightArea = polygonArea(offsetPolygon(rightCenterline, -0.1));

describe('room proposals', () => {
  it('proposes one room per closed area with net floor area and an inner label point', () => {
    const rooms = proposeRooms(twoRooms);
    expect(rooms).toHaveLength(2);
    const [left, right] = [...rooms].sort((a, b) => a.labelPoint.x - b.labelPoint.x);
    expect(left.area).toBeCloseTo(1.8 * 3.8, 2);
    expect(right.area).toBeCloseTo(rightArea, 1);
    expect(pointInPolygon(left.labelPoint, [P.tl, P.tm, P.bm, P.bl])).toBe(true);
    expect(pointInPolygon(right.labelPoint, rightCenterline)).toBe(true);
    for (const r of rooms) {
      expect(r.status).toBe('estimated');
      expect(r.accepted).toBe(true);
      expect(r.statedArea).toBeUndefined();
    }
    expect(rooms.map((r) => r.name).sort()).toEqual(['Raum 1', 'Raum 2']);
  });

  it('takes names and stated areas only from texts of the plan inside the room', () => {
    const rooms = proposeRooms(twoRooms, {
      texts: [
        { str: 'Wohnen', x: 5.5, y: 3 },
        { str: '18,40 m²', x: 5.5, y: 3.4 },
        { str: 'Parkett', x: 5.5, y: 3.8 }, // floor finish, not a room name
        { str: 'Bad', x: 9, y: 9 }, // outside of all rooms
        { str: '3,50', x: 2, y: 3 }, // a dimension, not a name
      ],
    });
    const [left, right] = [...rooms].sort((a, b) => a.labelPoint.x - b.labelPoint.x);
    expect(right.name).toBe('Wohnen');
    expect(right.statedArea).toBe(18.4);
    expect(left.name).toMatch(/^Raum \d$/);
    expect(left.statedArea).toBeUndefined();
  });

  it('marks very small areas as uncertain, ignores tiny ones and open wall chains', () => {
    // a 1.2 × 1.2 m shaft (net 1 m²) and a 0.4 × 0.4 m gap between walls
    const shaft = [wall({ x: 0, y: 0 }, { x: 1.2, y: 0 }), wall({ x: 1.2, y: 0 }, { x: 1.2, y: 1.2 }), wall({ x: 1.2, y: 1.2 }, { x: 0, y: 1.2 }), wall({ x: 0, y: 1.2 }, { x: 0, y: 0 })];
    const tiny = [wall({ x: 5, y: 0 }, { x: 5.6, y: 0 }), wall({ x: 5.6, y: 0 }, { x: 5.6, y: 0.6 }), wall({ x: 5.6, y: 0.6 }, { x: 5, y: 0.6 }), wall({ x: 5, y: 0.6 }, { x: 5, y: 0 })];
    const open = [wall({ x: 10, y: 0 }, { x: 14, y: 0 }), wall({ x: 14, y: 0 }, { x: 14, y: 3 }), wall({ x: 14, y: 3 }, { x: 10, y: 3 })];
    const rooms = proposeRooms([...shaft, ...tiny, ...open]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(1, 2);
    expect(rooms[0].status).toBe('uncertain');
    expect(rooms[0].accepted).toBe(false);
  });

  it('ignores walls that are not accepted in the review', () => {
    expect(proposeRooms(twoRooms.map((w) => (w.id === twoRooms[5].id ? { ...w, accepted: false } : w)))).toHaveLength(1);
  });

  it('re-proposes rooms after walls change in the review and keeps what the user set', () => {
    const base: ReconstructionDraft = { source: 'raster', sourceName: 'x', scaleConfirmed: true, walls: twoRooms, openings: [], rooms: [], furniture: [], warnings: [], mode: 'replace' };
    const left = <T extends { labelPoint: Vec2 }>(rooms: T[]) => rooms.find((r) => r.labelPoint.x < 3)!;
    const initial = proposeRooms(twoRooms).map((r) => (r.labelPoint.x < 3 ? { ...r, name: 'Küche', status: 'confirmed' as const } : r));
    // the right room loses a wall: only the kitchen is left, unchanged
    const rightWallOff = twoRooms.map((w) => (w.id === twoRooms[2].id ? { ...w, accepted: false } : w));
    const one = refreshRoomProposals({ ...base, walls: rightWallOff, rooms: initial });
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: left(initial).id, name: 'Küche', status: 'confirmed' });
    // and back: the new area gets a free generic name
    const two = refreshRoomProposals({ ...base, rooms: one });
    expect(two).toHaveLength(2);
    expect(left(two).name).toBe('Küche');
    expect(two.find((r) => r.labelPoint.x > 3)!.name).toMatch(/^Raum \d$/);
    // generic names never repeat
    const onlyRight = proposeRooms(twoRooms.map((w) => (w.id === twoRooms[4].id ? { ...w, accepted: false } : w)));
    expect(onlyRight.map((r) => r.name)).toEqual(['Raum 1']);
    const both = refreshRoomProposals({ ...base, rooms: onlyRight });
    expect(both.map((r) => r.name).sort()).toEqual(['Raum 1', 'Raum 2']);
    expect(both.find((r) => r.labelPoint.x > 3)!.name).toBe('Raum 1');
  });

  it('finds a label point inside an L-shaped room', () => {
    const L = [{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 6 }, { x: 0, y: 6 }];
    const p = interiorPoint(L);
    expect(pointInPolygon(p, L)).toBe(true);
  });

  it('parses stated areas', () => {
    expect(parseAreaText('12,34 m²')).toBe(12.34);
    expect(parseAreaText('Fläche: 8.5 m2')).toBe(8.5);
    expect(parseAreaText('3,50')).toBeNull();
  });

  it('does not let proposals rename existing rooms when merging', () => {
    const project = createEmptyProject();
    addRectRoom(project, { x: 0, y: 0, width: 4, depth: 3, name: 'Küche', thickness: 0.2, height: 2.5 });
    const draft: ReconstructionDraft = {
      source: 'raster',
      sourceName: 'x',
      scaleConfirmed: true,
      walls: [],
      openings: [],
      rooms: [
        { id: 'in', name: 'Raum 1', labelPoint: { x: 2, y: 1.5 }, status: 'estimated', accepted: true },
        { id: 'out', name: 'Raum 2', labelPoint: { x: 9, y: 1.5 }, status: 'estimated', accepted: true },
      ],
      furniture: [],
      warnings: [],
      mode: 'merge',
    };
    expect(roomsInsideExistingRooms(draft, project)).toEqual(['in']);
    expect(roomsInsideExistingRooms({ ...draft, mode: 'replace' }, project)).toEqual([]);
  });
});

describe('recognition → review → plan (synthetic image)', () => {
  it('turns a plan with a 30° wall into walls and two rooms with the expected areas', () => {
    const img = renderSyntheticPlan({
      width: 900,
      height: 600,
      pxPerM: 100,
      thickness: 0.2,
      outline: [P.tl, P.corner, P.slopeEnd, P.br, P.bl],
      walls: [[P.tm, P.bm]],
      gaps: [[{ x: 3, y: 3 }, { x: 3, y: 3.9 }]],
    });
    const out = detectRasterWalls(img);
    const underlay: Underlay = {
      imageAssetId: 'img',
      fileName: 'test.png',
      sourceKind: 'png',
      pixelWidth: 900,
      pixelHeight: 600,
      metersPerPixel: 0.01,
      calibrated: true,
      scaleSource: 'reference',
      checks: [],
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 0.5,
      visible: true,
      locked: false,
    };
    const draft = outputToDraft(out, underlay, 'raster', 'Bildanalyse');
    draft.mode = 'replace';
    draft.rooms = proposeRooms(draft.walls);
    expect(draft.rooms).toHaveLength(2);
    const project = createEmptyProject();
    const result = applyDraft(project, draft);
    expect(result.warnings).toEqual([]);
    expect(result.roomsAdded).toBe(2);
    expect(result.openingsAdded).toBe(1);
    const areas = [...derivePlan(project).rooms.values()].map((g) => g.area).sort((a, b) => a - b);
    // detected geometry is accurate to about a pixel (1 cm)
    expect(areas[0]).toBeCloseTo(1.8 * 3.8, 1);
    expect(Math.abs(areas[1] - rightArea) / rightArea).toBeLessThan(0.02);
  });
});
