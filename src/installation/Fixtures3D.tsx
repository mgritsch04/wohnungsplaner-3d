import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { fixtureCenterZ, fixtureLabel, fixtureSize } from '../model/fixtures';
import type { Fixture, Project } from '../model/schema';
import { planRotationToWorldY } from '../model/units';
import { useUiStore } from '../store/uiStore';
import { blockBehind, isClick, isClippedHit } from '../view3d/pointer';
import { FIXTURE_COLOR } from './glyphs';

/**
 * Installation plan in 3D (#64, #81): sockets and switches as wall plates, radiators as ribbed
 * panels, water connections as chrome angle valves, waste-water connections as grey pipe
 * stubs – at their mounting height, also in the walkthrough. A click selects the item.
 */
export function Fixtures3D({ project }: { project: Project }) {
  const selection = useUiStore((s) => s.selection);
  if (!project.fixtures.length) return null;
  const select = (id: string) => (e: ThreeEvent<MouseEvent>) => {
    if (isClippedHit(e)) return;
    e.stopPropagation();
    if (isClick(e)) useUiStore.getState().setSelection({ type: 'fixture', id });
  };
  return (
    <group name="installation-fixtures">
      {project.fixtures.map((f) => {
        const sel = selection?.type === 'fixture' && selection.id === f.id;
        return (
          <group
            key={f.id}
            name={`fixture:${f.kind}`}
            position={[f.x, fixtureCenterZ(f), f.y]}
            rotation={[0, planRotationToWorldY(f.rotation), 0]}
            userData={{ fixtureId: f.id }}
            onPointerDown={blockBehind}
            onClick={select(f.id)}
          >
            <FixtureBody f={f} selected={sel} />
            {sel && (
              <Html position={[0, fixtureSize(f).height / 2 + 0.08, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: 'none' }}>
                <div className="device-label device-label-selected" data-testid="fixture-label-3d">
                  {fixtureLabel(f)}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

/** Local frame: x along the wall, y up, z out of the wall (the back touches the wall at z = -depth/2). */
function FixtureBody({ f, selected }: { f: Fixture; selected: boolean }) {
  const s = fixtureSize(f);
  const glow = selected ? { emissive: '#2563eb', emissiveIntensity: 0.5 } : {};
  const accent = FIXTURE_COLOR[f.kind];
  switch (f.kind) {
    case 'socket':
    case 'switch': {
      const n = f.kind === 'socket' ? f.count : 1;
      const step = s.width / n;
      return (
        <>
          <mesh>
            <boxGeometry args={[s.width, s.height, s.depth]} />
            <meshStandardMaterial color="#f8fafc" roughness={0.4} {...glow} />
          </mesh>
          {Array.from({ length: n }, (_, i) => (
            <mesh key={i} position={[-s.width / 2 + step * (i + 0.5), 0, s.depth / 2 + 0.001]} rotation={f.kind === 'socket' ? [Math.PI / 2, 0, 0] : [0, 0, 0]}>
              {f.kind === 'socket' ? <cylinderGeometry args={[0.022, 0.022, 0.004, 20]} /> : <boxGeometry args={[0.05, 0.05, 0.006]} />}
              <meshStandardMaterial color={f.kind === 'socket' ? '#cbd5e1' : '#e2e8f0'} roughness={0.5} {...glow} />
            </mesh>
          ))}
          <mesh position={[0, -s.height / 2 - 0.006, s.depth / 2]}>
            <boxGeometry args={[Math.min(0.03, s.width), 0.004, 0.002]} />
            <meshBasicMaterial color={accent} />
          </mesh>
        </>
      );
    }
    case 'radiator': {
      const ribs = Math.max(4, Math.round(s.width / 0.05));
      return (
        <>
          <mesh position={[0, 0, -s.depth / 4]}>
            <boxGeometry args={[s.width, s.height, s.depth / 2]} />
            <meshStandardMaterial color="#f1f5f9" roughness={0.35} {...glow} />
          </mesh>
          {Array.from({ length: ribs }, (_, i) => (
            <mesh key={i} position={[-s.width / 2 + (s.width / ribs) * (i + 0.5), 0, s.depth / 4]}>
              <boxGeometry args={[(s.width / ribs) * 0.6, s.height * 0.96, s.depth / 2]} />
              <meshStandardMaterial color="#f8fafc" roughness={0.35} {...glow} />
            </mesh>
          ))}
        </>
      );
    }
    case 'water':
      return (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.012, 0.012, s.depth, 16]} />
            <meshStandardMaterial color="#d1d5db" metalness={0.9} roughness={0.2} {...glow} />
          </mesh>
          <mesh position={[0, 0.018, s.depth / 4]}>
            <cylinderGeometry args={[0.014, 0.014, 0.012, 16]} />
            <meshStandardMaterial color={accent} roughness={0.5} {...glow} />
          </mesh>
        </>
      );
    case 'drain':
      return (
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[s.width / 2, s.width / 2, s.depth, 20]} />
          <meshStandardMaterial color="#9ca3af" roughness={0.6} {...glow} />
        </mesh>
      );
  }
}
