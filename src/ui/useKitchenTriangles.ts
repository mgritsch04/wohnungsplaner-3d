import { useMemo } from 'react';
import { kitchenWorkTriangles, type KitchenTriangleResult } from '../kitchen/workTriangle';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useProjectStore } from '../store/projectStore';

const NONE: KitchenTriangleResult[] = [];

/**
 * Kitchen work triangles (#82) for the 2D overlay and the kitchen panel. Recomputed
 * whenever appliances move; paused while something is being dragged (open
 * transaction), like the narrow-passage markers.
 */
export function useKitchenTriangles(project: Project, derived: DerivedPlan, opts: { respectShow?: boolean } = {}): KitchenTriangleResult[] {
  const dragging = useProjectStore((s) => s.txBase !== null);
  const kt = project.settings.kitchenTriangle;
  const hidden = (opts.respectShow ?? true) && !kt.show;
  return useMemo(() => (hidden || dragging ? NONE : kitchenWorkTriangles(project, derived, kt)), [hidden, dragging, project, derived, kt]);
}
