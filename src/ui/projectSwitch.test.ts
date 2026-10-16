import { describe, expect, it } from 'vitest';
import { useSightStore } from '../editor2d/sightStore';
import { useWalkPathStore } from '../editor2d/walkPathStore';
import { createEmptyProject } from '../model/factory';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { useTapeStore } from '../view3d/tapeStore';
import './projectSwitch';

const state = () => ({
  measurements: useUiStore.getState().measurements.length,
  tape: useTapeStore.getState().items.length,
  pending: useTapeStore.getState().pending,
  walk: useWalkPathStore.getState().start,
  sight: useSightStore.getState().point,
});

describe('temporary tool results follow the project (#133)', () => {
  it('a new or other project starts without the measuring lines, tape, walking path and viewpoint of the previous one; going back restores them', () => {
    const a = createEmptyProject();
    useProjectStore.getState().load(a);
    useUiStore.getState().addMeasurement({ id: 'm1', a: { x: 0, y: 0 }, b: { x: 1, y: 0 } });
    useTapeStore.getState().addPoint([0, 0, 0]);
    useTapeStore.getState().addPoint([1, 0, 0]);
    useTapeStore.getState().addPoint([2, 0, 0]); // a second measurement in progress
    useWalkPathStore.setState({ start: { x: 1, y: 1 }, goal: null, result: null });
    useSightStore.getState().setPoint({ x: 2, y: 2 });
    useSightStore.getState().setShow(true);
    useTapeStore.getState().setActive(true);
    expect(state()).toEqual({ measurements: 1, tape: 1, pending: [2, 0, 0], walk: { x: 1, y: 1 }, sight: { x: 2, y: 2 } });

    // "Neues leeres Projekt": nothing of project A is left
    const b = createEmptyProject();
    expect(b.id).not.toBe(a.id);
    useProjectStore.getState().load(b);
    expect(state()).toEqual({ measurements: 0, tape: 0, pending: null, walk: null, sight: null });
    // tool modes and display toggles stay
    expect(useTapeStore.getState().active).toBe(true);
    expect(useSightStore.getState().show).toBe(true);

    // project B gets its own measuring line …
    useUiStore.getState().addMeasurement({ id: 'm2', a: { x: 0, y: 0 }, b: { x: 0, y: 2 } });
    // … back to A: A's results return, B's are put aside
    useProjectStore.getState().load(a);
    expect(state()).toEqual({ measurements: 1, tape: 1, pending: [2, 0, 0], walk: { x: 1, y: 1 }, sight: { x: 2, y: 2 } });
    expect(useUiStore.getState().measurements[0].id).toBe('m1');
    useProjectStore.getState().load(b);
    expect(useUiStore.getState().measurements.map((m) => m.id)).toEqual(['m2']);
    expect(state().tape).toBe(0);

    // changes within the same project (undo history, versions) keep everything
    useProjectStore.getState().apply((d) => void (d.name = 'Umbenannt'));
    expect(useUiStore.getState().measurements.map((m) => m.id)).toEqual(['m2']);
  });
});
