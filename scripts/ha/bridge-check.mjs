// Bridge test against a running throw-away Home Assistant with `demo:` (#229):
// onboards the test instance (short-lived token, never stored), reads states and switches a demo light.
// usage: bridge-check.mjs <baseUrl>
import { createHaBridge, onboardTestInstance } from '../../src/smarthome/haBridge.ts';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8123';
const token = await onboardTestInstance(baseUrl);
const bridge = createHaBridge(baseUrl, token);
const fail = (msg) => {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
};

const states = await bridge.getStates();
const lights = states.filter((s) => s.entity_id.startsWith('light.'));
if (!lights.length) fail('the demo has no light entities');
const id = lights.find((s) => s.entity_id === 'light.bed_light')?.entity_id ?? lights[0].entity_id;
console.log(`${states.length} entities, ${lights.length} lights, switching ${id}`);

const wait = async (want) => {
  for (let i = 0; i < 20; i++) {
    if ((await bridge.getState(id)).state === want) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
await bridge.callService('light', 'turn_off', { entity_id: id });
if (!(await wait('off'))) fail(`${id} did not turn off`);
await bridge.callService('light', 'turn_on', { entity_id: id, brightness_pct: 40 });
if (!(await wait('on'))) fail(`${id} did not turn on`);
console.log('OK: bridge read states and switched the demo light');
