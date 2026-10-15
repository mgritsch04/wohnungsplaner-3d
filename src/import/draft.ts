import type { Furniture, OpeningKind } from '../model/schema';
import type { Vec2 } from '../model/vec';

export type DraftStatus = 'confirmed' | 'estimated' | 'uncertain';

/**
 * A reconstruction draft: geometry proposed by an importer (JSON file,
 * raster/vector recognizer) that the user reviews before it becomes part of
 * the project. All coordinates are plan meters.
 */
export interface DraftWall {
  id: string;
  a: Vec2;
  b: Vec2;
  thickness: number;
  height: number;
  status: DraftStatus;
  confidence?: number;
  note?: string;
  accepted: boolean;
}

export interface DraftOpening {
  id: string;
  kind: OpeningKind;
  /** Draft wall this opening belongs to, if known. */
  wallId?: string;
  center: Vec2;
  width: number;
  height: number;
  sillHeight: number;
  /** World direction (along the wall) from the opening center towards the hinge, if known. */
  hingeSide?: Vec2;
  /** World direction (across the wall) towards which the door leaf swings, if known. */
  swingSide?: Vec2;
  status: DraftStatus;
  confidence?: number;
  note?: string;
  accepted: boolean;
}

export interface DraftRoom {
  id: string;
  name: string;
  labelPoint: Vec2;
  statedArea?: number;
  floorMaterialId?: string;
  status: DraftStatus;
  accepted: boolean;
}

export interface ReconstructionDraft {
  source: 'json' | 'raster' | 'pdf-vector';
  sourceName: string;
  /** Whether the scale of the draft is confirmed (JSON with real units, or calibrated underlay). */
  scaleConfirmed: boolean;
  walls: DraftWall[];
  openings: DraftOpening[];
  rooms: DraftRoom[];
  furniture: Furniture[];
  warnings: string[];
  /** Optional project name proposed by the source. */
  name?: string;
  /** How the draft should be applied: replace the current architecture or add to it. */
  mode: 'replace' | 'merge';
}
