import { newId } from './ids';
import { DEFAULT_MATERIALS } from './materials';
import { DEFAULT_LEVEL_ID, DEFAULT_LEVEL_NAME, PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, SettingsSchema, type Project } from './schema';

export function createEmptyProject(name = 'Neue Wohnung'): Project {
  const now = new Date().toISOString();
  return {
    format: PROJECT_FORMAT,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: newId('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    units: 'm',
    settings: SettingsSchema.parse({}),
    nodes: [],
    walls: [],
    openings: [],
    rooms: [],
    furniture: [],
    lights: [],
    devices: [],
    automations: [],
    marks: [],
    zones: [],
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    underlay: null,
    cameraBookmarks: [],
    groups: [],
    fixtures: [],
    circuits: [],
    loads: [],
    notes: [],
    tasks: [],
    photos: [],
    audioCatalog: [],
    purchaseBudgets: {},
    levels: [{ id: DEFAULT_LEVEL_ID, name: DEFAULT_LEVEL_NAME, elevation: 0 }],
    activeLevelId: DEFAULT_LEVEL_ID,
  };
}
