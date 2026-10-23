import type { Automation, Project, SmartDevice } from '../model/schema';

/**
 * Export of the simulated automations as Home Assistant YAML (#170), syntax of
 * Home Assistant 2024.10+ (`triggers`/`conditions`/`actions`). Entity ids are derived
 * from the device names; after pairing real devices they have to be renamed to match
 * (or the YAML edited).
 */

export function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s || 'geraet';
}

const DOMAIN: Record<SmartDevice['kind'], string> = { motion: 'binary_sensor', presence: 'binary_sensor', contact: 'binary_sensor', light: 'light', plug: 'switch', router: 'device_tracker', strip: 'light', speaker: 'media_player' };

/** Entity id per device; duplicates get a numeric suffix. */
export function entityIds(devices: SmartDevice[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const d of devices) {
    const base = `${DOMAIN[d.kind]}.${slug(d.name)}`;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    out.set(d.id, id);
  }
  return out;
}

/** #rrggbb → [r, g, b] (LED strips, #238) */
const hexToRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

const q = (s: string) => JSON.stringify(s);
const hhmmss = (h: number) => {
  const total = Math.round(h * 3600) % 86400;
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

function automationYaml(a: Automation, ids: Map<string, string>, devices: Map<string, SmartDevice>): string[] {
  const L: string[] = [`- id: ${q(slug(a.id))}`, `  alias: ${q(a.name)}`, `  mode: restart`];
  if (!a.enabled) L.push('  initial_state: false');
  const tr = a.trigger;
  L.push('  triggers:');
  if (tr.type === 'time') L.push('    - trigger: time', `      at: ${q(hhmmss(tr.hour))}`);
  else L.push('    - trigger: state', `      entity_id: ${ids.get(tr.deviceId) ?? 'binary_sensor.unbekannt'}`, `      to: ${q(tr.type === 'contact' && tr.to === 'closed' ? 'off' : 'on')}`);
  if (a.onlyWhenDark) L.push('  conditions:', '    - condition: state', '      entity_id: sun.sun', '      state: below_horizon');
  const targets = a.action.deviceIds.filter((id) => devices.has(id) && ids.has(id));
  const target = (domain: string) => targets.filter((id) => ids.get(id)!.startsWith(`${domain}.`)).map((id) => ids.get(id)!);
  const call = (on: boolean) => {
    // a strip with its own planned colour/colour temperature gets its own call (#238)
    const planned = (id: string) => {
      const d = devices.get(id);
      return !a.action.color && d?.kind === 'strip' ? (d.color ? `rgb_color: [${hexToRgb(d.color).join(', ')}]` : d.kelvin ? `color_temp_kelvin: ${Math.round(d.kelvin)}` : null) : null;
    };
    const lights = targets.filter((id) => ids.get(id)!.startsWith('light.'));
    const own = on ? lights.filter(planned) : [];
    const groups: { ents: string[]; extra: string | null }[] = [
      { ents: lights.filter((id) => !own.includes(id)).map((id) => ids.get(id)!), extra: null },
      ...own.map((id) => ({ ents: [ids.get(id)!], extra: planned(id) })),
    ];
    for (const g of groups) {
      if (!g.ents.length) continue;
      L.push(`    - action: light.turn_${on ? 'on' : 'off'}`, '      target:', '        entity_id:', ...g.ents.map((e) => `          - ${e}`));
      const data: string[] = [];
      if (on && a.action.brightness !== undefined) data.push(`brightness_pct: ${Math.round(a.action.brightness)}`);
      if (on && a.action.color) data.push(`rgb_color: [${hexToRgb(a.action.color).join(', ')}]`);
      if (on && g.extra) data.push(g.extra);
      if (data.length) L.push('      data:', ...data.map((x) => `        ${x}`));
    }
    const sw = target('switch');
    if (sw.length) L.push(`    - action: switch.turn_${on ? 'on' : 'off'}`, '      target:', '        entity_id:', ...sw.map((e) => `          - ${e}`));
  };
  L.push('  actions:');
  call(a.action.on);
  if (tr.type === 'motion' && a.action.on && a.offAfterS !== undefined) {
    L.push(
      '    - wait_for_trigger:',
      '        - trigger: state',
      `          entity_id: ${ids.get(tr.deviceId) ?? 'binary_sensor.unbekannt'}`,
      '          to: "off"',
      '          for:',
      `            seconds: ${Math.round(a.offAfterS)}`,
    );
    call(false);
  }
  return L;
}

/** automations.yaml content for the whole project. */
export function automationsYaml(project: Pick<Project, 'devices' | 'automations' | 'name'>): string {
  const ids = entityIds(project.devices);
  const devices = new Map(project.devices.map((d) => [d.id, d]));
  const head = [
    `# Automationen aus dem Wohnungsplaner (${project.name}), simuliert – vor dem Einsatz prüfen.`,
    '# Entitäten:',
    ...project.devices.map((d) => `#   ${ids.get(d.id)}  ←  ${d.name}`),
  ];
  if (!project.automations.length) return [...head, '[]', ''].join('\n');
  return [...head, ...project.automations.flatMap((a) => automationYaml(a, ids, devices)), ''].join('\n');
}
