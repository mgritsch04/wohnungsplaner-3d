/**
 * Shared types of the new furnishing pipeline (mgritsch04/wohnungsplaner-3d#436). Each stage
 * reads and writes only these types, so the stages can be built and tested on their own:
 *
 *   0 analysis/  read the room          → RoomAnalysis, FlatAnalysis
 *   1 concept/   flat concept (Claude)  → FlatConcept
 *   2 concept/   room programme (Claude)→ RoomProgram
 *   3 solver/    place the furniture    → Layout
 *   4 review/    walk-through checks    → RoomReview, Review
 *   5 critique (Claude) changes the RoomProgram → back to 3
 *   6 real products, then 3 and 4 again
 *
 * Units and coordinates: everything here is in plan coordinates in metres, like the model
 * (x to the east, y to the south: north is at the top of the 2D plan). Only the text Claude
 * reads and the JSON Claude answers with use room coordinates in cm (see coords.ts).
 * Rotations follow `Furniture.rotation` (radians; the local front is +y, see `rotationFacing`).
 */
import type { FixtureKind } from '../model/schema';
import type { Vec2 } from '../model/vec';
import type { RoomType } from '../suggest/furnishing';

export type { RoomType };

/**
 * Compass side, German letters as Claude reads them: N, O (Ost), S, W. A wall is named after
 * where it lies in the room: the north wall is at the top of the plan, the room lies south of it.
 * As a facing it is the direction the front of a piece points to (a sofa against the south wall
 * faces N).
 */
export type Side = 'N' | 'O' | 'S' | 'W';

// ---------------------------------------------------------------------------------------------
// Stage 0: read the room (analysis/)
// ---------------------------------------------------------------------------------------------

/** A door, passage or window in one wall of a room. */
export interface WallOpening {
  /**
   * Label within the room: T1, T2 … for doors and passages, F1, F2 … for windows, numbered in
   * wall order (W1 first, along each wall from its start). A door between two rooms has a label
   * in each room; `openingId` links them.
   */
  id: string;
  /** `Opening.id` in the project. */
  openingId: string;
  kind: 'door' | 'passage' | 'window';
  /** Stretch along the wall, measured from the wall start `a` (m). */
  t0: number;
  t1: number;
  /** Room on the other side; null = outside the flat (the entrance door, or a window to the outside). */
  toRoomId: string | null;
  /** Door: the leaf swings into this room, so its swing area must stay free. */
  swingsIn?: boolean;
  /** Door swinging in: area the leaf sweeps in this room (plan polygon). */
  swing?: Vec2[];
  /** Window: lower edge and top above the floor (m). A glazed element to the floor has sill 0. */
  sill?: number;
  top?: number;
  /**
   * One walks through it: doors and passages, and a window to the floor (glazed door) when it is
   * the only way into the room behind it (a balcony without a door). Ways start and end here.
   */
  passable: boolean;
}

/**
 * One straight wall of a room, after joining the pieces a T-junction splits it into. Walls are
 * numbered W1, W2 … clockwise on screen (north → east → south → west for a rectangle), starting
 * with the wall whose start is closest to the north-west corner of the room's bounding box.
 */
export interface WallInfo {
  id: string;
  /** Side for walls along the axes (within 20°); null for walls at an angle (bay, slanted wall). */
  side: Side | null;
  /** Start and end on the room side (corners of the interior outline), clockwise. */
  a: Vec2;
  b: Vec2;
  /** Unit direction a→b and unit normal pointing into the room. */
  dir: Vec2;
  inward: Vec2;
  length: number;
  /** Openings in this wall, sorted along it. */
  openings: WallOpening[];
  /** Stretches without an opening, at least 0.6 m long, measured from `a` (m). */
  free: { t0: number; t1: number }[];
  /** Thickness (m) of the model walls along it. */
  thickness: number;
  /** Height (m); a balcony parapet is about 1 m. */
  height: number;
  /** Rooms behind the wall in order along it; null = outside the flat (outer wall, staircase, neighbours). */
  behind: (string | null)[];
}

/** Corner of the interior outline where two walls meet. Ek is where wall Wk ends. */
export interface CornerInfo {
  id: string;
  p: Vec2;
  /** The wall ending here and the wall starting here. */
  walls: [string, string];
  /** Interior angle over 180°: the corner sticks into the room (L-shaped room, bay shoulder); nothing stands in it. */
  reflex: boolean;
  /** Distance to the nearest door or passage edge, measured along the walls (m); Infinity without one. */
  doorDist: number;
  /** Distance to the nearest window edge, measured along the walls (m); Infinity without one. */
  windowDist: number;
}

/**
 * Way between two passable openings of a room. The furnished room must keep some way of this
 * width between them (B1, B2), not necessarily this one; `length` is the measure for detours (B3).
 */
export interface Walkway {
  /** Opening labels (T1 …) at both ends. */
  from: string;
  to: string;
  /**
   * Shortest walk in the empty room (existing pieces count as obstacles), plan points from the
   * middle of one opening to the other, keeping half the width to walls and obstacles.
   */
  path: Vec2[];
  length: number;
  /**
   * Clear width: 0.9 m in halls and pass-through rooms, otherwise 0.7 m; less where the empty
   * room itself is narrower (see `RoomAnalysis.notes`).
   */
  width: number;
  /** Part of a route from the flat's entrance to another room (traffic through the room). */
  main: boolean;
}

/** Radiator, socket, switch, water or drain connection on a wall of the room. */
export interface RoomFixture {
  id: string;
  kind: FixtureKind;
  /** Wall label (W1 …) it sits on; null when it is not at a wall. */
  wall: string | null;
  /** Position of its centre along the wall from the wall start (m). */
  t: number;
  p: Vec2;
  /** Width along the wall (m), height of the centre (sockets, connections) or of the lower edge (radiator). */
  width: number;
  elevation: number;
  height?: number;
}

/** Area the user marked in the plan with a purpose (#416). */
export interface UserZone {
  /** Z1, Z2 … as in the plan (see `zoneLabels`). */
  id: string;
  /** `PlanZone.id` in the project. */
  zoneId: string;
  purpose: string;
  points: Vec2[];
  /** „frei lassen“ and the like: nothing may stand in it. */
  keepFree: boolean;
}

export interface RoomAnalysis {
  roomId: string;
  name: string;
  /** Net floor area (m²). */
  area: number;
  /** Interior outline, clockwise on screen. */
  polygon: Vec2[];
  /** North-west corner of the bounding box of `polygon`: (0,0) of Claude's room coordinates. */
  origin: Vec2;
  /** Size of the bounding box (m). */
  size: { x: number; y: number };
  /** Clear height of the room (m). */
  height: number;
  walls: WallInfo[];
  corners: CornerInfo[];
  walkways: Walkway[];
  /** Lies on a shortest door route from the flat's entrance to another room (the entrance room too). */
  passThrough: boolean;
  /** Holds the flat's entrance door. */
  entrance: boolean;
  /** Label of the door one comes in through: towards the entrance, in the entrance room the entrance door; null without doors. */
  mainDoor: string | null;
  /**
   * What one looks at when coming in through the main door: a point half a metre inside, the
   * direction into the room and the wall straight ahead.
   */
  entryView: { door: string; at: Vec2; dir: Vec2; wall: string | null } | null;
  /** Room type from the name; the flat concept decides the type used later. */
  typeFromName: RoomType;
  /** Furniture already in the room (`existing`), by id: fitted bath, WC, an existing kitchen. */
  existing: string[];
  userZones: UserZone[];
  fixtures: RoomFixture[];
  /** What the analysis could not read cleanly, in everyday words (no way between two doors …). */
  notes: string[];
}

/** Connection between two rooms through a door or passage. */
export interface RoomLink {
  a: string;
  b: string;
  /** Labels of the opening in room a and in room b. */
  openingA: string;
  openingB: string;
  kind: 'door' | 'passage';
}

export interface FlatAnalysis {
  rooms: RoomAnalysis[];
  links: RoomLink[];
  /** Room with the flat's entrance door; null when no door leads outside. */
  entranceRoomId: string | null;
}

// ---------------------------------------------------------------------------------------------
// Stage 1: flat concept (concept/, Claude, one call)
// ---------------------------------------------------------------------------------------------

export interface StylePlan {
  /** Guiding idea in one or two sentences. */
  idea: string;
  /** Woods, one metal, textiles that recur through the flat (SL3). */
  materials: string[];
  /** Colours with their share (SL2): main 60 %, second 30 %, accent 10 %, or a neutral. */
  palette: { name: string; hex: string; role?: PaletteRole }[];
  /** Form language in one sentence: lines, legs, round against square, textures (SL4, SL5). */
  forms?: string;
}

export type PaletteRole = 'haupt' | 'zweit' | 'akzent' | 'neutral';

/** A function of the flat (from the wishes and the room types) and the one room it goes to. */
export interface FunctionAssignment {
  /** Everyday words: „Schlafen“, „Essen für 4“, „Gästeschlafplatz“, „Arbeiten mit Monitor“. */
  function: string;
  roomId: string;
  why: string;
}

/**
 * Colour scheme of one room (SL2 per room): all colours come from the flat's palette, so the
 * rooms differ in mood but belong together. Walls, big furniture, textiles and the accent are
 * what furniture and décor of the room are coloured by.
 */
export interface RoomScheme {
  /** Wall colour (#rrggbb): the main colour or a tint of it. */
  wall: string;
  /** Big furniture and shelves (the second colour or a wood tone). */
  furniture: string;
  /** Curtains, rug, cushions. */
  textile: string;
  /** Few small accents (vase, picture, one cushion). */
  accent: string;
  /** One sentence: the mood this combination gives the room. */
  note?: string;
}

export interface RoomConcept {
  roomId: string;
  /** Room type the whole pipeline uses from here on (guidelines, required pieces, checks). */
  type: RoomType;
  /** Role in the flat in one sentence („ruhiger Rückzugsort mit viel Stauraum“). */
  role: string;
  functions: string[];
  /** Pieces the room is built around: „Doppelbett 160 mit Kopfteil an der ruhigen Wand“. */
  anchors: string[];
  /** Accent colour from the palette (hex). */
  accent?: string;
  /** Colour scheme of the room; derived from the palette when the answer has none. */
  scheme?: RoomScheme;
  /** What does not belong here, so no function appears twice in the flat. */
  avoid: string[];
}

export interface FlatConcept {
  /** Who lives here and how, two or three sentences. */
  living: string;
  style: StylePlan;
  /** Every function exactly once. */
  functions: FunctionAssignment[];
  rooms: RoomConcept[];
}

// ---------------------------------------------------------------------------------------------
// Stage 2: room programme (concept/, Claude, one call per room)
// ---------------------------------------------------------------------------------------------

export interface ProgramZone {
  /** Short id Claude chose („kochen“, „essen“). */
  id: string;
  function: string;
  /** Axis-aligned rectangle in plan coordinates. */
  rect: { x0: number; y0: number; x1: number; y1: number };
  why: string;
  /** User zone (Z1 …) this zone takes up. */
  userZone?: string;
}

export interface ProgramItem {
  /** Short id, unique in the room („sofa“, „chair_n1“). */
  id: string;
  /** Catalogue id: generic placeholder or one of the user's products. */
  catalogId: string;
  /** Zone id. */
  zone: string;
  /** Claude's start place: centre and rotation. The solver keeps close to it where the rules allow. */
  hint?: { x: number; y: number; rotation: number };
  /** Short product description for the search („Ausziehtisch Eiche hell, 140 cm“). */
  label?: string;
  /** Colour as #rrggbb. */
  color?: string;
  /** Functions the real product must have („Schlaffunktion“, „Stauraum“), for the product search. */
  features?: string[];
  why: string;
  /** Smaller pieces of the same kind (catalogue ids, preferred first) for when it does not fit. */
  fallbacks?: string[];
  /** Anchor piece or required by the room type: leaving it out is a severe finding, never silent. */
  required?: boolean;
}

/**
 * Closed vocabulary of placement relations; the solver understands exactly these. `item`,
 * `item2`, `items` and `target` are ProgramItem ids, except where a field names walls (W1 …),
 * windows (F1 …) or the window sill (`on` with a window label). Distances in metres.
 */
export type Relation =
  /** Back of `item` against wall `wall`, optionally between two points of that wall. */
  | { kind: 'wall'; item: string; wall: string; along?: { from: Vec2; to: Vec2 } }
  /** `item` in the corner where the two walls meet. */
  | { kind: 'corner'; item: string; walls: [string, string] }
  /** `item` stands free in the middle of its zone (dining table, island, room divider). */
  | { kind: 'center'; item: string }
  /** `item` in front of the front side of `target`, `gap` between them (coffee table 0.45 m before the sofa). */
  | { kind: 'front-of'; item: string; target: string; gap?: number }
  /** `item` beside `target`, on its left or right as seen from target's front (sitting on the sofa). */
  | { kind: 'left-of' | 'right-of'; item: string; target: string; gap?: number }
  /** `item` and `item2` mirrored on both sides of `target` (nightstands at the bed). */
  | { kind: 'pair'; item: string; item2: string; target: string }
  /** `item` faces `target`, `distance` between their fronts (TV and sofa). */
  | { kind: 'facing'; item: string; target: string; distance?: number }
  /** Seat at one end of `target` (armchair at the coffee table), turned towards it, `gap` between them; `side` as seen from the target's front. */
  | { kind: 'flank'; item: string; target: string; side?: 'left' | 'right'; gap?: number }
  /** Seats spread around the free sides of a table. */
  | { kind: 'around'; items: string[]; target: string }
  /** Hangs centred above `target` (picture over the sofa, pendant over the table); `height` = lower edge above the floor. */
  | { kind: 'above'; item: string; target: string; height?: number }
  /** Rug under the front part of `target` (front legs of the seating) or under all of it (bed, dining set). */
  | { kind: 'under-front' | 'under-all'; item: string; target: string }
  /** Stands on `target`: a piece (lamp on the sideboard) or a window sill (window label F1 …). */
  | { kind: 'on'; item: string; target: string }
  /** Belongs to window `window`: beside it (armchair, desk), in front of it below the sill, or over it (curtain). */
  | { kind: 'window'; item: string; window: string; place?: 'beside' | 'front' | 'over' }
  /** Centre distance at most `max` (plant near the armchair). */
  | { kind: 'near'; item: string; target: string; max?: number }
  /** Centre distance at least `min` (desk away from the bed). */
  | { kind: 'away'; item: string; target: string; min?: number }
  /** In one line: fronts flush or centres on one axis (shelves side by side, wardrobes in a row). */
  | { kind: 'align'; items: string[] };

export type RelationKind = Relation['kind'];

/** Straight kitchen run on one wall; an L-shaped kitchen is two runs. */
export interface KitchenRun {
  wall: string;
  /** Stretch of the wall the run may use (points on the wall, plan coordinates). */
  from: Vec2;
  to: Vec2;
  /** Floor modules in order from `from` to `to` (catalogue ids). Wall cabinets, worktop, cooktop and hood are added by the app. */
  modules: string[];
}

export interface RoomProgram {
  roomId: string;
  /** How Claude reads the room: light, traffic, quiet corners, view on entering. */
  reading: string;
  zones: ProgramZone[];
  items: ProgramItem[];
  relations: Relation[];
  kitchen?: KitchenRun[];
  /** How one walks through the furnished room. */
  walk: string;
  /** Claude's own check, point by point. */
  check: string[];
}

// ---------------------------------------------------------------------------------------------
// Stage 3: place (solver/)
// ---------------------------------------------------------------------------------------------

export interface PlacedItem {
  /** ProgramItem id; generated pieces (kitchen modules) get `<run>-<n>` ids. */
  id: string;
  catalogId: string;
  zone: string;
  x: number;
  y: number;
  rotation: number;
  /** Height of the base above the floor: 0 on the floor, top of the parent for things on it, mounting height for things on the wall. */
  elevation: number;
  width: number;
  depth: number;
  height: number;
  /** Programme catalogue id when a smaller fallback was used instead. */
  replaces?: string;
  /** Piece it was derived from and moves with (chair → table, lamp → sideboard, rug → sofa). */
  parent?: string;
  /** Index of the kitchen run for kitchen modules. */
  kitchenRun?: number;
}

export interface DroppedItem {
  id: string;
  catalogId: string;
  /** Everyday words („passt neben dem Bett nicht mehr hin, auch nicht in klein“). */
  reason: string;
}

export interface Layout {
  roomId: string;
  items: PlacedItem[];
  dropped: DroppedItem[];
  /** Remaining weighted soft cost (lower is better). */
  cost: number;
  /** Hard rules still broken after the search (should be empty), short texts for debugging. */
  unsolved: string[];
  /** Same programme and seed give the same layout. */
  seed: number;
}

// ---------------------------------------------------------------------------------------------
// Stage 4: walk-through (review/)
// ---------------------------------------------------------------------------------------------

/** S = severe (the proposal is not shown like this), M = medium, L = light. */
export type Severity = 'S' | 'M' | 'L';

export interface Finding {
  /** Rule id from the checklist in the plan (A1 … E5). */
  rule: string;
  severity: Severity;
  /** Room, or null for a finding about the whole flat (a function twice, A2). */
  roomId: string | null;
  /** Pieces concerned (PlacedItem or furniture ids). */
  items: string[];
  /** Everyday words, shown to the user and given to Claude in the critique. */
  text: string;
  /** Where to mark it in the plan. */
  where?: Vec2;
}

export interface RoomMetrics {
  /** Share of the floor covered by furniture standing on the floor (0–1). */
  occupancy: number;
  /** Sum of the walkway lengths in the empty and in the furnished room (m). */
  walkEmpty: number;
  walkFurnished: number;
  /** Programme pieces that could not be placed. */
  dropped: number;
}

export interface RoomReview {
  roomId: string;
  findings: Finding[];
  /** 100 minus the points per finding (see score.ts), not below 0. */
  score: number;
  /** No severe finding and at least PASS_SCORE points. */
  passed: boolean;
  metrics: RoomMetrics;
}

export interface Review {
  rooms: RoomReview[];
  /** Findings about the whole flat. */
  flat: Finding[];
  /** Mean and lowest room score. */
  score: number;
  minScore: number;
  passed: boolean;
}

// ---------------------------------------------------------------------------------------------
// Whole run (stage 5 and 6 work on these)
// ---------------------------------------------------------------------------------------------

export interface RoomResult {
  roomId: string;
  program: RoomProgram;
  layout: Layout;
  review: RoomReview;
  /** Critique calls that changed the programme (up to two rounds and one look). */
  rounds: number;
}

export interface FlatResult {
  analysis: FlatAnalysis;
  concept: FlatConcept;
  rooms: RoomResult[];
  review: Review;
}
