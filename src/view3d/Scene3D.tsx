import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor, Sky } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { architectureKey, derivePlan } from '../model/derived';
import type { Light, Project, QualityMode } from '../model/schema';
import { boundsOf } from '../model/vec';
import { roundMm } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Architecture, Ground } from './Architecture';
import { FurnitureObject } from './FurnitureObject';
import { WalkControls } from './WalkControls';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { kelvinToColor, sunDirection } from './lighting';
import { usePerformanceStore } from './performanceStore';

export function Scene3D() {
  const project = useProjectStore((s) => s.project);
  const cameraMode = useUiStore((s) => s.cameraMode);
  const quality = project.settings.quality;
  const [locked, setLocked] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(null);
  const cutaway = usePerformanceStore((s) => s.cutaway);
  const dprCap = usePerformanceStore((s) => s.dprCap);

  if (webglError) {
    return (
      <div className="empty-state">
        <h3>3D-Ansicht nicht verfügbar</h3>
        <p>{webglError}</p>
        <p>Der 2D-Editor funktioniert weiterhin vollständig.</p>
      </div>
    );
  }

  return (
    <div className="scene3d" data-testid="scene3d">
      <WebGLBoundary onError={setWebglError}>
        <Canvas
          shadows={quality === 'realism' ? 'soft' : false}
          dpr={quality === 'realism' ? [1, Math.min(2, dprCap)] : [1, Math.min(1.25, dprCap)]}
          camera={{ position: [4, 9, 12], fov: 50, near: 0.1, far: 500 }}
          gl={{ antialias: true, powerPreference: 'high-performance', localClippingEnabled: true }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
          frameloop="always"
          onPointerMissed={(e) => {
            if (e.button === 0 && cameraMode === 'orbit') useUiStore.getState().setSelection(null);
          }}
        >
          <SceneContent project={project} quality={quality} cameraMode={cameraMode} onLockChange={setLocked} cutaway={cutaway} />
        </Canvas>
      </WebGLBoundary>
      {cameraMode === 'walk' && (
        <div className="walk-overlay">
          {locked ? (
            <span>WASD/Pfeiltasten: gehen · Maus: umsehen · Shift: schneller · Esc: Maus freigeben</span>
          ) : (
            <span>In die Ansicht klicken, um die Maus zu fangen (oder mit gedrückter Maustaste umsehen). WASD zum Gehen.</span>
          )}
        </div>
      )}
    </div>
  );
}

function SceneContent({
  project,
  quality,
  cameraMode,
  onLockChange,
  cutaway,
}: {
  project: Project;
  quality: QualityMode;
  cameraMode: 'orbit' | 'walk';
  onLockChange: (l: boolean) => void;
  cutaway: boolean;
}) {
  const archKey = architectureKey(project);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derived = useMemo(() => derivePlan(project), [archKey]);
  const selection = useUiStore((s) => s.selection);
  const setSelection = useUiStore((s) => s.setSelection);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const { gl } = useThree();

  const bounds = useMemo(() => {
    const pts = [...project.nodes, ...project.furniture.flatMap((f) => furnitureCorners(f))];
    return boundsOf(pts) ?? { minX: -3, minY: -3, maxX: 3, maxY: 3 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archKey]);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  // section cut: clip everything above 1.2 m to look into rooms from above
  useEffect(() => {
    gl.clippingPlanes = cutaway && cameraMode === 'orbit' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2)] : [];
  }, [gl, cutaway, cameraMode]);

  // walk start: center of the selected room, else of the first room, else bounds center
  const walkStart = useMemo(() => {
    const roomId = selection?.type === 'room' ? selection.id : project.rooms[0]?.id;
    const g = roomId ? derived.rooms.get(roomId) : undefined;
    return g ? g.centroid : center;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, derived]);

  const beginTx = useProjectStore((s) => s.beginTransaction);
  const updateTx = useProjectStore((s) => s.updateTransient);
  const commitTx = useProjectStore((s) => s.commitTransaction);
  const onDragStart = useCallback(() => {
    beginTx();
    if (orbitRef.current) orbitRef.current.enabled = false;
  }, [beginTx]);
  const onDrag = useCallback(
    (id: string, x: number, y: number) =>
      updateTx((d) => {
        const f = d.furniture.find((i) => i.id === id);
        if (f) {
          f.x = roundMm(x);
          f.y = roundMm(y);
        }
      }),
    [updateTx],
  );
  const onDragEnd = useCallback(() => {
    commitTx();
    if (orbitRef.current) orbitRef.current.enabled = true;
  }, [commitTx]);
  const onSelectFurniture = useCallback((id: string) => setSelection({ type: 'furniture', id }), [setSelection]);
  const onSelectArch = useCallback((type: 'wall' | 'room' | 'opening', id: string) => setSelection({ type, id }), [setSelection]);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 4);

  return (
    <>
      <color attach="background" args={[quality === 'realism' ? '#dfe7ee' : '#eef1f4']} />
      {quality === 'realism' && !(cutaway && cameraMode === 'orbit') && <RealismSky timeOfDay={project.settings.timeOfDay} />}
      <Lights project={project} quality={quality} center={center} span={span} />
      {quality === 'realism' && <EnvironmentLight intensity={0.55} />}
      <ExposureSync exposure={project.settings.exposure} />
      <FpsMeter />
      <AdaptiveQuality />
      <Ground quality={quality} />
      <Architecture
        project={project}
        derived={derived}
        quality={quality}
        selectedId={selection?.id ?? null}
        onSelect={onSelectArch}
        showCeilings={project.settings.showCeilings || cameraMode === 'walk'}
      />
      {project.furniture.map((f) => (
        <FurnitureObject
          key={f.id}
          item={f}
          quality={quality}
          selected={selection?.type === 'furniture' && selection.id === f.id}
          onSelect={onSelectFurniture}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
        />
      ))}
      {quality === 'realism' && <RealismEffects />}
      {cameraMode === 'orbit' ? (
        <OrbitCamera key="orbit" controlsRef={orbitRef} center={center} span={span} />
      ) : (
        <WalkControls key="walk" derived={derived} furniture={project.furniture} start={walkStart} onLockChange={onLockChange} />
      )}
    </>
  );
}

/** Physically based sky matching the sun position (realism mode). */
function RealismSky({ timeOfDay }: { timeOfDay: number }) {
  const sun = sunDirection(timeOfDay);
  return <Sky distance={450} sunPosition={[sun.x * 100, sun.y * 100, sun.z * 100]} turbidity={6} rayleigh={1.2} mieCoefficient={0.005} mieDirectionalG={0.85} />;
}

/**
 * Post-processing for realism mode: screen-space ambient occlusion (contact
 * shadows in corners and under furniture), SMAA anti-aliasing and filmic tone mapping.
 * Skipped automatically when the pixel ratio was reduced for performance.
 */
function RealismEffects() {
  const dprCap = usePerformanceStore((s) => s.dprCap);
  const { gl } = useThree();
  // tone mapping happens once, in the effect chain – not additionally in the renderer
  useEffect(() => {
    const prev = gl.toneMapping;
    gl.toneMapping = THREE.NoToneMapping;
    return () => {
      gl.toneMapping = prev;
    };
  }, [gl]);
  const lowPower = dprCap < 1;
  return (
    <EffectComposer multisampling={0}>
      <N8AO aoRadius={0.6} distanceFalloff={0.6} intensity={2.2} quality={lowPower ? 'performance' : 'medium'} halfRes={lowPower} />
      <SMAA />
      <ToneMapping mode={ToneMappingMode.AGX} />
    </EffectComposer>
  );
}

function OrbitCamera({ controlsRef, center, span }: { controlsRef: React.RefObject<OrbitControlsImpl | null>; center: { x: number; y: number }; span: number }) {
  const { camera, get } = useThree();
  const resetRequest = usePerformanceStore((s) => s.cameraReset);
  const viewMode = useUiStore((s) => s.viewMode);
  useEffect(() => {
    const fit = () => {
      // fit the apartment's bounding sphere into the narrower field of view
      const size = get().size;
      const cam = camera as THREE.PerspectiveCamera;
      const vfov = THREE.MathUtils.degToRad(cam.fov);
      const aspect = size.width / Math.max(1, size.height);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const radius = span * 0.62 + 1;
      const distance = radius / Math.sin(Math.min(vfov, hfov) / 2);
      const dir = new THREE.Vector3(0.35, 0.95, 1.05).normalize();
      camera.position.set(center.x + dir.x * distance, dir.y * distance, center.y + dir.z * distance);
      camera.lookAt(center.x, 0, center.y);
      controlsRef.current?.target.set(center.x, 0.8, center.y);
      controlsRef.current?.update();
    };
    fit();
    // the canvas is resized after a layout change – fit again once it settled
    const t = setTimeout(fit, 120);
    return () => clearTimeout(t);
    // only on mount, explicit reset or layout change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetRequest, viewMode]);
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      target={[center.x, 0.8, center.y]}
      maxPolarAngle={Math.PI / 2 - 0.02}
      minDistance={0.5}
      maxDistance={200}
      enableDamping
      dampingFactor={0.12}
    />
  );
}

function Lights({ project, quality, center, span }: { project: Project; quality: QualityMode; center: { x: number; y: number }; span: number }) {
  const sun = sunDirection(project.settings.timeOfDay);
  const realism = quality === 'realism';
  const dist = span * 1.5 + 10;
  const ref = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = ref.current;
    if (!l) return;
    l.target.position.set(center.x, 0, center.y);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    const s = span * 0.8 + 2;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 0.5;
    cam.far = dist * 2.5;
    cam.updateProjectionMatrix();
  }, [center.x, center.y, span, dist]);
  const daylight = Math.max(0, sun.y);
  // limit interior point lights for performance
  const lights = project.lights.filter((l) => l.on).slice(0, realism ? 8 : 4);
  return (
    <>
      {/* realism relies on the environment map for soft fill light; planning needs a bright, even fill */}
      <hemisphereLight args={['#f4f6ff', '#b8a990', realism ? 0.18 + 0.25 * daylight : 0.55 + 0.6 * daylight]} />
      <ambientLight intensity={realism ? 0.03 : 0.15} />
      <directionalLight
        ref={ref}
        position={[center.x + sun.x * dist, Math.max(0.5, sun.y * dist), center.y + sun.z * dist]}
        intensity={(realism ? 3.2 : 1.4) * daylight + 0.05}
        color={daylight < 0.3 ? '#ffc58a' : '#fff6e8'}
        castShadow={realism}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {lights.map((l) => (
        <InteriorLight key={l.id} light={l} />
      ))}
    </>
  );
}

function InteriorLight({ light }: { light: Light }) {
  return (
    <group position={[light.x, light.elevation, light.y]}>
      <pointLight color={kelvinToColor(light.temperature)} intensity={light.intensity * 1.5} distance={8} decay={1.5} />
      <mesh>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshBasicMaterial color={kelvinToColor(light.temperature)} />
      </mesh>
    </group>
  );
}

function EnvironmentLight({ intensity }: { intensity: number }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const tex = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = tex;
    scene.environmentIntensity = intensity;
    return () => {
      scene.environment = null;
      tex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene, intensity]);
  return null;
}

function ExposureSync({ exposure }: { exposure: number }) {
  const { gl } = useThree();
  useEffect(() => {
    gl.toneMappingExposure = exposure;
  }, [gl, exposure]);
  return null;
}

/** Measures frame rate once per second (no React re-render inside the loop). */
function FpsMeter() {
  const acc = useRef({ frames: 0, time: 0 });
  const setFps = useUiStore((s) => s.setFps);
  useFrame((_, dt) => {
    acc.current.frames++;
    acc.current.time += dt;
    if (acc.current.time >= 1) {
      setFps(Math.round(acc.current.frames / acc.current.time));
      acc.current = { frames: 0, time: 0 };
    }
  });
  useEffect(() => () => setFps(null), [setFps]);
  return null;
}

/**
 * Adaptive quality: on a sustained frame-rate decline, first reduce the pixel
 * ratio; only after repeated declines suggest switching to planning mode.
 * Momentary dips are ignored by PerformanceMonitor's averaging window.
 */
function AdaptiveQuality() {
  const onDecline = usePerformanceStore((s) => s.decline);
  const onIncline = usePerformanceStore((s) => s.incline);
  return <PerformanceMonitor bounds={() => [28, 55]} flipflops={3} onDecline={onDecline} onIncline={onIncline} />;
}

class WebGLBoundary extends Component<{ onError: (msg: string) => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError(err instanceof Error ? `WebGL-Fehler: ${err.message}` : 'WebGL wird von diesem Browser/Gerät nicht unterstützt.');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
