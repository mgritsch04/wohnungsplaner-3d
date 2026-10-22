import { beforeEach, describe, expect, it } from 'vitest';
import { migrateProjectObject, parseProject, serializeProject, parseProjectJson } from '../formats/project/projectFile';
import { referencedAssetIds } from '../formats/project/packageFile';
import { buildingFurniture } from '../budget/rooms';
import { computeBudget } from '../budget/budget';
import { createSampleProject } from './sample';
import { createEmptyProject } from './factory';
import { DEFAULT_LEVEL_ID, PROJECT_SCHEMA_VERSION, type Project } from './schema';
import {
  activeLevel,
  addLevel,
  defaultLevelName,
  deleteLevel,
  furnitureOnAnyLevel,
  levelOfFurniture,
  neighbourLevel,
  normalizeLevels,
  planOfLevel,
  projectOnLevel,
  setLevelElevation,
  sortedLevels,
  storeyHeight,
  switchLevel,
} from './levels';
import { useProjectStore } from '../store/projectStore';
import { createLevel, goToLevel, goToNeighbourLevel } from '../ui/levelActions';

const proj = () => useProjectStore.getState().project;

describe('Etagen (#54): Datenmodell', () => {
  it('neue Projekte haben genau eine aktive Etage (Erdgeschoss)', () => {
    const p = createEmptyProject();
    expect(p.levels).toEqual([{ id: DEFAULT_LEVEL_ID, name: 'Erdgeschoss', elevation: 0 }]);
    expect(p.activeLevelId).toBe(DEFAULT_LEVEL_ID);
  });

  it('Schema 5 → 6: der bisherige Plan wird zur einzigen Etage', () => {
    const { levels: _l, activeLevelId: _a, ...v5 } = { ...JSON.parse(JSON.stringify(createSampleProject())), schemaVersion: 5 };
    const m = migrateProjectObject(v5);
    expect(m).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, activeLevelId: DEFAULT_LEVEL_ID, levels: [{ id: DEFAULT_LEVEL_ID, name: 'Erdgeschoss', elevation: 0 }] });
    const { project } = parseProject(v5);
    expect(project.walls.length).toBeGreaterThan(0);
    expect(project.levels).toHaveLength(1);
  });

  it('Etage darüber: Höhe aus den Wänden, Name nach Lage; leer oder mit übernommenem Umriss', () => {
    const p = createSampleProject();
    const empty = addLevel(p);
    const up = p.levels.find((l) => l.id === empty)!;
    expect(up.elevation).toBeCloseTo(2.6);
    expect(up.name).toBe('1. Obergeschoss');
    expect(up.plan?.walls).toEqual([]);
    const copied = addLevel(p, { copyWalls: true, name: 'Dach' });
    const plan = planOfLevel(p, copied);
    expect(p.levels.find((l) => l.id === copied)!.elevation).toBeCloseTo(5.2);
    expect(plan.walls).toHaveLength(p.walls.length);
    expect(plan.rooms.map((r) => r.name)).toEqual(p.rooms.map((r) => r.name));
    expect(plan.openings.every((o) => o.kind === 'window')).toBe(true);
    expect(plan.openings).toHaveLength(p.openings.filter((o) => o.kind === 'window').length);
    expect(plan.furniture).toEqual([]);
    // new ids everywhere, references inside the copy stay consistent
    const oldIds = new Set([...p.nodes, ...p.walls, ...p.rooms, ...p.openings].map((x) => x.id));
    expect([...plan.nodes, ...plan.walls, ...plan.rooms, ...plan.openings].some((x) => oldIds.has(x.id))).toBe(false);
    const nodeIds = new Set(plan.nodes.map((n) => n.id));
    expect(plan.walls.every((w) => nodeIds.has(w.a) && nodeIds.has(w.b))).toBe(true);
    expect(plan.openings.every((o) => plan.walls.some((w) => w.id === o.wallId))).toBe(true);
    const below = addLevel(p, { where: 'below' });
    expect(p.levels.find((l) => l.id === below)).toMatchObject({ name: 'Keller', elevation: -2.8 });
    expect(sortedLevels(p).map((l) => l.name)).toEqual(['Keller', 'Erdgeschoss', '1. Obergeschoss', 'Dach']);
    expect(defaultLevelName(-2)).toBe('2. Untergeschoss');
  });

  it('Wechseln tauscht die Pläne, hin und zurück ohne Verlust', () => {
    const p = createSampleProject();
    const before = JSON.parse(JSON.stringify(p)) as Project;
    const up = addLevel(p, { copyWalls: true });
    expect(switchLevel(p, up)).toBe(true);
    expect(p.activeLevelId).toBe(up);
    expect(activeLevel(p).plan).toBeUndefined();
    expect(p.furniture).toEqual([]);
    expect(p.levels.find((l) => l.id === DEFAULT_LEVEL_ID)!.plan!.furniture).toEqual(before.furniture);
    p.furniture.push({ ...before.furniture[0], id: 'oben_1' });
    expect(neighbourLevel(p, -1)?.id).toBe(DEFAULT_LEVEL_ID);
    switchLevel(p, DEFAULT_LEVEL_ID);
    expect(p.walls).toEqual(before.walls);
    expect(p.furniture).toEqual(before.furniture);
    expect(planOfLevel(p, up).furniture.map((f) => f.id)).toEqual(['oben_1']);
    expect(levelOfFurniture(p, 'oben_1')).toBe(up);
    expect(furnitureOnAnyLevel(p, 'oben_1')?.id).toBe('oben_1');
    expect(projectOnLevel(p, up).furniture.map((f) => f.id)).toEqual(['oben_1']);
    expect(switchLevel(p, DEFAULT_LEVEL_ID)).toBe(false);
    expect(switchLevel(p, 'gibt-es-nicht')).toBe(false);
  });

  it('Geschosshöhe und Fußbodenhöhe; Liste bleibt sortiert', () => {
    const p = createSampleProject();
    const up = addLevel(p);
    expect(storeyHeight(p, DEFAULT_LEVEL_ID)).toBeCloseTo(2.6);
    setLevelElevation(p, up, 3.05);
    expect(storeyHeight(p, DEFAULT_LEVEL_ID)).toBeCloseTo(3.05);
    setLevelElevation(p, up, -3);
    expect(sortedLevels(p)[0].id).toBe(up);
    expect(p.levels[0].id).toBe(up);
  });

  it('Entfernen: nie die letzte Etage; die aktive wechselt vorher zur Nachbaretage', () => {
    const p = createSampleProject();
    expect(deleteLevel(p, DEFAULT_LEVEL_ID)).toBe(false);
    const up = addLevel(p);
    switchLevel(p, up);
    expect(deleteLevel(p, up)).toBe(true);
    expect(p.activeLevelId).toBe(DEFAULT_LEVEL_ID);
    expect(p.levels).toHaveLength(1);
    expect(p.walls.length).toBeGreaterThan(0);
  });

  it('Laden repariert eine unbekannte aktive Etage und prüft jede Etage', () => {
    const p = createSampleProject();
    const up = addLevel(p, { copyWalls: true, name: 'OG' });
    const raw = JSON.parse(serializeProject(p));
    const res = parseProjectJson(serializeProject(p));
    expect(res.project.levels.find((l) => l.id === up)?.plan?.walls).toHaveLength(p.walls.length);
    raw.activeLevelId = 'weg';
    const fixed = parseProject(raw);
    expect(fixed.project.activeLevelId).toBe(DEFAULT_LEVEL_ID);
    expect(fixed.repaired?.join(' ')).toMatch(/Aktive Etage/);
    // a broken reference on another storey is found, too
    const broken = JSON.parse(serializeProject(p));
    broken.levels.find((l: { id: string }) => l.id === up).plan.walls[0].a = 'fehlt';
    expect(() => parseProject(broken)).toThrow(/inkonsistente/);
    const q = createSampleProject();
    expect(normalizeLevels(q)).toEqual([]);
  });

  it('Bilder und Modelle aller Etagen gehören zum Projekt (Paket, Aufräumen)', () => {
    const p = createSampleProject();
    const up = addLevel(p);
    const plan = p.levels.find((l) => l.id === up)!.plan!;
    plan.photos.push({ id: 'ph', wallId: 'w', side: 'left', assetId: 'photo-oben', fileName: '', aspect: 1, width: 1, along: 0, bottom: 1, visible: true, opacity: 1 });
    expect(referencedAssetIds(p)).toContain('photo-oben');
  });

  it('Budget und Einkaufsliste zählen alle Etagen, Räume mit Etagenname', () => {
    const p = createSampleProject();
    const up = addLevel(p, { copyWalls: true, name: 'OG' });
    const item = { ...p.furniture[0], id: 'oben_sofa', price: { amount: 100, currency: 'EUR' as const, status: 'user' as const } };
    p.levels.find((l) => l.id === up)!.plan!.furniture.push(item);
    const all = buildingFurniture(p);
    expect(all.furniture).toHaveLength(p.furniture.length + 1);
    const b = computeBudget(all.furniture, all.roomOf);
    expect(b.lines.find((l) => l.id === 'oben_sofa')?.room).toMatch(/^OG · /);
    expect(b.lines.find((l) => l.id === p.furniture[0].id)?.room).toMatch(/^Erdgeschoss · /);
  });
});

describe('Etagen (#54): Bedienung', () => {
  beforeEach(() => useProjectStore.getState().load(createSampleProject()));

  it('Anlegen ist ein Rückgängig-Schritt, Wechseln keiner', () => {
    const id = createLevel({ copyWalls: true })!;
    expect(proj().activeLevelId).toBe(id);
    expect(proj().furniture).toEqual([]);
    expect(goToNeighbourLevel(-1)).toBe(true);
    expect(proj().activeLevelId).toBe(DEFAULT_LEVEL_ID);
    expect(goToNeighbourLevel(-1)).toBe(false);
    expect(goToLevel(id)).toBe(true);
    // undo takes back the creation (and shows the storey that was active then)
    useProjectStore.getState().undo();
    expect(proj().levels).toHaveLength(1);
    expect(proj().activeLevelId).toBe(DEFAULT_LEVEL_ID);
    expect(proj().furniture.length).toBeGreaterThan(0);
  });

  it('Rückgängig nach einer Änderung auf einer anderen Etage zeigt diese Etage wieder', () => {
    const up = createLevel()!;
    goToLevel(DEFAULT_LEVEL_ID);
    const n = proj().furniture.length;
    useProjectStore.getState().apply((d) => void d.furniture.pop());
    goToLevel(up);
    useProjectStore.getState().undo();
    expect(proj().activeLevelId).toBe(DEFAULT_LEVEL_ID);
    expect(proj().furniture).toHaveLength(n);
  });
});
