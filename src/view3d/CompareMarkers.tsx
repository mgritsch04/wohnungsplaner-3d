import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Furniture } from '../model/schema';
import { planRotationToWorldY } from '../model/units';
import type { CompareSide } from '../versions/compareStore';
import type { FurnitureDiff } from '../versions/diff';

/**
 * Markings of the before/after comparison (#76) in the 3D preview.
 * State B: new items green, moved/turned items orange, removed items as translucent red
 * „ghosts“ at their old position. State A: moved items orange, items that are gone in B red.
 * Colours come from the design tokens `--color-diff-*` (same as the legend).
 */

type Kind = 'added' | 'moved' | 'removed';
const TOKEN: Record<Kind, [string, string]> = {
  added: ['--color-diff-added', '#16a34a'],
  moved: ['--color-diff-moved', '#d97706'],
  removed: ['--color-diff-removed', '#dc2626'],
};

function tokenColor(kind: Kind): string {
  const [name, fallback] = TOKEN[kind];
  const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : '';
  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;
}

interface Mark {
  key: string;
  item: Furniture;
  kind: Kind;
  ghost: boolean;
}

export function marksFor(diff: FurnitureDiff, side: CompareSide): Mark[] {
  const marks: Mark[] = [];
  for (const e of diff.entries) {
    if (side === 'b') {
      if (e.status === 'added' && e.b) marks.push({ key: `n-${e.b.id}`, item: e.b, kind: 'added', ghost: false });
      if (e.status === 'moved' && e.b) marks.push({ key: `m-${e.b.id}`, item: e.b, kind: 'moved', ghost: false });
      if (e.status === 'removed' && e.a) marks.push({ key: `r-${e.a.id}`, item: e.a, kind: 'removed', ghost: true });
    } else {
      if (e.status === 'moved' && e.a) marks.push({ key: `m-${e.a.id}`, item: e.a, kind: 'moved', ghost: false });
      if (e.status === 'removed' && e.a) marks.push({ key: `r-${e.a.id}`, item: e.a, kind: 'removed', ghost: false });
    }
  }
  return marks;
}

export function CompareMarkers({ diff, side }: { diff: FurnitureDiff; side: CompareSide }) {
  const colors = useMemo(() => ({ added: tokenColor('added'), moved: tokenColor('moved'), removed: tokenColor('removed') }), []);
  const marks = useMemo(() => marksFor(diff, side), [diff, side]);
  return (
    <group name="compare-markers">
      {marks.map((m) => (
        <Marker key={m.key} item={m.item} kind={m.kind} ghost={m.ghost} color={colors[m.kind]} />
      ))}
    </group>
  );
}

const PAD = 0.04;

function Marker({ item, kind, ghost, color }: { item: Furniture; kind: Kind; ghost: boolean; color: string }) {
  const h = Math.max(item.height, 0.02);
  const { box, edges } = useMemo(() => {
    const box = new THREE.BoxGeometry(item.width + PAD, h + PAD, item.depth + PAD);
    return { box, edges: new THREE.EdgesGeometry(box) };
  }, [item.width, item.depth, h]);
  useEffect(
    () => () => {
      box.dispose();
      edges.dispose();
    },
    [box, edges],
  );
  return (
    <group
      position={[item.x, item.elevation ?? 0, item.y]}
      rotation={[0, planRotationToWorldY(item.rotation ?? 0), 0]}
      userData={{ compareMarker: kind, ghost, furnitureId: item.id }}
    >
      {/* translucent body: a light tint for marked items, a clear „ghost“ for removed ones */}
      <mesh geometry={box} position={[0, h / 2, 0]} raycast={() => null} renderOrder={2}>
        <meshBasicMaterial color={color} transparent opacity={ghost ? 0.32 : 0.14} depthWrite={false} />
      </mesh>
      {/* outline, visible through walls so changes are found from every viewpoint */}
      <lineSegments geometry={edges} position={[0, h / 2, 0]} raycast={() => null} renderOrder={3}>
        <lineBasicMaterial color={color} depthTest={false} transparent opacity={0.95} />
      </lineSegments>
    </group>
  );
}
