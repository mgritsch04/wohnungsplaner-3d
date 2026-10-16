import { alignFurniture, distributeFurniture, type AlignEdge, type ArrangeResult, type DistributeAxis } from '../model/arrange';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';

export type ArrangeCommand = { kind: 'align'; edge: AlignEdge } | { kind: 'distribute'; axis: DistributeAxis };

/** Past participle for the toast, e.g. „links ausgerichtet“. */
const DONE: Record<AlignEdge | DistributeAxis, string> = {
  left: 'links ausgerichtet',
  right: 'rechts ausgerichtet',
  top: 'oben ausgerichtet',
  bottom: 'unten ausgerichtet',
  centerX: 'waagrecht mittig ausgerichtet',
  centerY: 'senkrecht mittig ausgerichtet',
  x: 'waagrecht verteilt',
  y: 'senkrecht verteilt',
};

/** User-facing summary of an align/distribute run (#51). */
export function arrangeMessage(cmd: ArrangeCommand, r: ArrangeResult): { text: string; kind: 'info' | 'success' } {
  const verb = cmd.kind === 'align' ? 'ausgerichtet' : 'verteilt';
  const done = DONE[cmd.kind === 'align' ? cmd.edge : cmd.axis];
  const parts: string[] = [];
  if (r.blocked.length) parts.push(`${r.blocked.length} von ${r.total} Möbeln konnten wegen Hindernissen nicht ganz ${verb} werden – sie stehen so nah wie möglich davor.`);
  if (r.locked.length) parts.push(r.locked.length === 1 ? '1 gesperrtes Möbel bleibt stehen.' : `${r.locked.length} gesperrte Möbel bleiben stehen.`);
  if (parts.length) return { text: parts.join(' '), kind: 'info' };
  if (!r.moved.length) return { text: `Die Auswahl ist bereits ${done}.`, kind: 'info' };
  return { text: `${r.total} Möbel ${done}.`, kind: 'success' };
}

/**
 * Align or distribute the selected furniture: computed on a copy, then applied as
 * exactly one undo step (none if nothing moved). Shows a toast with the outcome.
 */
export function arrangeSelection(cmd: ArrangeCommand): ArrangeResult | null {
  const ids = selectedFurnitureIds(useUiStore.getState());
  if (ids.length < (cmd.kind === 'align' ? 2 : 3)) return null;
  const store = useProjectStore.getState();
  if (store.txBase) return null;
  const draft = structuredClone(store.project);
  const derived = derivePlan(store.project);
  const r = cmd.kind === 'align' ? alignFurniture(draft, derived, ids, cmd.edge) : distributeFurniture(draft, derived, ids, cmd.axis);
  if (r.moved.length) {
    const pos = new Map(draft.furniture.filter((f) => r.moved.includes(f.id)).map((f) => [f.id, { x: f.x, y: f.y }]));
    store.apply((d) => {
      for (const f of d.furniture) {
        const p = pos.get(f.id);
        if (p) {
          f.x = p.x;
          f.y = p.y;
        }
      }
    });
  }
  const m = arrangeMessage(cmd, r);
  useUiStore.getState().toast(m.text, m.kind);
  return r;
}
