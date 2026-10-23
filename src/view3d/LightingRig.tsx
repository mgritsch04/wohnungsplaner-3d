import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sky } from '@react-three/drei';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Light, Project, QualityMode } from '../model/schema';
import { useSimStore } from '../smarthome/simStore';
import { blindOverrides } from '../smarthome/simulation';
import { apartmentDaylight, facadeFactor, windowLights as computeWindowLights } from '../model/windowLight';
import { approachHour, kelvinToColor, lampLevel, lightingAt, sunBearing, type LightingState } from './lighting';
import { flushLampShadowUpdates, lampCount, registerShadowLamp, setLampLevel } from './lampRegistry';
import { useUiStore } from '../store/uiStore';
import { useSimLightOverrides } from '../smarthome/simStore';
import { setMetalEnvLevel } from './metalRegistry';
import { setEnvironmentLighting } from './daylightEnvironment';

/**
 * Smoothing time constant (s) of the displayed time behind the slider: short enough to
 * feel immediate, long enough to soften preset jumps. Frame-rate independent.
 */
const BLEND_TAU = 0.05;
const MAX_WINDOW_LIGHTS = 10;
/**
 * By day, the sky/environment fill reaches every room alike (no shadows), so it is kept low and most
 * of the daylight comes from the fill lights at the windows (#420): rooms far from a window or behind
 * drawn curtains stay darker. Shares of the full fill: with no daylight coming in / a well-lit flat.
 */
const DAY_FILL_MIN = 0.06;
const DAY_FILL_MAX = 0.35;
/** Brightness of a window fill light per m² of glass (before blinds/curtains and the facade factor). */
const WINDOW_LIGHT_PER_M2 = 2.6;

interface Props {
  project: Project;
  derived: DerivedPlan;
  quality: QualityMode;
  center: { x: number; y: number };
  span: number;
  /** Skip the sky dome (e.g. in the section view). */
  showSky: boolean;
  /** The outside view of the building (#92): sky light on the facades is not dimmed by the curtains. */
  exterior?: boolean;
}

/**
 * All lighting of the 3D scene. Realism mode follows the time of day: sun
 * position/colour/shadows, sky, diffuse environment and light through windows; at night
 * only placed lamps light the rooms (#216). Changes of the time blend smoothly; updates are
 * applied imperatively in the render loop, so moving the slider does not rebuild the scene.
 * Planning mode uses fixed, bright daylight for readability.
 */
export function LightingRig({ project, derived, quality, center, span, showSky, exterior = false }: Props) {
  const realism = quality === 'realism';
  const { scene, gl } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const configuredRefs = useRef<(THREE.PointLight | null)[]>([]);
  const skyRef = useRef<THREE.Mesh>(null);
  const windowRefs = useRef<(THREE.PointLight | null)[]>([]);
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

  // windows (#420): a soft fill light just inside each window – daylight entering the room, dimmed by
  // blinds and curtains (also while the smart-home simulation moves them)
  const simState = useSimStore((s) => s.state);
  const covers = useMemo(() => (simState ? blindOverrides(project, simState) : undefined), [project, simState]);
  const windows = useMemo(() => computeWindowLights(project, derived, covers), [project, derived, covers]);
  // sky and environment fill follow how much daylight the windows let in: drawn curtains darken the flat
  const indoorDay = useMemo(() => (exterior ? 1 : apartmentDaylight(project, derived, windows)), [exterior, project, derived, windows]);
  const windowLights = useMemo(
    () =>
      [...windows]
        .sort((a, b) => b.glass * b.transmission - a.glass * a.transmission)
        .slice(0, MAX_WINDOW_LIGHTS)
        .map((w) => ({ pos: [w.inside.x, w.midHeight, w.inside.y] as [number, number, number], strength: Math.min(7, WINDOW_LIGHT_PER_M2 * w.glass) * w.transmission, bearing: w.bearing })),
    [windows],
  );
  const windowKey = windowLights.map((w) => `${w.strength.toFixed(3)}:${w.bearing.toFixed(0)}`).join(',');
  const north = project.settings.northDirection;

  // smart-home simulation (#170): simulated lamps follow their automation, also by day
  const sim = useSimLightOverrides(project);
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
      hemi.intensity = realism ? 0.35 * st.ambientStrength * dayFill(st, indoorDay) : 1.0;
    }
    if (ambientRef.current) ambientRef.current.intensity = realism ? 0.02 * st.ambientStrength : 0.15;
    scene.environmentIntensity = realism ? 0.6 * st.ambientStrength * dayFill(st, indoorDay) : 0;
    // lamps (lamp furniture, placed lights) share one switch; rooms without lamps stay dark at night (#216)
    const lamps = realism ? lampLevel(lampMode, st) : 1;
    setLampLevel(lamps);
    // without any lamp, nothing lights reflections at night either: no glowing handles or window panes
    const lampShine = !realism || configured.length > 0 || lampCount() > 0 ? lamps : 0;
    setMetalEnvLevel(scene.environmentIntensity, lampShine);
    if (realism) setEnvironmentLighting(st.hour, lampShine, north);
    configured.forEach((l, i) => {
      const pl = configuredRefs.current[i];
      if (pl) pl.intensity = interiorIntensity(l) * (l.sim ? 1 : lamps);
    });
    if (realism) {
      windowLights.forEach((w, i) => {
        const l = windowRefs.current[i];
        if (l) l.intensity = st.daylight * w.strength * facadeFactor(w.bearing, sunBearing(st.hour), st.sunStrength);
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
    const key = `${current.current.toFixed(4)}|${realism}|${exposure}|${lampMode}|${windowKey}|${indoorDay.toFixed(3)}|${north}|${configuredKey}|${lampCount()}`;
    if (key === applied.current) return;
    applied.current = key;
    apply(lightingAt(current.current, north));
  });

  // e2e/debug hook: the hour the lighting currently shows (may lag the setting while blending)
  useEffect(() => {
    const wp = (window as unknown as { __wp?: Record<string, unknown> }).__wp;
    if (wp) wp.lightingHour = () => current.current;
  }, []);

  // re-apply after structural changes (new lights mounted, mode switch)
  useEffect(() => {
    applied.current = '';
  }, [realism, windowLights]);

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
          <pointLight key={`w${i}`} ref={(el) => void (windowRefs.current[i] = el)} position={w.pos} color="#dfe9ff" intensity={0} distance={6} decay={1.6} />
        ))}
      {configured.map((l, i) => (
        <InteriorLight key={l.id} light={l} shadow={realism} lightRef={(el) => void (configuredRefs.current[i] = el)} />
      ))}
    </>
  );
}

const interiorIntensity = (l: Light) => l.intensity * 1.5;

/**
 * Share of the sky/environment fill (#420): by day it follows how much daylight the windows let in
 * (never quite 0 – light still bounces in through gaps and doors); at night it no longer matters.
 */
const dayFill = (st: LightingState, indoorDay: number) => 1 - st.daylight * (1 - (DAY_FILL_MIN + (DAY_FILL_MAX - DAY_FILL_MIN) * indoorDay));

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
