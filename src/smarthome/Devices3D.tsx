import type { Project } from '../model/schema';
import { useUiStore } from '../store/uiStore';
import { useSimStore } from './simStore';

const COLOR = { motion: '#7c3aed', presence: '#9333ea', contact: '#0891b2', light: '#ca8a04', plug: '#475569' } as const;

/**
 * Smart-home devices in 3D (#170): small housings at their mounting height that glow
 * while they report (motion, open contact, switched-on plug), plus the simulated person
 * as a simple figure (hidden in the walkthrough, where you are the person).
 */
export function Devices3D({ project }: { project: Project }) {
  const state = useSimStore((s) => s.state);
  const person = useSimStore((s) => s.person);
  const walking = useUiStore((s) => s.cameraMode === 'walk');
  return (
    <group name="smarthome-devices">
      {project.devices.map((d) => {
        if (d.kind === 'light') return null; // the lamp itself is the placed light
        const on = state?.entities[d.id]?.on ?? false;
        const size: [number, number, number] = d.kind === 'contact' ? [0.03, 0.08, 0.02] : d.kind === 'plug' ? [0.06, 0.06, 0.04] : [0.06, 0.06, 0.03];
        return (
          <mesh key={d.id} position={[d.x, d.elevation, d.y]} rotation={[0, -d.rotation, 0]} userData={{ smartDevice: d.id }}>
            <boxGeometry args={size} />
            <meshStandardMaterial color={on ? COLOR[d.kind] : '#f8fafc'} emissive={COLOR[d.kind]} emissiveIntensity={on ? 1.2 : 0.05} />
          </mesh>
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
