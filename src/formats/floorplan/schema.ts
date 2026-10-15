import { z } from 'zod';

/**
 * apartment-plan.json — native, editable floor-plan interchange format.
 * See docs/apartment-plan-format.md for the full specification and examples.
 */
export const FLOORPLAN_FORMAT = 'apartment-plan';
export const FLOORPLAN_VERSION = 1;

const num = z.number().refine(Number.isFinite, 'muss eine endliche Zahl sein');
/** A point as [x, y] or {x, y}. */
export const PointSchema = z.union([z.tuple([num, num]), z.object({ x: num, y: num })]).transform((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));

const StatusSchema = z.enum(['confirmed', 'estimated', 'uncertain']).optional();
const ConfidenceSchema = z.number().min(0).max(1).optional();

export const FpWallSchema = z.object({
  id: z.string().optional(),
  start: PointSchema,
  end: PointSchema,
  thickness: num.positive().optional(),
  height: num.positive().optional(),
  status: StatusSchema,
  confidence: ConfidenceSchema,
  note: z.string().max(500).optional(),
});

export const FpOpeningSchema = z
  .object({
    id: z.string().optional(),
    type: z.enum(['door', 'window', 'passage']),
    /** Id of the wall the opening sits in (requires `offset`) … */
    wall: z.string().optional(),
    /** … distance from the wall's start point to the opening CENTER. */
    offset: num.min(0).optional(),
    /** … or the opening center as a point (nearest wall is used). */
    at: PointSchema.optional(),
    width: num.positive(),
    height: num.positive().optional(),
    sillHeight: num.min(0).optional(),
    hinge: z.enum(['start', 'end']).optional(),
    swing: z.enum(['left', 'right']).optional(),
    status: StatusSchema,
    confidence: ConfidenceSchema,
    note: z.string().max(500).optional(),
  })
  .refine((o) => (o.wall !== undefined && o.offset !== undefined) || o.at !== undefined, {
    message: 'Öffnung braucht entweder "wall" + "offset" oder "at"',
  });

export const FpRoomSchema = z.object({
  id: z.string().optional(),
  name: z.string().max(100),
  /** A point inside the room; the enclosing walls define the room outline. */
  labelPoint: PointSchema.optional(),
  /** Optional clear interior outline (informational; the walls are authoritative). */
  polygon: z.array(PointSchema).min(3).optional(),
  /** Area stated on the source drawing in m² (used for verification only). */
  statedArea: num.positive().optional(),
  floorMaterial: z.string().optional(),
  status: StatusSchema,
});

export const FpFurnitureSchema = z.object({
  id: z.string().optional(),
  catalogId: z.string().optional(),
  name: z.string().max(200),
  category: z.string().default('decor'),
  position: PointSchema,
  /** Degrees, clockwise in plan view (y axis pointing down). */
  rotation: num.default(0),
  width: num.positive(),
  depth: num.positive(),
  height: num.positive(),
  elevation: num.min(0).default(0),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  price: z.object({ amount: num.min(0), status: z.enum(['confirmed', 'estimate', 'user']).default('user') }).optional(),
  productUrl: z.string().optional(),
  retailer: z.string().optional(),
  brand: z.string().optional(),
});

export const FloorPlanSchema = z.object({
  format: z.literal(FLOORPLAN_FORMAT),
  version: z.number().int().min(1),
  units: z.enum(['m', 'cm', 'mm']).default('m'),
  coordinateSystem: z
    .object({
      /** "down" (default, screen-like) or "up" (mathematical). */
      y: z.enum(['down', 'up']).default('down'),
    })
    .default({ y: 'down' }),
  name: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  defaults: z
    .object({
      wallThickness: num.positive().optional(),
      wallHeight: num.positive().optional(),
    })
    .optional(),
  walls: z.array(FpWallSchema),
  openings: z.array(FpOpeningSchema).default([]),
  rooms: z.array(FpRoomSchema).default([]),
  furniture: z.array(FpFurnitureSchema).default([]),
  sourceDrawing: z
    .object({
      fileName: z.string().optional(),
      page: z.number().int().min(1).optional(),
      scale: z.string().optional(),
      calibrated: z.boolean().optional(),
    })
    .optional(),
});

export type FloorPlanFile = z.infer<typeof FloorPlanSchema>;
