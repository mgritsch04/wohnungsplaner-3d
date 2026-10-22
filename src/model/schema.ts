import { z } from 'zod';
import { BODY_HEIGHT_DEFAULT, BODY_HEIGHT_MAX, BODY_HEIGHT_MIN, migrateBodyHeight } from './body';

/**
 * Versioned project schema (the full, editable apartment project).
 * Every architectural length is in meters, angles in radians (see units.ts).
 *
 * Bump PROJECT_SCHEMA_VERSION when the stored shape changes and add a
 * migration step in formats/project/migrate.ts.
 */
export const PROJECT_FORMAT = 'wohnungsplaner-project';
export const PROJECT_SCHEMA_VERSION = 5;

const finite = () => z.number().refine(Number.isFinite, 'Zahl muss endlich sein');
const len = (min: number, max: number) => finite().min(min).max(max);

export const Vec2Schema = z.object({ x: finite(), y: finite() });

export const ProvenanceSchema = z.object({
  /** Where the element came from. */
  source: z.enum(['manual', 'imported-json', 'detected', 'traced']),
  /** confirmed = user verified, estimated = inferred, uncertain = needs review. */
  status: z.enum(['confirmed', 'estimated', 'uncertain']),
  /** Detector confidence 0..1 when applicable. */
  confidence: z.number().min(0).max(1).optional(),
  note: z.string().max(500).optional(),
});

export const NodeSchema = z.object({
  id: z.string().min(1),
  x: finite(),
  y: finite(),
});

/** Construction of a wall (#80); only used for a rough sound-insulation estimate. */
export const WallAssemblySchema = z.enum(['brick', 'drywall', 'concrete', 'aerated']);

export const WallSchema = z.object({
  id: z.string().min(1),
  /** Start node id. */
  a: z.string().min(1),
  /** End node id. */
  b: z.string().min(1),
  thickness: len(0.02, 2),
  height: len(0.1, 10),
  /** Material ids for the left (+perp) and right side of the wall, relative to a→b. */
  leftMaterialId: z.string().optional(),
  rightMaterialId: z.string().optional(),
  /** Wall construction (#80); unset = unknown, treated as brick in the estimate. */
  assembly: WallAssemblySchema.optional(),
  provenance: ProvenanceSchema.optional(),
});

export const OpeningKindSchema = z.enum(['door', 'window', 'passage']);

/**
 * Default leaf state of an opening kind (#21): doors are open – as drawn in the plan
 * and as the collision check has always assumed –, windows closed. Passages have no leaf.
 */
export const defaultLeafOpen = (kind: z.infer<typeof OpeningKindSchema>): boolean => kind === 'door';

/**
 * A window down to the floor is a glazed door (balcony/patio door, French window, #37): drawn and
 * rendered like a window, but people walk through it when its sash is open.
 */
export const isGlassDoor = (o: { kind: z.infer<typeof OpeningKindSchema>; sillHeight: number }): boolean => o.kind === 'window' && o.sillHeight < 0.05;

/** German name of an opening for lists and headings. */
export const openingLabel = (o: { kind: z.infer<typeof OpeningKindSchema>; sillHeight: number }): string =>
  o.kind === 'door' ? 'Tür' : isGlassDoor(o) ? 'Glastür' : o.kind === 'window' ? 'Fenster' : 'Durchgang';

export const OpeningSchema = z
  .object({
    id: z.string().min(1),
    wallId: z.string().min(1),
    kind: OpeningKindSchema,
    /** Distance along the wall centerline from node `a` to the CENTER of the opening. */
    offset: finite().min(0),
    width: len(0.1, 10),
    height: len(0.1, 10),
    /** Height of the lower edge above the floor (0 for doors). */
    sillHeight: len(0, 10),
    /** Door hinge position: at the side closer to wall start (`a`) or end (`b`). Single-sash windows use it too. */
    hinge: z.enum(['start', 'end']).default('start'),
    /** Side the door leaf swings to: left (+perp of a→b) or right. */
    swing: z.enum(['left', 'right']).default('left'),
    /**
     * Door leaf / window sash opened (3D view; an opened leaf counts in the collision
     * check). Projects saved before #21 lack the field: the default depends on the kind
     * (see defaultLeafOpen), so it is filled in below instead of a plain `.default()`.
     */
    open: z.boolean().optional(),
    provenance: ProvenanceSchema.optional(),
  })
  .transform((o) => ({ ...o, open: o.open ?? defaultLeafOpen(o.kind) }));

export const RoomSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  /** Closed cycle of node ids along the wall centerlines (≥3 nodes). */
  nodeIds: z.array(z.string().min(1)).min(3),
  floorMaterialId: z.string().optional(),
  wallMaterialId: z.string().optional(),
  ceilingMaterialId: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
});

export const MaterialKindSchema = z.enum([
  'paint',
  'wood',
  'tile',
  'stone',
  'concrete',
  'carpet',
  'metal',
  'glass',
  'fabric',
  'plastic',
]);

export const MaterialSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  kind: MaterialKindSchema,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  /** Real-world size of one texture repeat in meters (procedural patterns). */
  textureScale: len(0.01, 20).default(1),
});

export const PriceSchema = z.object({
  amount: z.number().min(0),
  currency: z.literal('EUR'),
  /** confirmed = taken from a real product source; estimate = rough guide value; user = entered by the user. */
  status: z.enum(['confirmed', 'estimate', 'user']),
  /** ISO date of when the price was recorded, if known. */
  recordedAt: z.string().optional(),
});

/** Kinds of table base the procedural stand-in can draw (#273). */
export const TableBaseSchema = z.enum(['legs4', 'sled', 'x', 'pedestal', 'panel']);
export type TableBase = z.infer<typeof TableBaseSchema>;

export const ModelRefSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('procedural'),
    shape: z.string().min(1),
    /** colour of legs / frame / base, e.g. from the product photo (#273) */
    secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    /** kind of table base stated on the product page (#273) */
    base: TableBaseSchema.optional(),
    /** part sizes stated on the product page, in meters (#273) */
    topThickness: len(0.005, 0.15).optional(),
    legSize: len(0.01, 0.25).optional(),
    seatHeight: len(0.25, 0.9).optional(),
    /** small crop of the product photo for the main surface (#273), as data URL so it travels with the project */
    texture: z
      .string()
      .max(80_000)
      .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/)
      .optional(),
  }),
  z.object({
    type: z.literal('gltf'),
    /** Either an asset id from the local asset store or an http(s)/relative URL. */
    assetId: z.string().optional(),
    url: z.string().optional(),
    /** Procedural shape used while loading or when the model fails to load. */
    fallbackShape: z.string().default('box'),
  }),
]);

export const KitchenModuleSchema = z.object({
  type: z.enum([
    'base',
    'wall',
    'tall',
    'sink',
    'oven',
    'cooktop',
    'fridge',
    'dishwasher',
    'countertop',
    'hood',
  ]),
  /** For cabinets: front style. */
  front: z.enum(['doors', 'drawers', 'open', 'appliance']).default('doors'),
  frontColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /** Countertop items generated automatically by the kitchen planner. */
  generated: z.boolean().default(false),
});

/** Surface type of a furniture body (#63): replaces the model's built-in structure/gloss on its main parts. */
export const FurnitureFinishSchema = z.enum(['fabric', 'leather', 'wood', 'lacquer', 'metal', 'stone']);

/** One element of a cabinet's inner layout (#85): shelf, drawer or clothes rod in a column. */
export const InteriorPartSchema = z.object({
  kind: z.enum(['shelf', 'drawer', 'rod']),
  /** Column (0-based, left to right as seen from the front). */
  column: z.number().int().min(0).max(5),
  /** Height of the part's underside (rod: of the rod) above the inner floor. */
  z: len(0, 10),
  /** Drawer front height; ignored for shelf and rod. */
  h: len(0.01, 2).optional(),
});

/** Inner layout of a cabinet (#85); optional, so older files stay valid (no migration). */
export const InteriorSchema = z.object({
  columns: z.number().int().min(1).max(6),
  parts: z.array(InteriorPartSchema).max(80),
});

export const FurnitureSchema = z.object({
  id: z.string().min(1),
  catalogId: z.string().optional(),
  name: z.string().max(200),
  category: z.string().min(1),
  /** Center of the footprint in plan coordinates. */
  x: finite(),
  y: finite(),
  /** Height of the object's base above the floor. */
  elevation: len(0, 10).default(0),
  /** Plan rotation in radians (clockwise on screen). */
  rotation: finite().default(0),
  /** Dimensions along local x (width), local y (depth) and vertical (height). */
  width: len(0.01, 20),
  depth: len(0.01, 20),
  height: len(0.001, 10),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b0a898'),
  /** Chosen material of the main parts (#63); absent = the model's built-in look. */
  finish: FurnitureFinishSchema.optional(),
  model: ModelRefSchema,
  quantity: z.number().int().min(1).max(999).default(1),
  price: PriceSchema.optional(),
  brand: z.string().max(100).optional(),
  retailer: z.string().max(100).optional(),
  productUrl: z.string().max(2000).optional(),
  imageUrl: z.string().max(2000).optional(),
  /** true when the geometry is a generic approximation of the real product. */
  approximate: z.boolean().default(true),
  /** Whether the object blocks first-person movement (rugs, lamps etc. do not). */
  solid: z.boolean().default(true),
  kitchen: KitchenModuleSchema.optional(),
  locked: z.boolean().default(false),
  /** Already in the flat when moving in (fitted bath, WC): shown in the plan, but not part of budget or shopping list (#255). */
  existing: z.boolean().default(false),
  /** Member of the furniture group with this id (#65), see `ProjectSchema.groups`; absent = not grouped. */
  groupId: z.string().min(1).optional(),
  /** Inner layout of a cabinet (#85); absent = not planned. */
  interior: InteriorSchema.optional(),
});

/**
 * Named, permanent group of furniture (#65), e.g. a kitchen run or a dining set: selected,
 * moved and rotated together. Membership is stored on the items (`Furniture.groupId`), so
 * an item belongs to at most one group and deleting/copying items needs no list upkeep;
 * this list only carries the name.
 */
export const FurnitureGroupSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
});

export const LightSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  x: finite(),
  y: finite(),
  elevation: len(0, 10),
  /** Colour temperature in Kelvin (2700 warm … 6500 cool). */
  temperature: z.number().min(1500).max(10000),
  /** Luminous intensity factor (0..10, relative). */
  intensity: z.number().min(0).max(10),
  on: z.boolean().default(true),
});

/**
 * Smart-home device (#170, simulated; no connection to real hardware). `kind` decides the
 * behaviour in the simulation, `productId` points into the device catalog
 * (smarthome/catalog.ts) whose datasheet values are used unless overridden here.
 */
export const SmartDeviceKindSchema = z.enum(['motion', 'presence', 'contact', 'light', 'plug', 'router', 'strip', 'speaker']);
export const SmartDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  kind: SmartDeviceKindSchema,
  productId: z.string().max(100).optional(),
  x: finite(),
  y: finite(),
  elevation: len(0, 10),
  /** Plan rotation in radians: the direction a sensor looks at (0 = +x). */
  rotation: finite().default(0),
  /** Detection range (m) / opening angle (degrees) / hold time (s); overrides the catalog value. */
  rangeM: len(0.5, 20).optional(),
  angleDeg: z.number().min(10).max(360).optional(),
  holdS: z.number().min(1).max(3600).optional(),
  /** kind `light`: the placed light (project.lights) this bulb switches. */
  lightId: z.string().optional(),
  /** kind `contact`: the door/window it watches. */
  openingId: z.string().optional(),
  /**
   * kind `strip` (#238): LED strip along a path (2..12 points, plan metres); x/y stay the first
   * point. `elevation` is its mounting height, `direction` where it shines (down, back to the
   * wall, up into a cove). `color` (#rrggbb) or `kelvin` set the planned colour, brightness is
   * switched in the simulation. All optional: older files without them stay valid (no migration).
   */
  points: z.array(Vec2Schema).min(2).max(12).optional(),
  direction: z.enum(['down', 'back', 'up']).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  kelvin: z.number().min(1500).max(10000).optional(),
  /**
   * kind `speaker` (#138): which kind of loudspeaker is planned (generic type, no product);
   * `rotation` is the direction it fires at, `elevation` its height. Optional: no migration.
   */
  speakerType: z.enum(['bookshelf', 'bluetooth', 'soundbar', 'subwoofer', 'desk']).optional(),
});

/**
 * Installation point on a wall (#64, #81): socket, light switch, radiator, water or waste-water
 * connection – only placement and display, no device logic. Stored like furniture with a plan
 * position; placing and dragging snap it onto the nearest wall face (model/fixtures.ts), so it
 * stays put when walls are edited later.
 */
export const FixtureKindSchema = z.enum(['socket', 'switch', 'radiator', 'water', 'drain']);
export const FixtureSchema = z.object({
  id: z.string().min(1),
  kind: FixtureKindSchema,
  /** Centre of the footprint in plan coordinates (in front of the wall face). */
  x: finite(),
  y: finite(),
  /** Plan rotation like furniture: the front (local +y) faces away from the wall into the room. */
  rotation: finite().default(0),
  /** Height of the centre (sockets, switches, connections) or of the lower edge (radiator) above the floor. */
  elevation: len(0, 3),
  /** Radiator size (m); other kinds use fixed sizes. */
  width: len(0.2, 3).optional(),
  height: len(0.2, 2).optional(),
  /** Sockets: number of outlets side by side (1 = single, 2 = double …). */
  count: z.number().int().min(1).max(5).default(1),
  note: z.string().max(200).optional(),
  /** Sockets: the circuit (project.circuits) this socket hangs on (#135). */
  circuitId: z.string().optional(),
});

/** Electrical circuit with its fuse (#135); the power check is a guide value only. */
export const CircuitSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(60),
  /** Fuse rating in ampere. */
  amps: z.number().min(6).max(63).default(16),
});

/** Consumer with its power in watt, attached to a socket (fixtureId) or directly to a circuit (circuitId) (#135). */
export const LoadSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(80),
  watts: z.number().min(0).max(30000),
  fixtureId: z.string().optional(),
  circuitId: z.string().optional(),
});

/** Home-Assistant-like automation: trigger → optional condition → light action (#170). */
export const AutomationSchema = z.object({
  id: z.string().min(1),
  name: z.string().max(100),
  enabled: z.boolean().default(true),
  trigger: z.discriminatedUnion('type', [
    z.object({ type: z.literal('motion'), deviceId: z.string().min(1) }),
    z.object({ type: z.literal('contact'), deviceId: z.string().min(1), to: z.enum(['open', 'closed']) }),
    z.object({ type: z.literal('time'), hour: z.number().min(0).max(24) }),
  ]),
  /** only when it is dark (sun below the horizon at the simulated hour) */
  onlyWhenDark: z.boolean().default(false),
  action: z.object({
    deviceIds: z.array(z.string()),
    on: z.boolean(),
    brightness: z.number().min(1).max(100).optional(),
    /** LED strips (#238): colour (#rrggbb) the strip takes when the rule fires */
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  }),
  /** Motion trigger: switch the lights off again once the sensor reports "no motion" for this long (s). */
  offAfterS: z.number().min(0).max(7200).optional(),
});

export const CalibrationSchema = z.object({
  /** Two reference points in IMAGE pixel coordinates. */
  p1: Vec2Schema,
  p2: Vec2Schema,
  /** Real distance between p1 and p2 in meters, as entered by the user. */
  distance: len(0.01, 1000),
});

export const UnderlaySchema = z.object({
  /** Asset id of the rendered raster image (PNG) in the local asset store. */
  imageAssetId: z.string().min(1),
  /** Asset id of the original uploaded file (PDF/PNG/JPG), if retained. */
  sourceAssetId: z.string().optional(),
  fileName: z.string().max(300),
  sourceKind: z.enum(['pdf', 'png', 'jpeg']),
  pdfPage: z.number().int().min(1).optional(),
  pdfPageCount: z.number().int().min(1).optional(),
  /** 'vector' | 'raster' | 'unknown' classification of PDF content. */
  pdfContent: z.enum(['vector', 'raster', 'mixed', 'unknown']).optional(),
  /** For PDFs: rendered pixels per PDF point (needed to apply a stated drawing scale). */
  pixelsPerPoint: z.number().positive().optional(),
  pixelWidth: z.number().int().min(1),
  pixelHeight: z.number().int().min(1),
  /** Meters per image pixel. Only meaningful when calibrated. */
  metersPerPixel: z.number().positive(),
  calibrated: z.boolean(),
  /** How metersPerPixel was obtained: none = provisional display scale only,
   *  notation = from a stated drawing scale (e.g. 1:100, unverified), reference = two-point calibration. */
  scaleSource: z.enum(['none', 'notation', 'reference']).default('none'),
  calibration: CalibrationSchema.optional(),
  /** Additional check measurements: known distances compared against the calibrated plan. */
  checks: z.array(CalibrationSchema).default([]),
  /** Plan position of the image's top-left corner. */
  x: finite(),
  y: finite(),
  rotation: finite().default(0),
  opacity: z.number().min(0).max(1).default(0.5),
  visible: z.boolean().default(true),
  locked: z.boolean().default(false),
  /** Crop rectangle in image pixels. */
  crop: z
    .object({ x: z.number().min(0), y: z.number().min(0), width: z.number().positive(), height: z.number().positive() })
    .optional(),
});

export const QualityModeSchema = z.enum(['planning', 'realism']);

export const SettingsSchema = z.preprocess(migrateBodyHeight, z.object({
  gridSize: len(0.01, 5).default(0.1),
  snapToGrid: z.boolean().default(true),
  defaultWallThickness: len(0.02, 2).default(0.12),
  defaultWallHeight: len(0.5, 10).default(2.6),
  quality: QualityModeSchema.default('planning'),
  /** Hour of day 0..24 for the sun position. */
  timeOfDay: z.number().min(0).max(24).default(14),
  exposure: z.number().min(0.1).max(4).default(1),
  /** Compass bearing (degrees, 0 = north, 90 = east) the upper edge of the plan points to (#69, #93); 0 = plan up is north. */
  northDirection: z.number().min(0).max(359).default(0),
  /** Share of the fuse rating treated as continuous load before the power check warns (#135), percent. */
  circuitLimitPct: z.number().min(10).max(100).default(80),
  /** Show ceilings in the 3D view (off by default for better overview). */
  showCeilings: z.boolean().default(false),
  /** Mouse sensitivity factor for looking around (walk) and orbiting; 1 = default feel. */
  mouseSensitivity: z.number().min(0.2).max(3).default(1),
  /** Lamps in realism mode: 'auto' = switched on at dusk, 'on' = always, 'off' = never. */
  lamps: z.enum(['auto', 'on', 'off']).default('auto'),
  /** Body height of the person walking through (#263), metres; the standing and seated eye heights follow from it (model/body.ts). */
  bodyHeight: z.number().min(BODY_HEIGHT_MIN).max(BODY_HEIGHT_MAX).default(BODY_HEIGHT_DEFAULT),
  /** Walkthrough "Echt-Maßstab" (#256): field of view from screen size and viewing distance instead of the wide angle. */
  walkTrueScale: z.boolean().default(false),
  /** Field of view of the walkthrough in degrees (#263) when "Echt-Maßstab" is off; 70 = the old wide angle. */
  walkFov: z.number().min(30).max(70).default(50),
  /** Gentle head bob while walking (#263). */
  walkHeadBob: z.boolean().default(true),
  /** Reference person of the set body height in 3D (#263). */
  showRefFigure: z.boolean().default(false),
  /** Screen diagonal (inches) and viewing distance (metres) for the true-scale field of view. */
  screenDiagonal: z.number().min(10).max(100).default(27),
  viewingDistance: z.number().min(0.3).max(3).default(0.6),
  /** How furniture snaps while dragging (#52): grid steps + wall edges, wall edges only, or free. Alt = free temporarily. */
  furnitureSnap: z.enum(['grid5', 'grid10', 'wall', 'off']).default('grid5'),
  /** Minimum clear width of passages (#68) in metres – a guideline, not a building code. */
  minPassageWidth: z.number().min(0.6).max(1.5).default(0.9),
  /** Mark passages narrower than minPassageWidth in 2D and 3D. */
  showNarrowPassages: z.boolean().default(true),
  /** Rough heating-cost estimate (#90): insulation standard and heating source; orientation only. */
  insulation: z.enum(['unrenovated', 'partial', 'standard', 'good', 'passive']).default('standard'),
  heatingSource: z.enum(['gas', 'oil', 'district', 'heatpump', 'electric']).default('gas'),
  /** Kitchen work triangle (#82): display + limits (rule of thumb, not a standard), metres. */
  kitchenTriangle: z
    .object({
      show: z.boolean().default(true),
      sideMin: z.number().min(0.3).max(5).default(1.2),
      sideMax: z.number().min(0.5).max(6).default(2.7),
      sumMin: z.number().min(1).max(15).default(4),
      sumMax: z.number().min(2).max(20).default(8),
    })
    .default({ show: true, sideMin: 1.2, sideMax: 2.7, sumMin: 4, sumMax: 8 }),
}));

/** Point in 3D world coordinates of the 3D view (metres): x = plan x, y = height, z = plan y. */
export const Vec3Schema = z.object({ x: finite(), y: finite(), z: finite() });

/**
 * Saved 3D viewpoint (#55). `orbit`: camera position + orbit target. `walk`: eye position +
 * a point in the viewing direction (yaw/pitch are derived from it) and the eye height.
 */
export const CameraBookmarkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  mode: z.enum(['orbit', 'walk']),
  position: Vec3Schema,
  target: Vec3Schema,
  /** Walkthrough only: eye height (m). */
  eyeHeight: z.number().min(0.5).max(3).optional(),
  /** Section view (Schnitt) on/off when the view was saved; absent = leave unchanged. */
  cutaway: z.boolean().optional(),
});

/** Short note pinned to a room or a piece of furniture (#83); shown as a pin in the 2D plan. */
export const NoteSchema = z.object({
  id: z.string().min(1),
  target: z.object({ type: z.enum(['room', 'furniture']), id: z.string().min(1) }),
  text: z.string().max(500),
});

/**
 * Checkable to-do. With `roomId` it belongs to that room's task list (#84); without it, it is a
 * step of the project-wide moving checklist (#91). `due` is an optional date (YYYY-MM-DD).
 */
export const TaskSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().min(1).optional(),
  text: z.string().max(200),
  done: z.boolean().default(false),
  due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Reference photo hung on one side of a wall (#86), to compare real rooms with the plan.
 * The image lives only in the local asset store (`assetId`), never in the repo or on a server.
 * `along` = distance of the photo's left edge from the wall start (m), `bottom` = height of its
 * lower edge (m); the height follows from `width` and the image aspect `aspect` (width / height).
 */
export const PhotoSchema = z.object({
  id: z.string().min(1),
  wallId: z.string().min(1),
  /** Wall side relative to a→b: left = +normal side. */
  side: z.enum(['left', 'right']),
  assetId: z.string().min(1),
  fileName: z.string().max(300).default(''),
  aspect: z.number().min(0.05).max(20),
  width: len(0.05, 20),
  along: finite(),
  bottom: finite(),
  visible: z.boolean().default(true),
  opacity: z.number().min(0.05).max(1).default(1),
});

export const ProjectSchema = z.object({
  format: z.literal(PROJECT_FORMAT),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1),
  name: z.string().max(200),
  createdAt: z.string(),
  updatedAt: z.string(),
  units: z.literal('m'),
  settings: SettingsSchema,
  nodes: z.array(NodeSchema),
  walls: z.array(WallSchema),
  openings: z.array(OpeningSchema),
  rooms: z.array(RoomSchema),
  furniture: z.array(FurnitureSchema),
  lights: z.array(LightSchema),
  materials: z.array(MaterialSchema),
  underlay: UnderlaySchema.nullable().default(null),
  /** Saved 3D viewpoints (#55); projects saved before lack the field. */
  cameraBookmarks: z.array(CameraBookmarkSchema).default([]),
  /** Furniture groups (#65); projects saved before lack the field. */
  groups: z.array(FurnitureGroupSchema).default([]),
  /** Simulated smart-home devices and automations (#170, schema 2). */
  devices: z.array(SmartDeviceSchema).default([]),
  automations: z.array(AutomationSchema).default([]),
  /** Installation plan (#64, #81): sockets, switches, radiators, water/waste-water connections; projects saved before lack the field. */
  fixtures: z.array(FixtureSchema).default([]),
  /** Circuits and consumers for the power check (#135); projects saved before lack the fields. */
  circuits: z.array(CircuitSchema).default([]),
  loads: z.array(LoadSchema).default([]),
  /** Notes as pins (#83), room task lists (#84) and the moving checklist (#91, tasks without roomId); schema 4. */
  notes: z.array(NoteSchema).default([]),
  tasks: z.array(TaskSchema).default([]),
  /** Reference photos on walls (#86); schema 5. */
  photos: z.array(PhotoSchema).default([]),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type PlanNode = z.infer<typeof NodeSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type OpeningKind = z.infer<typeof OpeningKindSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type MaterialKind = z.infer<typeof MaterialKindSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type FurnitureFinish = z.infer<typeof FurnitureFinishSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type KitchenModule = z.infer<typeof KitchenModuleSchema>;
export type Furniture = z.infer<typeof FurnitureSchema>;
export type InteriorPart = z.infer<typeof InteriorPartSchema>;
export type Interior = z.infer<typeof InteriorSchema>;
export type FurnitureGroup = z.infer<typeof FurnitureGroupSchema>;
export type Light = z.infer<typeof LightSchema>;
export type SmartDeviceKind = z.infer<typeof SmartDeviceKindSchema>;
export type SmartDevice = z.infer<typeof SmartDeviceSchema>;
export type Automation = z.infer<typeof AutomationSchema>;
export type FixtureKind = z.infer<typeof FixtureKindSchema>;
export type Fixture = z.infer<typeof FixtureSchema>;
export type Circuit = z.infer<typeof CircuitSchema>;
export type Load = z.infer<typeof LoadSchema>;
export type Note = z.infer<typeof NoteSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Photo = z.infer<typeof PhotoSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type Underlay = z.infer<typeof UnderlaySchema>;
export type QualityMode = z.infer<typeof QualityModeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Vec3 = z.infer<typeof Vec3Schema>;
export type CameraBookmark = z.infer<typeof CameraBookmarkSchema>;
export type Project = z.infer<typeof ProjectSchema>;
