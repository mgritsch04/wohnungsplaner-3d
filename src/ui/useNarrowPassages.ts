import { useMemo } from 'react';
import type { DerivedPlan } from '../model/derived';
import { findNarrowPassages, type NarrowPassage } from '../model/passages';
import type { Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';

const NONE: NarrowPassage[] = [];

/**
 * Narrow passages for the 2D/3D markers (#68). Hidden while something is being
 * dragged (open transaction) and recomputed after release, so the check never
 * slows down dragging.
 */
export function useNarrowPassages(project: Project, derived: DerivedPlan): NarrowPassage[] {
  const dragging = useProjectStore((s) => s.txBase !== null);
  const { showNarrowPassages, minPassageWidth } = project.settings;
  return useMemo(
    () => (showNarrowPassages && !dragging ? findNarrowPassages(project, derived, minPassageWidth) : NONE),
    [showNarrowPassages, dragging, project, derived, minPassageWidth],
  );
}
