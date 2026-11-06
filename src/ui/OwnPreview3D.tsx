import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ProceduralModel } from '../view3d/ProceduralModel';
import type { ModelRef } from '../model/schema';
import { lookOf } from '../view3d/ProceduralModel';

/** Small turnable 3D view of an own object in the dialog (#493), so the stand-in can be judged before placing it. */
export default function OwnPreview3D({ shape, width, depth, height, color, model }: { shape: string; width: number; depth: number; height: number; color: string; model: ModelRef }) {
  const m = Math.max(width, depth, height, 0.2);
  const target: [number, number, number] = [0, height / 2, 0];
  return (
    <Canvas camera={{ position: [m * 1.15, height / 2 + m * 0.45, m * 1.35], fov: 38, near: 0.05, far: 60 }} dpr={[1, 1.5]} data-testid="own-preview">
      <color attach="background" args={['#eef0f2']} />
      <ambientLight intensity={1.15} />
      <directionalLight position={[3, 5, 4]} intensity={1.6} />
      <directionalLight position={[-3, 2, -2]} intensity={0.5} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]}>
        <planeGeometry args={[m * 3, m * 3]} />
        <meshStandardMaterial color="#d9dde1" />
      </mesh>
      <ProceduralModel shape={shape} width={width} depth={depth} height={height} color={color} look={lookOf(model)} quality="planning" castShadow={false} />
      <OrbitControls target={target} enablePan={false} minDistance={m * 0.6} maxDistance={m * 5} />
    </Canvas>
  );
}
