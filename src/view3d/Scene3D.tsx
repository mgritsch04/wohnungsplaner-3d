import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, N8AO, SMAA, ToneMapping } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { architectureKey, derivePlan } from '../model/derived';
import type { Project, QualityMode } from '../model/schema';
import { boundsOf } from '../model/vec';
import { roundMm } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { Architecture, Ground } from './Architecture';
import { FurnitureObject } from './FurnitureObject';
import { BASE_LOOK_SENSITIVITY, WalkControls } from './WalkControls';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { LightingRig } from './LightingRig';
import { usePerformanceStore } from './performanceStore';
import { CLICK_THRESHOLD_PX, setPickClipping } from './pointer';
import { buildPlacementObstacles, furnitureConflicts, moveFurnitureTo } from '../model/placement';
import { CollisionMarkers } from './CollisionMarkers';
import { useOrbitZoom, ZoomSlider } from '../ui/ZoomSlider';

export function Scene3D() {
  const project = useProjectStore((s) => s.project);
  const cameraMode = useUiStore((s) => s.cameraMode);
  const quality = project.settings.quality;
  const [locked, setLocked] = useState(false);
  const ducking = useUiStore((s) => s.walkDuck);
  const carried = useUiStore((s) => (s.walkCarry ? project.furniture.find((f) => f.id === s.walkCarry)?.name ?? null : null));
  const [webglError, setWebglError] = useState<string | null>(null);
  // pointerdown position, to tell an empty-space click (deselect) from an orbit drag
  const downAt = useRef<{ x: number; y: number } | null>(null);
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
    <div className="scene3d" data-testid="scene3d" onPointerDownCapture={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}>
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
            const d = downAt.current;
            const moved = d ? Math.hypot(e.clientX - d.x, e.clientY - d.y) : 0;
            if (e.button === 0 && cameraMode === 'orbit' && moved <= CLICK_THRESHOLD_PX) useUiStore.getState().setSelection(null);
          }}
        >
          <SceneContent project={project} quality={quality} cameraMode={cameraMode} onLockChange={setLocked} cutaway={cutaway} />
        </Canvas>
      </WebGLBoundary>
      {cameraMode === 'orbit' && <OrbitZoomSlider />}
      {cameraMode === 'walk' && <div className="crosshair" data-testid="crosshair" aria-hidden />}
      {cameraMode === 'walk' && ducking && (
        <div className="walk-duck" data-testid="walk-duck">
          ⤓ Geduckt
        </div>
      )}
      {cameraMode === 'walk' && (
        <div className="walk-overlay">
          {carried ? (
            <span>Du trägst „{carried}“ – umsehen zum Verschieben · Klick oder G: absetzen</span>
          ) : locked ? (
            <span>WASD/Pfeiltasten: gehen · Maus: umsehen · Shift: schneller · C (halten): ducken · Klick: Möbel auswählen · G: Möbel tragen · Esc: Maus freigeben</span>
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
  const { gl, camera, scene } = useThree();
  // e2e/debug hook: lets tests project world points to screen coordinates and inspect the scene
  useEffect(() => {
    const wp = (window as unknown as { __wp?: Record<string, unknown> }).__wp;
    if (wp) wp.three = { camera, canvas: gl.domElement, scene, gl };
  }, [camera, gl, scene]);

  const bounds = useMemo(() => {
    const pts = [...project.nodes, ...project.furniture.flatMap((f) => furnitureCorners(f))];
    return boundsOf(pts) ?? { minX: -3, minY: -3, maxX: 3, maxY: 3 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archKey]);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  // section cut: clip everything above 1.2 m to look into rooms from above
  useEffect(() => {
    gl.clippingPlanes = cutaway && cameraMode === 'orbit' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2)] : [];
    setPickClipping(gl.clippingPlanes);
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
  const cancelTx = useProjectStore((s) => s.cancelTransaction);
  const onDragStart = useCallback(() => {
    beginTx();
    if (orbitRef.current) orbitRef.current.enabled = false;
  }, [beginTx]);
  const obstacles = useMemo(() => buildPlacementObstacles(derived), [derived]);
  // collision feedback: recomputed only when furniture or architecture change (not per frame,
  // not for settings changes such as the time of day)
  const furnitureKey = JSON.stringify(project.furniture);
  const conflicts = useMemo(
    () => furnitureConflicts(project, derived, obstacles),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [furnitureKey, derived, obstacles],
  );
  const onDrag = useCallback(
    (id: string, x: number, y: number) =>
      updateTx((d) => {
        moveFurnitureTo(d, derived, obstacles, id, { x: roundMm(x), y: roundMm(y) }, { snap: true, collide: true });
      }),
    [updateTx, derived, obstacles],
  );
  const onDragEnd = useCallback(() => {
    commitTx();
    if (orbitRef.current) orbitRef.current.enabled = true;
  }, [commitTx]);
  const onDragCancel = useCallback(() => {
    cancelTx();
    if (orbitRef.current) orbitRef.current.enabled = true;
  }, [cancelTx]);
  const onSelectFurniture = useCallback((id: string) => setSelection({ type: 'furniture', id }), [setSelection]);
  const onSelectArch = useCallback((type: 'wall' | 'room' | 'opening', id: string) => setSelection({ type, id }), [setSelection]);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 4);

  return (
    <>
      <color attach="background" args={[quality === 'realism' ? '#dfe7ee' : '#eef1f4']} />
      <LightingRig project={project} derived={derived} quality={quality} center={center} span={span} showSky={!(cutaway && cameraMode === 'orbit')} />
      {quality === 'realism' && <EnvironmentLight />}
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
          onDragCancel={onDragCancel}
        />
      ))}
      <CollisionMarkers conflicts={conflicts} furniture={project.furniture} />
      {quality === 'realism' && (
        <EffectsBoundary>
          <RealismEffects />
        </EffectsBoundary>
      )}
      {cameraMode === 'orbit' ? (
        <OrbitCamera key="orbit" controlsRef={orbitRef} center={center} span={span} rotateSpeed={project.settings.mouseSensitivity} />
      ) : (
        <WalkControls
          key="walk"
          derived={derived}
          furniture={project.furniture}
          start={walkStart}
          sensitivity={BASE_LOOK_SENSITIVITY * project.settings.mouseSensitivity}
          eyeHeight={project.settings.eyeHeight}
          onLockChange={onLockChange}
        />
      )}
    </>
  );
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

function OrbitCamera({
  controlsRef,
  center,
  span,
  rotateSpeed,
}: {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  center: { x: number; y: number };
  span: number;
  /** Orbit rotation speed (OrbitControls default = 1). */
  rotateSpeed: number;
}) {
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
  // zoom slider (#6): report the camera distance, let the slider move the camera
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const zoom = useOrbitZoom.getState();
    const report = () => zoom.setDistance(camera.position.distanceTo(c.target));
    c.addEventListener('change', report);
    report();
    zoom.setApply((d) => {
      const dir = camera.position.clone().sub(c.target);
      camera.position.copy(c.target).add(dir.setLength(Math.max(c.minDistance, Math.min(c.maxDistance, d))));
      c.update();
      report();
    });
    return () => {
      c.removeEventListener('change', report);
      useOrbitZoom.getState().setApply(null);
    };
  }, [camera, controlsRef]);
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
      rotateSpeed={rotateSpeed}
    />
  );
}

/** Zoom slider of the 3D overview, synchronised with mouse wheel / pinch (#6). */
function OrbitZoomSlider() {
  const distance = useOrbitZoom((s) => s.distance);
  const apply = useOrbitZoom((s) => s.apply);
  const resetCamera = usePerformanceStore((s) => s.resetCamera);
  if (distance === null || !apply) return null;
  return <ZoomSlider testId="zoom-3d" label="Zoom 3D" value={distance} min={1.5} max={80} invert onChange={apply} onFit={resetCamera} />;
}

/** Neutral image-based fill light; its strength is driven by the lighting rig (time of day). */
function EnvironmentLight() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const envScene = new RoomEnvironment();
    const tex = pmrem.fromScene(envScene, 0.04).texture;
    scene.environment = tex;
    return () => {
      scene.environment = null;
      tex.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
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

/** If post-processing is unsupported on this device, keep rendering without it. */
class EffectsBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn('Nachbearbeitungseffekte nicht verfügbar – Darstellung ohne Effekte', err);
    useUiStore.getState().toast('Erweiterte Effekte werden von diesem Gerät nicht unterstützt – Realismus ohne Umgebungsverdeckung.', 'info');
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
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
