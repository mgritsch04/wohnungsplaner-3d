import { newId } from './ids';
import { DEFAULT_MATERIALS } from './materials';
import { PROJECT_FORMAT, PROJECT_SCHEMA_VERSION, SettingsSchema, type Project } from './schema';

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
    materials: DEFAULT_MATERIALS.map((m) => ({ ...m })),
    underlay: null,
    cameraBookmarks: [],
  };
}
