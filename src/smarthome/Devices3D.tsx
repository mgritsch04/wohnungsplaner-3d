import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Project, SmartDevice } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { blockBehind, isClick, isClippedHit } from '../view3d/pointer';
import { deviceOn } from './DeviceInfo';
import { KIND_COLOR } from './glyphs';
import { stripColor, stripPoints } from './strip';
import { useSelectedDeviceId, useSimStore } from './simStore';

const SIZE: Record<SmartDevice['kind'], [number, number, number]> = {
  motion: [0.1, 0.1, 0.05],
  presence: [0.1, 0.1, 0.05],
  contact: [0.04, 0.12, 0.03],
  plug: [0.09, 0.09, 0.06],
  light: [0.12, 0.02, 0.12],
  router: [0.16, 0.04, 0.12],
  strip: [0.05, 0.05, 0.05],
  speaker: [0.2, 0.3, 0.2],
};

/** Box size [x = fire direction (depth), y = height, z = width]; an own audio device (#336) uses its entered size. */
const ownSize = (d: SmartDevice, project: Project): [number, number, number] => {
  const def = d.kind === 'speaker' ? project.audioCatalog.find((x) => x.id === d.audioDefId) : undefined;
  return def ? [def.depthM, def.heightM, def.widthM] : SIZE[d.kind];
};

/**
 * Smart-home devices in 3D (#170, #233): housings at their mounting height that glow while
 * they report (motion, open contact, switched-on plug). A click selects the device
 * (info and actions under „Eigenschaften“); its name shows above it while selected or
 * while the Smart Home tab is open. Smart lamps get a small ceiling disc to click, the
 * light itself is the placed lamp. The simulated person is a simple figure (hidden in
 * the walkthrough, where you are the person).
 */
/** most strips that cast real light at once (each lit strip adds up to 3 weak point lights) – keeps phones and the artifact fast */
const MAX_STRIP_LIGHTS = 8;
/** distance the light source sits off the strip, towards where it shines (m) */
const OFFSET: Record<NonNullable<SmartDevice['direction']>, number> = { down: -0.06, up: 0.06, back: 0 };

/**
 * LED strip (#238): a thin glowing bar per segment at the mounting height and, while it is on,
 * a few weak point lights along the path that brighten what is below (or above) it. The
 * bar is the click target. `lights` says whether this strip may cast light (budget).
 */
function Strip3D({ d, on, brightness, color, selected, lights }: { d: SmartDevice; on: boolean; brightness: number; color: string; selected: boolean; lights: boolean }) {
  const pts = stripPoints(d);
  const dir = d.direction ?? 'down';
  const level = brightness / 100;
  const total = pts.reduce((sum, p, i) => (i ? sum + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0), 0);
  const nLights = Math.max(1, Math.min(3, Math.round(total / 1.2)));
  // evenly spaced positions along the whole path
  const lightPos = Array.from({ length: nLights }, (_, k) => {
    let want = ((k + 0.5) / nLights) * total;
    for (let i = 1; i < pts.length; i++) {
      const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      if (want <= seg || i === pts.length - 1) {
        const t = seg ? Math.min(1, want / seg) : 0;
        return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t };
      }
      want -= seg;
    }
    return pts[0];
  });
  return (
    <group name="led-strip" userData={{ strip: d.id }}>
      {pts.slice(1).map((p, i) => {
        const a = pts[i];
        const len = Math.hypot(p.x - a.x, p.y - a.y);
        if (len < 1e-3) return null;
        return (
          <mesh key={i} position={[(a.x + p.x) / 2, d.elevation, (a.y + p.y) / 2]} rotation={[0, -Math.atan2(p.y - a.y, p.x - a.x), 0]} userData={{ smartDevice: d.id }} onPointerDown={blockBehind}>
            <boxGeometry args={[len, 0.025, 0.025]} />
            <meshStandardMaterial color={on ? color : '#f8fafc'} emissive={selected ? '#2563eb' : on ? color : '#db2777'} emissiveIntensity={on ? 0.6 + 1.6 * level : selected ? 0.6 : 0.12} />
          </mesh>
        );
      })}
      {on && lights && lightPos.map((p, i) => <pointLight key={i} position={[p.x, d.elevation + OFFSET[dir], p.y]} color={color} intensity={0.35 * level} distance={2.4} decay={2} />)}
    </group>
  );
}

export function Devices3D({ project }: { project: Project }) {
  const state = useSimStore((s) => s.state);
  const person = useSimStore((s) => s.person);
  const selectedId = useSelectedDeviceId();
  const walking = useUiStore((s) => s.cameraMode === 'walk');
  const tabOpen = useUiStore((s) => s.leftTab === 'smarthome');
  const select = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (isClippedHit(e)) return;
    e.stopPropagation();
    if (isClick(e)) useUiStore.getState().setSelection({ type: 'device', id });
  };
  return (
    <group name="smarthome-devices">
      {project.devices.map((d) => {
        const { on, brightness } = deviceOn(project, d, state?.entities);
        const sel = d.id === selectedId;
        const color = KIND_COLOR[d.kind];
        if (d.kind === 'strip') {
          const pts = stripPoints(d);
          const mid = pts[Math.floor(pts.length / 2)];
          const lit = project.devices.filter((x) => x.kind === 'strip' && deviceOn(project, x, state?.entities).on);
          return (
            <group key={d.id}>
              <Strip3D d={d} on={on} brightness={brightness ?? 100} color={stripColor(d, state?.entities[d.id])} selected={sel} lights={lit.indexOf(d) < MAX_STRIP_LIGHTS / 3} />
              {(sel || (tabOpen && !walking)) && (
                <Html position={[mid.x, d.elevation + 0.14, mid.y]} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
                  <div className={sel ? 'device-label device-label-selected' : 'device-label'} data-testid="device-label-3d">
                    {d.name}
                  </div>
                </Html>
              )}
            </group>
          );
        }
        return (
          <group key={d.id} position={[d.x, d.elevation, d.y]} rotation={[0, -d.rotation, 0]}>
            <mesh userData={{ smartDevice: d.id }} onPointerDown={blockBehind} onClick={select(d.id)}>
              <boxGeometry args={ownSize(d, project)} />
              <meshStandardMaterial color={on ? color : '#f8fafc'} emissive={sel ? '#2563eb' : color} emissiveIntensity={on ? 1.2 : sel ? 0.6 : 0.15} />
            </mesh>
            {(sel || (tabOpen && !walking)) && (
              <Html position={[0, 0.14, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
                <div className={sel ? 'device-label device-label-selected' : 'device-label'} data-testid="device-label-3d">
                  {d.name}
                </div>
              </Html>
            )}
          </group>
        );
      })}
      {person && !walking && (
        <group position={[person.x, 0, person.y]} name="sim-person">
          <mesh position={[0, 0.85, 0]}>
            <capsuleGeometry args={[0.18, 1.1, 4, 12]} />
            <meshStandardMaterial color="#f97316" transparent opacity={0.85} />
          </mesh>
          <mesh position={[0, 1.65, 0]}>
            <sphereGeometry args={[0.12, 16, 12]} />
            <meshStandardMaterial color="#f97316" />
          </mesh>
        </group>
      )}
    </group>
  );
}
