import { z } from 'zod';

/**
 * Versioned project schema (the full, editable apartment project).
 * Every architectural length is in meters, angles in radians (see units.ts).
 *
 * Bump PROJECT_SCHEMA_VERSION when the stored shape changes and add a
 * migration step in formats/project/migrate.ts.
 */
export const PROJECT_FORMAT = 'wohnungsplaner-project';
export const PROJECT_SCHEMA_VERSION = 1;

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
  provenance: ProvenanceSchema.optional(),
});

export const OpeningKindSchema = z.enum(['door', 'window', 'passage']);

/**
 * Default leaf state of an opening kind (#21): doors are open – as drawn in the plan
 * and as the collision check has always assumed –, windows closed. Passages have no leaf.
 */
export const defaultLeafOpen = (kind: z.infer<typeof OpeningKindSchema>): boolean => kind === 'door';

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

export const ModelRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('procedural'), shape: z.string().min(1) }),
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

export const SettingsSchema = z.object({
  gridSize: len(0.01, 5).default(0.1),
  snapToGrid: z.boolean().default(true),
  defaultWallThickness: len(0.02, 2).default(0.12),
  defaultWallHeight: len(0.5, 10).default(2.6),
  quality: QualityModeSchema.default('planning'),
  /** Hour of day 0..24 for the sun position. */
  timeOfDay: z.number().min(0).max(24).default(14),
  exposure: z.number().min(0.1).max(4).default(1),
  /** Show ceilings in the 3D view (off by default for better overview). */
  showCeilings: z.boolean().default(false),
  /** Mouse sensitivity factor for looking around (walk) and orbiting; 1 = default feel. */
  mouseSensitivity: z.number().min(0.2).max(3).default(1),
  /** Lamps in realism mode: 'auto' = switched on at dusk, 'on' = always, 'off' = never. */
  lamps: z.enum(['auto', 'on', 'off']).default('auto'),
  /** Camera (eye) height in the first-person walkthrough, metres. */
  eyeHeight: z.number().min(1).max(2.2).default(1.63),
  /** How furniture snaps while dragging (#52): grid steps + wall edges, wall edges only, or free. Alt = free temporarily. */
  furnitureSnap: z.enum(['grid5', 'grid10', 'wall', 'off']).default('grid5'),
  /** Minimum clear width of passages (#68) in metres – a guideline, not a building code. */
  minPassageWidth: z.number().min(0.6).max(1.5).default(0.9),
  /** Mark passages narrower than minPassageWidth in 2D and 3D. */
  showNarrowPassages: z.boolean().default(true),
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
});

export type Provenance = z.infer<typeof ProvenanceSchema>;
export type PlanNode = z.infer<typeof NodeSchema>;
export type Wall = z.infer<typeof WallSchema>;
export type OpeningKind = z.infer<typeof OpeningKindSchema>;
export type Opening = z.infer<typeof OpeningSchema>;
export type Room = z.infer<typeof RoomSchema>;
export type MaterialKind = z.infer<typeof MaterialKindSchema>;
export type Material = z.infer<typeof MaterialSchema>;
export type Price = z.infer<typeof PriceSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type KitchenModule = z.infer<typeof KitchenModuleSchema>;
export type Furniture = z.infer<typeof FurnitureSchema>;
export type Light = z.infer<typeof LightSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type Underlay = z.infer<typeof UnderlaySchema>;
export type QualityMode = z.infer<typeof QualityModeSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Project = z.infer<typeof ProjectSchema>;
