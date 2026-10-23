import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { interiorPlanDetails } from '../../editor2d/interiorPlan';
import { presetInterior } from '../../model/interior';
import { createSampleProject } from '../../model/sample';
import { ProjectSchema } from '../../model/schema';
import { openCabinetParts } from '../../view3d/ProceduralModel';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { PropertiesPanel } from './PropertiesPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const wardrobe = () => useProjectStore.getState().project.furniture.find((f) => f.catalogId === 'generic-wardrobe-150')!;
const click = (el: Element | null | undefined) => act(() => void (el as HTMLElement).click());
const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent!.trim() === text);

describe('Schrankinnenaufteilung (#85)', () => {
  beforeEach(() => {
    useProjectStore.getState().load(createSampleProject());
    useUiStore.setState({ interiorOpen: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<PropertiesPanel />));
    act(() => useUiStore.getState().setSelection({ type: 'furniture', id: wardrobe().id }));
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('Teile hinzufügen, Mindestmaß-Hinweis zeigen, Aufteilung speichern und laden', () => {
    click([...host.querySelectorAll('button.panel-group-toggle')].find((b) => b.textContent!.includes('Innenaufteilung')));
    click(button('+ Schublade'));
    expect(wardrobe().interior?.parts).toEqual([{ kind: 'drawer', column: 0, z: 0, h: 0.2 }]);
    expect(host.querySelector('[data-testid="interior-front"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="interior-issues"]')).toBeNull();
    click(button('+ Stange'));
    click(button('+ Fachboden'));
    expect(host.querySelector('[data-testid="interior-issues"]')).toBeNull();
    // zu flacher Schrank: Stange unterschreitet das Mindestmaß (Tiefe), Hinweis
    act(() => useProjectStore.getState().apply((d) => void (d.furniture.find((x) => x.id === wardrobe().id)!.depth = 0.4)));
    expect(host.querySelector('[data-testid="interior-issues"]')?.textContent).toContain('Kleiderstange');
    const saved = ProjectSchema.parse(JSON.parse(JSON.stringify(useProjectStore.getState().project)));
    expect(saved.furniture.find((f) => f.id === wardrobe().id)?.interior).toEqual(wardrobe().interior);
    click(button('Aufteilung entfernen'));
    expect(wardrobe().interior).toBeUndefined();
  });

  it('geöffnet: Draufsicht mit Spalten, Stange und Schubladen; 3D mit Fächern', () => {
    const f = wardrobe();
    const interior = presetInterior(f, 'wardrobe');
    const lines = interiorPlanDetails({ ...f, interior });
    expect(lines.filter((x) => x.type === 'line')).toHaveLength(2); // 1 Trennwand + 1 Stange
    expect(lines.filter((x) => x.type === 'rect')).toHaveLength(1); // Schubladen-Spalte
    const parts = openCabinetParts(f.width, f.depth, f.height, f.color, interior);
    const closed = openCabinetParts(f.width, f.depth, f.height, f.color, { columns: 1, parts: [] });
    expect(parts.length).toBeGreaterThan(closed.length + 5);
  });

  it('Höhenfelder speichern Meter (20 cm = 0,2 m, nicht doppelt durch 100)', () => {
    if (!button('+ Schublade')) click([...host.querySelectorAll('button.panel-group-toggle')].find((b) => b.textContent!.includes('Innenaufteilung')));
    click(button('+ Schublade'));
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    const type = (label: string, v: string) => {
      const input = [...host.querySelectorAll('label.field')].find((l) => l.textContent!.includes(label))!.querySelector('input')!;
      act(() => {
        input.focus();
        setValue.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      act(() => void input.blur());
    };
    type('Höhe der Schublade', '25');
    type('Höhe von unten', '20');
    const part = wardrobe().interior!.parts[0];
    expect(part.h).toBeCloseTo(0.25, 6);
    expect(part.z).toBeCloseTo(0.2, 6);
  });
});
