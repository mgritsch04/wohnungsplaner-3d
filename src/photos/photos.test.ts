import { beforeEach, describe, expect, it } from 'vitest';
import { migrateProjectObject, parseProject } from '../formats/project/projectFile';
import { referencedAssetIds } from '../formats/project/packageFile';
import { derivePlan } from '../model/derived';
import { deleteWalls } from '../model/operations';
import { createSampleProject } from '../model/sample';
import { PROJECT_SCHEMA_VERSION, type Photo } from '../model/schema';
import { useProjectStore } from '../store/projectStore';
import { defaultPlacement, deletePhoto, photoHeight, photoPlacement, photosOfWall, setWallPhotosVisible, sideRoomName, updatePhoto } from './photos';

const proj = () => useProjectStore.getState().project;

function addRaw(wallId: string, over: Partial<Photo> = {}): Photo {
  const ph: Photo = { id: 'p' + proj().photos.length, wallId, side: 'left', assetId: 'photo-x', fileName: 'a.jpg', aspect: 1.5, width: 0.9, along: 0.5, bottom: 1, visible: true, opacity: 1, ...over };
  useProjectStore.getState().apply((d) => void d.photos.push(ph));
  return ph;
}

describe('Fotos an Wänden (#86)', () => {
  beforeEach(() => useProjectStore.getState().load(createSampleProject()));

  it('Startplatz: mittig, nie breiter als die Wand, Mitte auf Augenhöhe', () => {
    const p = defaultPlacement(4, 2.5, 1.5);
    expect(p.width).toBeCloseTo(0.8);
    expect(p.along).toBeCloseTo(1.6);
    expect(p.bottom).toBeCloseTo(1.5 - 0.8 / 1.5 / 2, 1);
    expect(defaultPlacement(0.5, 2.5, 1).width).toBeLessThanOrEqual(0.45);
  });

  it('ändert, blendet aus und entfernt Fotos', () => {
    const wall = proj().walls[0];
    const ph = addRaw(wall.id);
    expect(photosOfWall(proj(), wall.id)).toHaveLength(1);
    updatePhoto(ph.id, (x) => (x.opacity = 0.4));
    expect(proj().photos[0].opacity).toBe(0.4);
    setWallPhotosVisible(wall.id, false);
    expect(proj().photos[0].visible).toBe(false);
    deletePhoto(ph.id);
    expect(proj().photos).toHaveLength(0);
  });

  it('platziert das Foto auf der gewählten Wandseite, nach außen gerichtet', () => {
    const wall = proj().walls[0];
    const d = derivePlan(proj());
    const fp = d.footprints.get(wall.id)!;
    const left = photoPlacement(addRaw(wall.id, { side: 'left' }), d)!;
    const right = photoPlacement(addRaw(wall.id, { side: 'right' }), d)!;
    expect(photoHeight({ width: 0.9, aspect: 1.5 })).toBeCloseTo(0.6);
    expect(left.y).toBeCloseTo(1.3);
    // distance from the wall centre line: half the thickness plus a hair, on opposite sides
    const side = (pl: { x: number; z: number }) => (pl.x - fp.a.x) * fp.normal.x + (pl.z - fp.a.y) * fp.normal.y;
    expect(side(left)).toBeGreaterThan(fp.thickness / 2);
    expect(side(right)).toBeLessThan(-fp.thickness / 2);
    expect(Math.sin(left.rotY)).toBeCloseTo(fp.normal.x);
    expect(Math.cos(left.rotY)).toBeCloseTo(fp.normal.y);
    expect(sideRoomName(proj(), d, wall.id, 'left') !== undefined).toBe(true);
  });

  it('Wand löschen nimmt die Fotos mit; Bild gehört zum Projektpaket', () => {
    const wall = proj().walls[0];
    addRaw(wall.id);
    expect(referencedAssetIds(proj())).toContain('photo-x');
    useProjectStore.getState().apply((d) => deleteWalls(d, [wall.id]));
    expect(proj().photos).toHaveLength(0);
  });

  it('übersteht Speichern/Laden und migriert Schema 4', () => {
    addRaw(proj().walls[0].id);
    const again = parseProject(JSON.parse(JSON.stringify(proj())));
    expect(again.project.photos).toHaveLength(1);
    const v4 = { ...JSON.parse(JSON.stringify(createSampleProject())), schemaVersion: 4 };
    delete v4.photos;
    expect(migrateProjectObject(v4)).toMatchObject({ schemaVersion: PROJECT_SCHEMA_VERSION, photos: [] });
  });
});
