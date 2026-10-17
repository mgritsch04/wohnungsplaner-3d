import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Project, SmartDevice } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { blockBehind, isClick, isClippedHit } from '../view3d/pointer';
import { deviceOn } from './DeviceInfo';
import { KIND_COLOR } from './glyphs';
import { useSelectedDeviceId, useSimStore } from './simStore';

const SIZE: Record<SmartDevice['kind'], [number, number, number]> = {
  motion: [0.1, 0.1, 0.05],
  presence: [0.1, 0.1, 0.05],
  contact: [0.04, 0.12, 0.03],
  plug: [0.09, 0.09, 0.06],
  light: [0.12, 0.02, 0.12],
};

/**
 * Smart-home devices in 3D (#170, #233): housings at their mounting height that glow while
 * they report (motion, open contact, switched-on plug). A click selects the device
 * (info and actions under „Eigenschaften“); its name shows above it while selected or
 * while the Smart Home tab is open. Smart lamps get a small ceiling disc to click, the
 * light itself is the placed lamp. The simulated person is a simple figure (hidden in
 * the walkthrough, where you are the person).
 */
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
        const { on } = deviceOn(project, d, state?.entities);
        const sel = d.id === selectedId;
        const color = KIND_COLOR[d.kind];
        return (
          <group key={d.id} position={[d.x, d.elevation, d.y]} rotation={[0, -d.rotation, 0]}>
            <mesh userData={{ smartDevice: d.id }} onPointerDown={blockBehind} onClick={select(d.id)}>
              <boxGeometry args={SIZE[d.kind]} />
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
