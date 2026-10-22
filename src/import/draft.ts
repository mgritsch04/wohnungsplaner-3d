import type { FixtureKind, Furniture, OpeningKind } from '../model/schema';
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
  /** Area stated by the source (e.g. "12,34 m²" in the plan) – compared after applying. */
  statedArea?: number;
  /** Net floor area computed from the proposed walls (m²), for display in the review. */
  area?: number;
  floorMaterialId?: string;
  status: DraftStatus;
  accepted: boolean;
}

/** Sanitary object (tub, basin, WC) recognised from its symbol in the plan; becomes existing furniture (#255). */
export interface DraftFixture {
  id: string;
  /** Generic catalog object it is placed as. */
  catalogId: string;
  name: string;
  center: Vec2;
  /** Plan rotation in radians, see `Furniture.rotation`. */
  rotation: number;
  width: number;
  depth: number;
  status: DraftStatus;
  confidence?: number;
  note?: string;
  accepted: boolean;
}

/** Installation point (socket, switch, radiator, water / waste-water) read from its plan symbol (#222); becomes a `Fixture` on the nearest wall. */
export interface DraftInstallation {
  id: string;
  kind: FixtureKind;
  /** Where the symbol stands in the plan; the point is snapped to the nearest wall when applied. */
  center: Vec2;
  /** Height of the centre (radiator: lower edge) above the floor – guide value, the plan rarely states it. */
  elevation: number;
  /** Radiator length (m). */
  width?: number;
  /** Note kept on the installed point (e.g. LAN / Daten), not the review note. */
  fixtureNote?: string;
  status: DraftStatus;
  confidence?: number;
  note?: string;
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
  /** Fitted sanitary objects found in the plan (#255); absent = none. */
  fixtures?: DraftFixture[];
  /** Installation points found in the plan (#222); absent = none. */
  installations?: DraftInstallation[];
  warnings: string[];
  /** Optional project name proposed by the source. */
  name?: string;
  /** How the draft should be applied: replace the current architecture or add to it. */
  mode: 'replace' | 'merge';
}
