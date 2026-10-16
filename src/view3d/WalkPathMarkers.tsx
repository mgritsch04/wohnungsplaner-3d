import { useWalkPathStore } from '../editor2d/walkPathStore';

const COLOR = '#0d9488';
const noRaycast = () => null;
/** Above the floor, rugs and the narrow-passage markers. */
const Y = 0.025;

/** The measured walking path (#67) as a subtle line on the floor (one flat strip per segment). */
export function WalkPathMarkers() {
  const result = useWalkPathStore((s) => s.result);
  if (!result?.ok) return null;
  const pts = result.points;
  return (
    <group name="walk-path">
      {pts.slice(1).map((b, i) => {
        const a = pts[i];
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        return (
          <group key={i} position={[(a.x + b.x) / 2, Y, (a.y + b.y) / 2]} rotation={[0, -Math.atan2(b.y - a.y, b.x - a.x), 0]}>
            <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={3}>
              <planeGeometry args={[len + 0.08, 0.08]} />
              <meshBasicMaterial color={COLOR} transparent opacity={0.7} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
