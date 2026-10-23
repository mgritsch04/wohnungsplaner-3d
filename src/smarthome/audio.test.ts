import { beforeEach, describe, expect, it } from 'vitest';
import { findCatalogItem } from '../catalog/generic';
import { createFurnitureFromCatalog } from '../catalog/instantiate';
import { derivePlan } from '../model/derived';
import { createEmptyProject } from '../model/factory';
import { addRectRoom } from '../model/operations';
import { ProjectSchema, type Project } from '../model/schema';
import { pointInPolygon } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { nearestEdge, parseWishes, speakerHints, suggestAudio } from './audio';
import { migrateProjectObject } from '../formats/project/projectFile';
import { addAudioDef, placeAudioDef, removeAudioDef, updateAudioDef } from './actions';
import { applySmartHomeSuggestion } from './suggestStore';

const T = 0.12;
const put = (p: Project, id: string, x: number, y: number) => p.furniture.push({ ...createFurnitureFromCatalog(findCatalogItem(id)!, { x, y }), x, y });

function flat(): Project {
  const p = createEmptyProject();
  addRectRoom(p, { x: 0, y: 0, width: 4, depth: 5, name: 'Wohnzimmer', thickness: T, height: 2.6 });
  addRectRoom(p, { x: 4 + T, y: 0, width: 3, depth: 3, name: 'Schlafzimmer', thickness: T, height: 2.6 });
  addRectRoom(p, { x: 4 + T, y: 3 + T, width: 3, depth: 2, name: 'Arbeitszimmer', thickness: T, height: 2.6 });
  put(p, 'generic-sofa-3', 2, 4);
  put(p, 'generic-tv-sideboard', 2, 0.4);
  put(p, 'generic-bed-160', 5.6, 1.5);
  put(p, 'generic-desk', 5.6, 4.4);
  return p;
}

describe('audio setup (#138)', () => {
  beforeEach(() => useProjectStore.getState().load(flat()));
  const names = (p: Project) => Object.fromEntries(p.rooms.map((r) => [r.name, r.id]));

  it('proposes generic speaker types per room, inside the room, without products or prices', () => {
    const p = useProjectStore.getState().project;
    const s = suggestAudio(p);
    const d = derivePlan(p);
    const ids = names(p);
    const of = (room: string) => s.items.filter((i) => i.roomId === ids[room]);
    expect(of('Wohnzimmer').filter((i) => i.speakerType === 'bookshelf')).toHaveLength(2);
    expect(of('Wohnzimmer').some((i) => i.speakerType === 'subwoofer')).toBe(true);
    expect(of('Schlafzimmer').map((i) => i.speakerType)).toEqual(['bluetooth']);
    expect(of('Arbeitszimmer').map((i) => i.speakerType)).toEqual(['desk', 'desk']);
    for (const i of s.items) {
      expect(i.productId).toBeUndefined();
      expect(pointInPolygon(i, d.rooms.get(i.roomId)!.interior)).toBe(true);
    }
    expect(s.cost).toEqual({ min: 0, max: 0, unknown: s.items.length });
  });

  it('wishes change the proposal; compact living room uses a soundbar and no subwoofer', () => {
    const p = useProjectStore.getState().project;
    const w = parseWishes('lieber kompakter, Design nicht gut');
    expect(w).toMatchObject({ compact: true, discreet: true });
    expect(parseWishes('ohne Subwoofer').subwoofer).toBe(false);
    const s = suggestAudio(p, [names(p).Wohnzimmer], w);
    expect(s.items.map((i) => i.speakerType)).toEqual(['soundbar']);
  });

  it('applies in one undo step, keeps the speaker type and skips rooms that already have speakers', () => {
    const st = useProjectStore.getState();
    const before = st.project.devices.length;
    const n = applySmartHomeSuggestion(suggestAudio(st.project));
    expect(useProjectStore.getState().project.devices).toHaveLength(before + n);
    expect(useProjectStore.getState().project.devices.every((d) => d.kind === 'speaker' && d.speakerType)).toBe(true);
    expect(ProjectSchema.safeParse(useProjectStore.getState().project).success).toBe(true);
    expect(suggestAudio(useProjectStore.getState().project).items).toHaveLength(0);
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().project.devices).toHaveLength(before);
  });

  it('says so when a room has no listening place instead of guessing', () => {
    const p = flat();
    p.furniture = p.furniture.filter((f) => !f.name.toLowerCase().includes('bett') && f.catalogId !== 'generic-bed-160');
    const s = suggestAudio(p, [names(p).Schlafzimmer]);
    expect(s.items).toHaveLength(0);
    expect(s.later[0].text).toMatch(/kein Bett/);
  });

  it('hints on wall distance and the stereo triangle', () => {
    const p = flat();
    const sofa = p.furniture.find((f) => f.catalogId === 'generic-sofa-3')!;
    p.devices.push({ id: 'a', name: 'A', kind: 'speaker', speakerType: 'bookshelf', x: 0.1, y: 0.5, elevation: 1, rotation: 0 });
    p.devices.push({ id: 'b', name: 'B', kind: 'speaker', speakerType: 'bookshelf', x: 3, y: 0.5, elevation: 1, rotation: 0 });
    const h = speakerHints(p, derivePlan(p), p.devices[0]);
    expect(h.some((x) => !x.ok && /Wand/.test(x.text))).toBe(true);
    expect(h.some((x) => /Stereo-Dreieck|Faustregel: etwa/.test(x.text))).toBe(true);
    expect(sofa).toBeTruthy();
    expect(nearestEdge({ x: 1, y: 1 }, [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]).distance).toBeCloseTo(1);
  });

  it('own devices (#336): create, place, hints use size and coverage angle, remove keeps the speaker', () => {
    const st = useProjectStore.getState;
    const room = st().project.rooms.find((r) => r.name === 'Wohnzimmer')!;
    const id = addAudioDef({ name: 'Mein Regalbox', speakerType: 'bookshelf', widthM: 0.2, depthM: 0.3, heightM: 0.35, coverageDeg: 60, source: 'eigene Eingabe' });
    expect(st().project.audioCatalog).toHaveLength(1);
    const dev = placeAudioDef(id, room.id)!;
    const d = st().project.devices.find((x) => x.id === dev)!;
    expect(d).toMatchObject({ kind: 'speaker', audioDefId: id, speakerType: 'bookshelf', name: 'Mein Regalbox' });
    expect(ProjectSchema.safeParse(st().project).success).toBe(true);
    // wall distance is measured from the housing (depth 0.3 → 0.15 m off the centre)
    st().apply((p) => {
      const x = p.devices.find((y) => y.id === dev)!;
      x.x = 1;
      x.y = 0.5;
      x.rotation = Math.PI; // facing away from the sofa (sofa is at y = 4)
    });
    const hints = speakerHints(st().project, derivePlan(st().project), st().project.devices.find((x) => x.id === dev)!);
    expect(hints.some((h) => !h.ok && /Abstrahlwinkels von 60°/.test(h.text))).toBe(true);
    st().apply((p) => { p.devices.find((y) => y.id === dev)!.rotation = Math.PI / 2; });
    const ok = speakerHints(st().project, derivePlan(st().project), st().project.devices.find((x) => x.id === dev)!);
    expect(ok.some((h) => h.ok && /im Abstrahlwinkel/.test(h.text))).toBe(true);
    updateAudioDef(id, { coverageDeg: undefined });
    expect(speakerHints(st().project, derivePlan(st().project), st().project.devices.find((x) => x.id === dev)!).some((h) => /Abstrahlwinkel/.test(h.text))).toBe(false);
    removeAudioDef(id);
    expect(st().project.audioCatalog).toHaveLength(0);
    expect(st().project.devices.find((x) => x.id === dev)).toMatchObject({ audioDefId: undefined, speakerType: 'bookshelf' });
    st().undo();
    expect(st().project.audioCatalog).toHaveLength(1);
  });

  it('schema 7 migration adds an empty audio catalog', () => {
    const { audioCatalog: _a, ...v6 } = { ...JSON.parse(JSON.stringify(flat())), schemaVersion: 6 };
    expect(migrateProjectObject(v6)).toMatchObject({ schemaVersion: 7, audioCatalog: [] });
  });
});
