import { memo, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { derivePlan } from '../model/derived';
import { activeLevel, projectOnLevel } from '../model/levels';
import { stairwells } from '../model/stairs';
import type { Level, Project, QualityMode } from '../model/schema';
import type { OtherLevels } from '../store/uiStore';
import { Architecture } from './Architecture';
import { FurnitureObject } from './FurnitureObject';

/**
 * The other storeys of the building (#54), drawn above / below the active one (which stays at
 * height 0, so editing, walking and the camera work as on a single storey). Shown only: they
 * live on their own render layer, which the view's camera sees but no pointer or walkthrough
 * ray hits, so they never take a click or block the walker.
 */
export const OTHER_LEVEL_LAYER = 1;

const noop = () => {};

/** Storeys to draw besides the active one, with their height offset to it. */
export function visibleOtherLevels(p: Project, mode: OtherLevels, cameraMode: 'orbit' | 'walk', exterior: boolean): { level: Level; offset: number }[] {
  if (mode === 'none' || p.levels.length < 2) return [];
  const base = activeLevel(p).elevation;
  // walking (inside, ceilings on) and the outside view show the whole building
  const all = mode === 'all' || cameraMode === 'walk' || exterior;
  return p.levels.filter((l) => l.id !== p.activeLevelId && (all || l.elevation < base)).map((level) => ({ level, offset: level.elevation - base }));
}

export function OtherLevels3D({ project, mode, cameraMode, exterior, quality, showCeilings }: { project: Project; mode: OtherLevels; cameraMode: 'orbit' | 'walk'; exterior: boolean; quality: QualityMode; showCeilings: boolean }) {
  const camera = useThree((s) => s.camera);
  const shown = visibleOtherLevels(project, mode, cameraMode, exterior);
  // the view camera must see the storeys' layer; enabling it every frame is cheap and survives a camera change
  useFrame(() => void camera.layers.enable(OTHER_LEVEL_LAYER));
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map(({ level, offset }) => (
        <OtherLevel key={level.id} project={project} level={level} offset={offset} quality={quality} showCeilings={showCeilings} />
      ))}
    </>
  );
}

const OtherLevel = memo(function OtherLevel({ project, level, offset, quality, showCeilings }: { project: Project; level: Level; offset: number; quality: QualityMode; showCeilings: boolean }) {
  // the stored plan only changes when the storey is edited (it is shared between project states)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const view = useMemo(() => projectOnLevel(project, level.id), [level.plan, project.materials, project.settings.defaultWallHeight]);
  const derived = useMemo(() => derivePlan(view), [view]);
  const wellsKey = JSON.stringify(stairwells(project, level.id));
   
  const wells = useMemo(() => JSON.parse(wellsKey) as ReturnType<typeof stairwells>, [wellsKey]);
  const group = useRef<THREE.Group>(null);
  const seen = useRef(-1);
  // put everything of the storey on its own layer; models load later (GLB), so re-check now and then
  useFrame(({ clock }) => {
    const g = group.current;
    const tick = Math.floor(clock.elapsedTime * 2);
    if (!g || tick === seen.current) return;
    seen.current = tick;
    g.traverse((o) => o.layers.set(OTHER_LEVEL_LAYER));
  });
  return (
    <group ref={group} position-y={offset} userData={{ levelId: level.id }}>
      <Architecture project={view} derived={derived} quality={quality} selectedId={null} onSelect={noop} showCeilings={showCeilings} floorHoles={wells.floor} ceilingHoles={wells.ceiling} />
      {view.furniture.map((f) => (
        <FurnitureObject key={f.id} item={f} quality={quality} selected={false} onSelect={noop} onDragStart={noop} onDrag={noop} onDragEnd={noop} onDragCancel={noop} readOnly />
      ))}
    </group>
  );
});
