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
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import { Architecture, Ground } from './Architecture';
import { FurnitureObject } from './FurnitureObject';
import { BASE_LOOK_SENSITIVITY, WalkControls } from './WalkControls';
import { furnitureCorners } from '../editor2d/furnitureGeometry';
import { LightingRig } from './LightingRig';
import { usePerformanceStore } from './performanceStore';
import { CLICK_THRESHOLD_PX, setPickClipping } from './pointer';
import { requestLampShadowUpdate } from './lampRegistry';
import { buildPlacementObstacles, furnitureConflicts, furnitureSnapOptions, moveFurnitureTo } from '../model/placement';
import { groupOf, moveGroupBy, selectedGroup } from '../model/groups';
import { pressFurnitureSelection, selectSingleFurniture } from '../ui/groupActions';
import { snapToGrid } from '../model/operations';
import { CollisionMarkers } from './CollisionMarkers';
import { NarrowPassageMarkers } from './NarrowPassageMarkers';
import { WalkPathMarkers } from './WalkPathMarkers';
import { TapeMeasure3D } from './TapeMeasure3D';
import { CatalogDrop3D } from './CatalogDrop3D';
import { TapeMeasureButton } from './TapeMeasureButton';
import { useOrbitZoom, ZoomSlider } from '../ui/ZoomSlider';
import { toggleOpening } from '../ui/actions';
import { BookmarksMenu } from './BookmarksMenu';
import { CameraBookmarkDriver } from './CameraBookmarkDriver';
import { orbitFitSuppressed, registerOrbitRig } from './cameraBookmarks';
import { useCompareStore, type CompareSide } from '../versions/compareStore';
import type { FurnitureDiff } from '../versions/diff';
import { CompareBar } from '../versions/CompareBar';
import { CompareMarkers } from './CompareMarkers';
import { FurnishPreview3D } from './FurnishPreview3D';
import { orbitKeyInput, orbitKeyMoves, orbitKeySpeed, orbitPlaneStep, setPointerOver3d } from './orbitKeys';
import { useDialogStore } from '../ui/dialogStore';
import { usePhoneLayout, useTouchUi } from '../ui/phoneLayout';
import { TouchWalkPad } from './TouchWalkPad';

/** Read-only preview of a before/after comparison (#76): which state is shown and its markings. */
interface ComparePreview {
  side: CompareSide;
  diff: FurnitureDiff;
}

const noop = () => {};
const NO_IDS: string[] = [];

export function Scene3D() {
  const storeProject = useProjectStore((s) => s.project);
  // before/after comparison (#76): show a saved state instead of the project – read only,
  // the project store is not touched; the camera (and its framing) stays the same for A and B
  const session = useCompareStore((s) => s.session);
  const showing = useCompareStore((s) => s.showing);
  const project = session ? session[showing].project : storeProject;
  const compare = useMemo<ComparePreview | null>(() => (session ? { side: showing, diff: session.diff } : null), [session, showing]);
  const uiCameraMode = useUiStore((s) => s.cameraMode);
  const cameraMode = session ? 'orbit' : uiCameraMode;
  const quality = storeProject.settings.quality;
  const [locked, setLocked] = useState(false);
  const ducking = useUiStore((s) => s.walkDuck);
  const carried = useUiStore((s) => (s.walkCarry ? storeProject.furniture.find((f) => f.id === s.walkCarry)?.name ?? null : null));
  const [webglError, setWebglError] = useState<string | null>(null);
  // pointerdown position, to tell an empty-space click (deselect) from an orbit drag
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const cutaway = usePerformanceStore((s) => s.cutaway);
  const dprCap = usePerformanceStore((s) => s.dprCap);
  // phones/tablets (#164): stick + finger look instead of WASD and mouse
  const touchUi = useTouchUi();

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
    <div
      className="scene3d"
      data-testid="scene3d"
      onPointerDownCapture={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
      // the middle button turns the view (#132) – no browser auto-scroll / paste
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onPointerEnter={() => setPointerOver3d(true)}
      onPointerLeave={() => setPointerOver3d(false)}
      // a long press must not open the browser's image/context menu over the 3D view (#164)
      onContextMenu={(e) => e.preventDefault()}
    >
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
            if (e.button === 0 && cameraMode === 'orbit' && !compare && moved <= CLICK_THRESHOLD_PX) useUiStore.getState().setSelection(null);
          }}
        >
          <SceneContent project={project} frame={storeProject} compare={compare} quality={quality} cameraMode={cameraMode} onLockChange={setLocked} cutaway={cutaway} />
        </Canvas>
      </WebGLBoundary>
      {cameraMode === 'orbit' && <OrbitZoomSlider />}
      {cameraMode === 'orbit' && <OrbitHelp />}
      {/* saving a view changes the project – not offered while comparing (Alt+1 … 9 still jumps) */}
      {!session && <BookmarksMenu />}
      {!session && <TapeMeasureButton />}
      {session && <CompareBar />}
      {cameraMode === 'walk' && <div className="crosshair" data-testid="crosshair" aria-hidden />}
      {cameraMode === 'walk' && ducking && (
        <div className="walk-duck" data-testid="walk-duck">
          ⤓ Geduckt
        </div>
      )}
      {cameraMode === 'walk' && touchUi && <TouchWalkPad />}
      {cameraMode === 'walk' && touchUi && (
        <div className="walk-overlay">
          {carried ? (
            <span>Du trägst „{carried}“ – umsehen zum Verschieben · „Absetzen“ stellt es ab</span>
          ) : (
            <span>Finger ziehen: umsehen · Stick: gehen · Tippen: Möbel auswählen, Tür/Fenster öffnen</span>
          )}
        </div>
      )}
      {cameraMode === 'walk' && !touchUi && (
        <div className="walk-overlay">
          {carried ? (
            <span>Du trägst „{carried}“ – umsehen zum Verschieben · Klick oder G: absetzen</span>
          ) : locked ? (
            <span>WASD/Pfeiltasten: gehen · Maus: umsehen · Shift: schneller · C: ducken an/aus · Klick: Möbel auswählen · E (oder Klick, O): Tür/Fenster öffnen/schließen · G: Möbel tragen · Esc: Maus freigeben</span>
          ) : (
            <span>In die Ansicht klicken, um die Maus zu fangen (oder mit gedrückter Maustaste umsehen). WASD zum Gehen, E öffnet/schließt Tür oder Fenster im Fadenkreuz.</span>
          )}
        </div>
      )}
    </div>
  );
}

function SceneContent({
  project,
  frame,
  compare,
  quality,
  cameraMode,
  onLockChange,
  cutaway,
}: {
  /** The project shown (the store project, or a read-only state while comparing). */
  project: Project;
  /** The project that frames the camera (always the store project, so A and B share one view). */
  frame: Project;
  /** Before/after comparison: read-only preview with markings. */
  compare: ComparePreview | null;
  quality: QualityMode;
  cameraMode: 'orbit' | 'walk';
  onLockChange: (l: boolean) => void;
  cutaway: boolean;
}) {
  const archKey = architectureKey(project);
  const frameKey = architectureKey(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const derived = useMemo(() => derivePlan(project), [archKey]);
  const readOnly = compare !== null;
  const uiSelection = useUiStore((s) => s.selection);
  const uiMulti = useUiStore((s) => s.multi);
  const selection = readOnly ? null : uiSelection;
  const multi = readOnly ? NO_IDS : uiMulti;
  const setSelection = useUiStore((s) => s.setSelection);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);
  const { gl, camera, scene } = useThree();
  // e2e/debug hook: lets tests project world points to screen coordinates and inspect the scene
  useEffect(() => {
    const wp = (window as unknown as { __wp?: Record<string, unknown> }).__wp;
    if (wp) wp.three = { camera, canvas: gl.domElement, scene, gl };
  }, [camera, gl, scene]);

  const bounds = useMemo(() => {
    const pts = [...frame.nodes, ...frame.furniture.flatMap((f) => furnitureCorners(f))];
    return boundsOf(pts) ?? { minX: -3, minY: -3, maxX: 3, maxY: 3 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);
  const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };

  // section cut: clip everything above 1.2 m to look into rooms from above
  useEffect(() => {
    gl.clippingPlanes = cutaway && cameraMode === 'orbit' ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.2)] : [];
    setPickClipping(gl.clippingPlanes);
  }, [gl, cutaway, cameraMode]);

  // lamp shadow maps are cached (#130): re-render them when walls, doors, furniture or the cut change
  useEffect(() => {
    requestLampShadowUpdate();
  }, [project, derived, cutaway, cameraMode]);

  // walk start: center of the selected room, else of the first room, else bounds center.
  // Fixed when the walk begins (or another project is opened): edits while walking (opening a
  // door, selecting furniture) must not move the walker back to the start and reset the view (#142)
  const walkStart = useMemo(() => {
    const roomId = selection?.type === 'room' ? selection.id : project.rooms[0]?.id;
    const g = roomId ? derived.rooms.get(roomId) : undefined;
    return g ? g.centroid : center;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraMode, project.id]);

  const beginTx = useProjectStore((s) => s.beginTransaction);
  const updateTx = useProjectStore((s) => s.updateTransient);
  const commitTx = useProjectStore((s) => s.commitTransaction);
  const cancelTx = useProjectStore((s) => s.cancelTransaction);
  const onDragStart = useCallback(() => beginTx(), [beginTx]);
  // pressing on a movable item belongs to that item (#132): the left button must not turn the
  // view while it is grabbed. Only rotate/pan are paused, so damping and the wheel keep working
  // and the view does not jump when the item is released.
  const onPressFurniture = useCallback((down: boolean) => {
    const c = orbitRef.current;
    if (!c) return;
    c.enableRotate = !down;
    c.enablePan = !down;
  }, []);
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
    (id: string, x: number, y: number, free: boolean) =>
      updateTx((d) => {
        // same snapping choice as in 2D (#52); Alt = free placement, as in 2D (#16)
        const fs = furnitureSnapOptions(d.settings.furnitureSnap, free);
        const p = fs.grid ? snapToGrid({ x, y }, fs.grid) : { x, y };
        // a selected furniture group (#65) moves rigidly, collision-checked as a whole
        const ids = selectedFurnitureIds(useUiStore.getState());
        const cur = d.furniture.find((f) => f.id === id);
        if (cur && ids.includes(id) && selectedGroup(d, ids)) {
          moveGroupBy(d, obstacles, ids, { x: roundMm(p.x) - cur.x, y: roundMm(p.y) - cur.y }, { collide: !free });
          return;
        }
        moveFurnitureTo(d, derived, obstacles, id, { x: roundMm(p.x), y: roundMm(p.y) }, { snap: fs.walls, collide: !free });
      }),
    [updateTx, derived, obstacles],
  );
  const onDragEnd = useCallback(() => commitTx(), [commitTx]);
  const onDragCancel = useCallback(() => cancelTx(), [cancelTx]);
  // furniture groups (#65): a click on a member selects the whole group, a second click (no drag) the item
  const drillRef = useRef<string | null>(null);
  const onSelectFurniture = useCallback(
    (id: string) => {
      drillRef.current = null;
      if (groupOf(useProjectStore.getState().project, id)) drillRef.current = pressFurnitureSelection(id, false);
      else setSelection({ type: 'furniture', id });
    },
    [setSelection],
  );
  const onClickFurniture = useCallback((id: string) => {
    if (drillRef.current === id) selectSingleFurniture(id);
    drillRef.current = null;
  }, []);
  const onSelectArch = useCallback((type: 'wall' | 'room' | 'opening', id: string) => setSelection({ type, id }), [setSelection]);
  const onToggleOpening = useCallback((id: string) => void toggleOpening(id), []);

  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 4);
  // walking by touch (#164): a finger on the view looks around and a tap acts at the crosshair –
  // furniture under the finger must not be dragged along, walls/floors not selected
  const touchUi = useTouchUi();
  const walkTouch = cameraMode === 'walk' && touchUi;

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
        onSelect={readOnly || walkTouch ? noop : onSelectArch}
        // walkthrough: doors/windows are opened by clicking at the crosshair (WalkControls)
        onToggleOpening={cameraMode === 'orbit' && !readOnly ? onToggleOpening : undefined}
        showCeilings={project.settings.showCeilings || cameraMode === 'walk'}
      />
      {project.furniture.map((f) => (
        <FurnitureObject
          key={f.id}
          item={f}
          quality={quality}
          selected={(selection?.type === 'furniture' && selection.id === f.id) || multi.includes(f.id)}
          onSelect={onSelectFurniture}
          onClickRelease={onClickFurniture}
          onPress={onPressFurniture}
          onDragStart={onDragStart}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
          readOnly={readOnly || walkTouch}
        />
      ))}
      {compare && <CompareMarkers diff={compare.diff} side={compare.side} />}
      {!readOnly && <FurnishPreview3D />}
      <FitOnCompareLayout comparing={readOnly} />
      <PhoneSheetFov enabled={cameraMode === 'orbit'} />
      <CollisionMarkers conflicts={conflicts} furniture={project.furniture} />
      <NarrowPassageMarkers project={project} derived={derived} />
      <WalkPathMarkers />
      <TapeMeasure3D />
      {!readOnly && cameraMode === 'orbit' && <CatalogDrop3D />}
      {quality === 'realism' && (
        <EffectsBoundary>
          <RealismEffects />
        </EffectsBoundary>
      )}
      <CameraBookmarkDriver />
      {cameraMode === 'orbit' ? (
        <>
          <OrbitCamera key="orbit" controlsRef={orbitRef} center={center} span={span} rotateSpeed={project.settings.mouseSensitivity} />
          <OrbitKeyControls controlsRef={orbitRef} comparing={readOnly} />
        </>
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
 * The comparison (#76) is shown in the full workspace. Coming from (or going back to) the
 * split view, the canvas changes its size: fit the apartment once the new size arrived.
 * Switching between A and B never re-fits – both are seen from the same camera.
 */
function FitOnCompareLayout({ comparing }: { comparing: boolean }) {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const prev = useRef(comparing);
  const pendingUntil = useRef(0);
  useEffect(() => {
    if (prev.current === comparing) return;
    prev.current = comparing;
    if (useUiStore.getState().viewMode === 'split') pendingUntil.current = performance.now() + 2000;
  }, [comparing]);
  useEffect(() => {
    if (performance.now() > pendingUntil.current) return;
    pendingUntil.current = 0;
    usePerformanceStore.getState().resetCamera();
  }, [width, height]);
  return null;
}

/** Vertical field of view of the overview camera (degrees) – same as the Canvas default. */
const ORBIT_FOV = 50;

/**
 * Phone (#164): opening the Werkzeuge/Details sheet makes the 3D view shorter. Keeping the
 * vertical field of view would shrink the whole apartment; instead the view is only cut at the
 * top and bottom – the camera stays where the user turned it and things keep their size.
 */
function PhoneSheetFov({ enabled }: { enabled: boolean }) {
  const phone = usePhoneLayout();
  const camera = useThree((s) => s.camera);
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  const full = useRef({ width: 0, height: 0 });
  useEffect(() => {
    if (!phone || !enabled || height < 1) return;
    const cam = camera as THREE.PerspectiveCamera;
    const f = full.current;
    // the tallest view seen at this width is the one without a sheet (rotating the phone starts over)
    if (width !== f.width || height > f.height) full.current = { width, height };
    const k = height / full.current.height;
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(ORBIT_FOV / 2)) * k));
    cam.updateProjectionMatrix();
    return () => {
      cam.fov = ORBIT_FOV;
      cam.updateProjectionMatrix();
    };
  }, [phone, enabled, camera, width, height]);
  return null;
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
      if (orbitFitSuppressed()) return; // a camera bookmark (#55) is being shown
      // fit the apartment's bounding sphere into the narrower field of view
      const size = get().size;
      const cam = camera as THREE.PerspectiveCamera;
      const vfov = THREE.MathUtils.degToRad(cam.fov);
      const aspect = size.width / Math.max(1, size.height);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const radius = span * 0.62 + 1;
      const distance = radius / Math.sin(Math.min(vfov, hfov) / 2);
      const dir = new THREE.Vector3(0.35, 0.95, 1.05).normalize();
      if (controlsRef.current) stopOrbitMotion(controlsRef.current);
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
    // camera bookmarks (#55) read and set the pose
    const unregister = registerOrbitRig({
      get: () => ({ position: camera.position.clone(), target: c.target.clone() }),
      set: (p, t) => {
        stopOrbitMotion(c);
        camera.position.set(p.x, p.y, p.z);
        c.target.set(t.x, t.y, t.z);
        c.update();
      },
    });
    return () => {
      unregister();
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
      // #132: the wheel zooms towards the mouse pointer; left or middle button turns the view,
      // right button moves it (Shift/Strg + left button moves, too)
      zoomToCursor
      mouseButtons={ORBIT_MOUSE_BUTTONS}
    />
  );
}

/**
 * Drop the remaining damped motion of the last drag (#132): otherwise a reset or a jump to a
 * saved view keeps drifting afterwards. One undamped update consumes it; the caller then sets
 * the new pose.
 */
function stopOrbitMotion(c: OrbitControlsImpl) {
  const damping = c.enableDamping;
  c.enableDamping = false;
  c.update();
  c.enableDamping = damping;
}

const ORBIT_MOUSE_BUTTONS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };

/** W A S D / arrow keys move the overview camera in the floor plane (#132). */
function OrbitKeyControls({ controlsRef, comparing }: { controlsRef: React.RefObject<OrbitControlsImpl | null>; comparing: boolean }) {
  const held = useRef(new Set<string>());
  const fast = useRef(false);
  useEffect(() => {
    const keys = held.current;
    const onDown = (e: KeyboardEvent) => {
      fast.current = e.shiftKey;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey || useDialogStore.getState().modal) return;
      const ui = useUiStore.getState();
      const ctx = { viewMode: ui.viewMode, cameraMode: ui.cameraMode, furnitureSelected: ui.selection?.type === 'furniture', comparing };
      if (!orbitKeyMoves(e.code, ctx)) return;
      e.preventDefault(); // no page scrolling with the arrow keys
      keys.add(e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      fast.current = e.shiftKey;
      keys.delete(e.code);
    };
    const clear = () => keys.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', clear);
      clear();
    };
  }, [comparing]);
  useFrame(({ camera }, dt) => {
    const c = controlsRef.current;
    if (!c || held.current.size === 0) return;
    const input = orbitKeyInput(held.current);
    if (input[0] === 0 && input[1] === 0) return;
    // dt is capped so a stalled frame (tab switch) never throws the camera far away
    const step = orbitKeySpeed(camera.position.distanceTo(c.target), fast.current) * Math.min(dt, 0.1);
    const d = orbitPlaneStep(camera, input, step);
    camera.position.add(d);
    c.target.add(d);
    c.update();
  });
  return null;
}

/** Short overview of the 3D overview controls (#132); the full list is in the keyboard help (#59). */
function OrbitHelp() {
  const openModal = useDialogStore((s) => s.openModal);
  return (
    <details className="orbit-help" data-testid="orbit-help" onPointerDown={(e) => e.stopPropagation()}>
      <summary>Steuerung</summary>
      <ul>
        <li>
          <b>Linke oder mittlere Maustaste</b> + Ziehen: Ansicht drehen
        </li>
        <li>
          <b>Rechte Maustaste</b> (oder Umschalt + linke) + Ziehen: Ansicht verschieben
        </li>
        <li>
          <b>Mausrad</b>: zum Mauszeiger hin zoomen
        </li>
        <li>
          <b>W A S D / Pfeiltasten</b>: Ansicht bewegen (Umschalt: schneller; Pfeiltasten verschieben ein ausgewähltes Möbel)
        </li>
        <li>
          <b>Möbel</b> mit der linken Maustaste ziehen – die Ansicht bleibt dabei stehen
        </li>
      </ul>
      <button type="button" onClick={() => openModal('help')}>
        Alle Tastenkürzel (?)
      </button>
    </details>
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
