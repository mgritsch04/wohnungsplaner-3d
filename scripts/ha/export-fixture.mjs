// Writes the planner's Home Assistant export for a small sample project into <outDir> (#229):
//   good/automations.yaml   – must pass `check_config`
//   broken/automations.yaml – deliberately broken, must make `check_config` fail
// Run with Node >= 22 (runs the TypeScript export directly).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { automationsYaml } from '../../src/smarthome/haYaml.ts';

const outDir = process.argv[2];
if (!outDir) throw new Error('usage: export-fixture.mjs <outDir>');

const dev = (id, name, kind) => ({ id, name, kind, x: 0, y: 0, elevation: 1, rotation: 0 });
const project = {
  name: 'CI-Beispiel',
  devices: [dev('d1', 'Flur Bewegung', 'motion'), dev('d2', 'Flurlicht', 'light'), dev('d3', 'Tür Balkon', 'contact'), dev('d4', 'Steckdose Lampe', 'plug')],
  automations: [
    { id: 'a1', name: 'Flurlicht bei Bewegung', enabled: true, trigger: { type: 'motion', deviceId: 'd1' }, onlyWhenDark: true, action: { deviceIds: ['d2'], on: true, brightness: 60 }, offAfterS: 120 },
    { id: 'a2', name: 'Lampe abends', enabled: true, trigger: { type: 'time', hour: 18.5 }, onlyWhenDark: false, action: { deviceIds: ['d4'], on: true } },
    { id: 'a3', name: 'Balkontür offen', enabled: true, trigger: { type: 'contact', deviceId: 'd3', to: 'open' }, onlyWhenDark: false, action: { deviceIds: ['d2'], on: false } },
  ],
};

const good = automationsYaml(project);
const broken = good.replace('  actions:', '  aktionen_kaputt:');
if (broken === good) throw new Error('fixture could not be broken');
for (const [dir, content] of [['good', good], ['broken', broken]]) {
  mkdirSync(join(outDir, dir), { recursive: true });
  writeFileSync(join(outDir, dir, 'automations.yaml'), content);
}
