import { describe, expect, it } from 'vitest';
import { calibrateUnderlay, calibrationDeviation, imageToWorld, worldToImage } from './underlayTransform';
import { sniffPlanFile, validatePlanFile, PlanFileError } from './fileValidation';
import { findDraftConflicts } from './review';
import type { ReconstructionDraft } from './draft';

describe('underlay transform & calibration', () => {
  const u = { x: 2, y: 3, rotation: 0.3, metersPerPixel: 0.02 };
  it('maps image pixels to plan meters and back', () => {
    const p = { x: 120, y: 45 };
    const w = imageToWorld(u, p);
    const back = worldToImage(u, w);
    expect(back.x).toBeCloseTo(120, 9);
    expect(back.y).toBeCloseTo(45, 9);
  });
  it('calibrates from two points and keeps the first point fixed', () => {
    const p1 = { x: 100, y: 100 };
    const p2 = { x: 400, y: 100 };
    const anchor = imageToWorld(u, p1);
    const c = calibrateUnderlay(u, p1, p2, 6);
    expect(c.metersPerPixel).toBeCloseTo(0.02, 9);
    const c2 = calibrateUnderlay(u, p1, p2, 3);
    expect(c2.metersPerPixel).toBeCloseTo(0.01, 9);
    const a2 = imageToWorld(c2, p1);
    expect(a2.x).toBeCloseTo(anchor.x, 9);
    expect(a2.y).toBeCloseTo(anchor.y, 9);
    expect(() => calibrateUnderlay(u, p1, p1, 3)).toThrow();
  });
  it('computes the deviation of a check measurement', () => {
    expect(calibrationDeviation({ ...u, metersPerPixel: 0.01 }, { x: 0, y: 0 }, { x: 300, y: 0 }, 3)).toBeCloseTo(0, 9);
    expect(calibrationDeviation({ ...u, metersPerPixel: 0.01 }, { x: 0, y: 0 }, { x: 309, y: 0 }, 3)).toBeCloseTo(0.03, 9);
  });
});

describe('plan file validation', () => {
  const pdf = new Blob([new TextEncoder().encode('%PDF-1.7\n...')]);
  const png = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]);
  const jpg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])]);
  it('detects file types from magic bytes', async () => {
    expect(await sniffPlanFile(pdf)).toBe('pdf');
    expect(await sniffPlanFile(png)).toBe('png');
    expect(await sniffPlanFile(jpg)).toBe('jpeg');
    expect(await sniffPlanFile(new Blob(['GIF89a']))).toBeNull();
  });
  it('rejects empty, unsupported and disguised files', async () => {
    await expect(validatePlanFile(new File([], 'leer.pdf'))).rejects.toThrow(PlanFileError);
    await expect(validatePlanFile(new File(['hello'], 'plan.pdf'))).rejects.toThrow(/Nicht unterstütztes/);
    expect(await validatePlanFile(new File([png], 'actually.jpg'))).toBe('png');
  });
});

describe('review conflicts', () => {
  const base: ReconstructionDraft = { source: 'json', sourceName: 'x', scaleConfirmed: true, walls: [], openings: [], rooms: [], furniture: [], warnings: [], mode: 'replace' };
  it('flags overlapping collinear walls and openings off any wall', () => {
    const d: ReconstructionDraft = {
      ...base,
      walls: [
        { id: 'a', a: { x: 0, y: 0 }, b: { x: 4, y: 0 }, thickness: 0.2, height: 2.5, status: 'confirmed', accepted: true },
        { id: 'b', a: { x: 3, y: 0.02 }, b: { x: 6, y: 0.02 }, thickness: 0.2, height: 2.5, status: 'confirmed', accepted: true },
        { id: 'c', a: { x: 0, y: 3 }, b: { x: 4, y: 3 }, thickness: 0.2, height: 2.5, status: 'confirmed', accepted: true },
      ],
      openings: [{ id: 'o', kind: 'door', center: { x: 2, y: 1.5 }, width: 0.9, height: 2.1, sillHeight: 0, status: 'uncertain', accepted: true }],
    };
    const c = findDraftConflicts(d);
    expect(c.some((x) => x.ids.includes('a') && x.ids.includes('b'))).toBe(true);
    expect(c.some((x) => x.ids.includes('o'))).toBe(true);
    expect(c.some((x) => x.ids.includes('c') && x.ids.length === 2)).toBe(false);
  });

  it('a wall running on through a thick shaft block in line with it is no conflict (#37)', () => {
    const w = (id: string, ax: number, ay: number, bx: number, by: number, thickness: number) =>
      ({ id, a: { x: ax, y: ay }, b: { x: bx, y: by }, thickness, height: 2.5, status: 'estimated', accepted: true }) as const;
    // 10 cm wall, 45 cm block offset to one side but still holding the wall inside
    const inside = findDraftConflicts({ ...base, walls: [w('wall', 0, 0, 0, 4, 0.1), w('block', 0.15, 0, 0.15, 0.8, 0.45)] });
    expect(inside).toEqual([]);
    // a wall sticking out of the block's side still overlaps it
    const out = findDraftConflicts({ ...base, walls: [w('wall', 0, 0, 0, 4, 0.2), w('block', 0.2, 0, 0.2, 0.8, 0.45)] });
    expect(out).toHaveLength(1);
  });
});
