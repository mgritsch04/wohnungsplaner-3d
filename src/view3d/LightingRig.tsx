import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Light, Project, QualityMode } from '../model/schema';
import { add, pointInPolygon, scale } from '../model/vec';
import { approachHour, kelvinToColor, lampLevel, lightingAt, type LightingState } from './lighting';
import { flushLampShadowUpdates, registerShadowLamp, setLampLevel } from './lampRegistry';
import { useUiStore } from '../store/uiStore';
import { useSimLightOverrides } from '../smarthome/simStore';

/**
 * Smoothing time constant (s) of the displayed time behind the slider: short enough to
 * feel immediate, long enough to soften preset jumps. Frame-rate independent.
 */
const BLEND_TAU = 0.05;
const MAX_WINDOW_LIGHTS = 10;
const MAX_ROOM_LIGHTS = 12;
/** Automatic ceiling light of rooms without own lamps (when lamps are on). */
const ROOM_LIGHT_INTENSITY = 5;

interface Props {
  project: Project;
  derived: DerivedPlan;
  quality: QualityMode;
  center: { x: number; y: number };
  span: number;
  /** Skip the sky dome (e.g. in the section view). */
  showSky: boolean;
}

/**
 * All lighting of the 3D scene. Realism mode follows the time of day: sun
 * position/colour/shadows, sky, diffuse environment, light through windows and
 * automatic room lights at night. Changes of the time blend smoothly; updates are
 * applied imperatively in the render loop, so moving the slider does not rebuild the scene.
 * Planning mode uses fixed, bright daylight for readability.
 */
export function LightingRig({ project, derived, quality, center, span, showSky }: Props) {
  const realism = quality === 'realism';
  const { scene, gl } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const configuredRefs = useRef<(THREE.PointLight | null)[]>([]);
  const skyRef = useRef<THREE.Mesh>(null);
  const windowRefs = useRef<(THREE.PointLight | null)[]>([]);
  const roomRefs = useRef<(THREE.PointLight | null)[]>([]);
  const current = useRef<number | null>(null);
  const applied = useRef<string>('');
  const dist = span * 1.5 + 10;
  const target = project.settings.timeOfDay;
  const exposure = project.settings.exposure;
  const lampMode = project.settings.lamps;

  // shadow camera covering the apartment
  useEffect(() => {
    const l = sunRef.current;
    if (!l) return;
    l.target.position.set(center.x, 0, center.y);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera as THREE.OrthographicCamera;
    const s = span * 0.8 + 2;
    Object.assign(cam, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: dist * 2.5 });
    cam.updateProjectionMatrix();
  }, [center.x, center.y, span, dist]);

  // windows: a soft fill light just inside each window (daylight entering the room)
  const windowLights = useMemo(() => {
    const roomPolys = [...derived.rooms.values()].map((g) => g.interior);
    const out: { pos: [number, number, number]; area: number }[] = [];
    for (const [wallId, list] of derived.openings) {
      const fp = derived.footprints.get(wallId);
      if (!fp) continue;
      for (const r of list) {
        if (r.opening.kind !== 'window') continue;
        const mid = add(fp.a, scale(fp.dir, (r.s0 + r.s1) / 2));
        for (const s of [1, -1]) {
          const inside = add(mid, scale(fp.normal, s * (fp.thickness / 2 + 0.6)));
          if (roomPolys.some((poly) => pointInPolygon(inside, poly))) {
            out.push({ pos: [inside.x, (r.bottom + r.top) / 2, inside.y], area: (r.s1 - r.s0) * (r.top - r.bottom) });
          }
        }
      }
    }
    return out.sort((a, b) => b.area - a.area).slice(0, MAX_WINDOW_LIGHTS);
  }, [derived]);

  // rooms without any own light source get an automatic ceiling light (used at dusk/night)
  const sim = useSimLightOverrides(project);
  const simKey = sim ? [...sim.keys()].sort().join(',') : '';
  const simControlled = useMemo(() => new Set(simKey ? simKey.split(',') : []), [simKey]);
  const roomLights = useMemo(() => {
    const out: { pos: [number, number, number]; reach: number }[] = [];
    const lampShapes = new Set(['floor-lamp', 'table-lamp', 'pendant']);
    for (const room of project.rooms) {
      const g = derived.rooms.get(room.id);
      if (!g) continue;
      const hasLight =
        project.lights.some((l) => (l.on || simControlled.has(l.id)) && pointInPolygon(l, g.interior)) ||
        project.furniture.some((f) => f.model.type === 'procedural' && lampShapes.has(f.model.shape) && pointInPolygon(f, g.interior));
      if (hasLight) continue;
      // reach ≈ distance to the farthest room corner; shadows (within the lamp budget) stop the rest at walls (#130)
      const reach = Math.max(...g.interior.map((p) => Math.hypot(p.x - g.centroid.x, p.y - g.centroid.y))) + 0.8;
      out.push({ pos: [g.centroid.x, project.settings.defaultWallHeight - 0.35, g.centroid.y], reach });
    }
    return out.slice(0, MAX_ROOM_LIGHTS);
  }, [project.rooms, project.lights, project.furniture, project.settings.defaultWallHeight, derived, simControlled]);

  // smart-home simulation (#170): simulated lamps follow their automation, also by day
  const configured = project.lights
    .map((l) => {
      const o = sim?.get(l.id);
      return o ? { ...l, on: o.on, intensity: (l.intensity * o.brightness) / 100, sim: true } : { ...l, sim: false };
    })
    .filter((l) => l.on)
    .slice(0, realism ? 8 : 4);
  const configuredKey = configured.map((l) => `${l.id}:${l.intensity}:${l.sim}`).join(',');

  const apply = (st: LightingState) => {
    const sun = sunRef.current;
    if (sun) {
      sun.position.set(center.x + st.sun.x * dist, Math.max(0.5, st.sun.y * dist), center.y + st.sun.z * dist);
      sun.color.set(st.sunColor);
      sun.intensity = realism ? 3.4 * st.sunStrength : 1.4;
      sun.castShadow = realism && st.sunStrength > 0.02;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.set(realism ? st.skyColor : '#f4f6ff');
      hemi.groundColor.set(realism ? st.groundColor : '#b8a990');
      hemi.intensity = realism ? 0.35 * st.ambientStrength : 1.0;
    }
    if (ambientRef.current) ambientRef.current.intensity = realism ? 0.02 * st.ambientStrength : 0.15;
    scene.environmentIntensity = realism ? 0.6 * st.ambientStrength : 0;
    // lamps (lamp furniture, placed lights, automatic room lights) share one switch
    const lamps = realism ? lampLevel(lampMode, st) : 1;
    setLampLevel(lamps);
    configured.forEach((l, i) => {
      const pl = configuredRefs.current[i];
      if (pl) pl.intensity = interiorIntensity(l) * (l.sim ? 1 : lamps);
    });
    if (realism) {
      windowLights.forEach((w, i) => {
        const l = windowRefs.current[i];
        if (l) l.intensity = st.daylight * Math.min(3, 0.9 * w.area);
      });
      roomLights.forEach((_, i) => {
        const l = roomRefs.current[i];
        if (l) l.intensity = ROOM_LIGHT_INTENSITY * lamps;
      });
      const sky = skyRef.current;
      const uniforms = (sky?.material as THREE.ShaderMaterial | undefined)?.uniforms;
      uniforms?.sunPosition?.value.set(st.sun.x * 100, st.sun.y * 100, st.sun.z * 100);
      if (scene.background instanceof THREE.Color) scene.background.set(st.background);
    }
    gl.toneMappingExposure = exposure * (realism ? st.exposure : 1);
  };

  // live slider value, read in the render loop without re-rendering React
  const preview = useRef<number | null>(useUiStore.getState().timePreview);
  useEffect(() => useUiStore.subscribe((s) => void (preview.current = s.timePreview)), []);

  useFrame((_, dt) => {
    flushLampShadowUpdates();
    const goal = realism ? (preview.current ?? target) : 13;
    if (current.current === null) current.current = goal;
    current.current = approachHour(current.current, goal, dt, BLEND_TAU);
    const key = `${current.current.toFixed(4)}|${realism}|${exposure}|${lampMode}|${windowLights.length}|${roomLights.length}|${configuredKey}`;
    if (key === applied.current) return;
    applied.current = key;
    apply(lightingAt(current.current));
  });

  // e2e/debug hook: the hour the lighting currently shows (may lag the setting while blending)
  useEffect(() => {
    const wp = (window as unknown as { __wp?: Record<string, unknown> }).__wp;
    if (wp) wp.lightingHour = () => current.current;
  }, []);

  // re-apply after structural changes (new lights mounted, mode switch)
  useEffect(() => {
    applied.current = '';
  }, [realism, windowLights, roomLights]);

  return (
    <>
      <hemisphereLight ref={hemiRef} args={['#f4f6ff', '#b8a990', 1]} />
      <ambientLight ref={ambientRef} intensity={0.15} />
      <directionalLight
        ref={sunRef}
        intensity={1.4}
        castShadow={realism}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {realism && showSky && <Sky ref={skyRef as never} distance={450} turbidity={6} rayleigh={1.2} mieCoefficient={0.005} mieDirectionalG={0.85} />}
      {realism &&
        windowLights.map((w, i) => (
          <pointLight key={`w${i}`} ref={(el) => void (windowRefs.current[i] = el)} position={w.pos} color="#dfe9ff" intensity={0} distance={7} decay={2} />
        ))}
      {realism &&
        roomLights.map((r, i) => (
          <ShadowedLight key={`r${i}`} priority={1} lightRef={(el) => void (roomRefs.current[i] = el)} position={r.pos} color={kelvinToColor(3000)} distance={r.reach} decay={2} />
        ))}
      {configured.map((l, i) => (
        <InteriorLight key={l.id} light={l} shadow={realism} lightRef={(el) => void (configuredRefs.current[i] = el)} />
      ))}
    </>
  );
}

const interiorIntensity = (l: Light) => l.intensity * 1.5;

function InteriorLight({ light, shadow, lightRef }: { light: Light; shadow: boolean; lightRef: (el: THREE.PointLight | null) => void }) {
  return (
    <group position={[light.x, light.elevation, light.y]}>
      {shadow ? (
        <ShadowedLight lightRef={lightRef} color={kelvinToColor(light.temperature)} distance={8} decay={1.5} />
      ) : (
        <pointLight ref={lightRef} color={kelvinToColor(light.temperature)} intensity={0} distance={8} decay={1.5} />
      )}
      <mesh>
        <sphereGeometry args={[0.06, 12, 8]} />
        <meshBasicMaterial color={kelvinToColor(light.temperature)} />
      </mesh>
    </group>
  );
}

/** Point light whose shadow keeps it out of neighbouring rooms (#130); see registerShadowLamp. */
function ShadowedLight({
  lightRef,
  priority = 0,
  ...props
}: {
  lightRef: (el: THREE.PointLight | null) => void;
  priority?: number;
  position?: [number, number, number];
  color: THREE.ColorRepresentation;
  distance: number;
  decay: number;
}) {
  const ref = useRef<THREE.PointLight>(null);
  useEffect(() => (ref.current ? registerShadowLamp(ref.current, priority) : undefined), [priority]);
  return (
    <pointLight
      ref={(el) => {
        ref.current = el;
        lightRef(el);
      }}
      intensity={0}
      {...props}
    />
  );
}
