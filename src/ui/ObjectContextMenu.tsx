import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { derivePlan } from '../model/derived';
import { deviceOn, statusLabel } from '../smarthome/DeviceInfo';
import { useSimStore } from '../smarthome/simStore';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import { walkCommands } from '../view3d/touchWalk';
import { deleteSelection, duplicateSelection, rotateSelection, toggleOpening } from './actions';
import { closeObjectMenu, objectMenuModel, useObjectMenuStore, type ObjectActionId } from './objectMenu';
import './objectMenu.css';

const GAP = 8;

/**
 * The shared object context menu (#235): name, size, price/retailer (only real data) and quick
 * actions for the chosen object. Every action is one undo step (the existing editor actions).
 * Closes on Esc, a click outside, after an action, or when the selection moves to another object.
 */
export function ObjectContextMenu() {
  const menu = useObjectMenuStore((s) => s.menu);
  const onDetails = useObjectMenuStore((s) => s.onDetails);
  const project = useProjectStore((s) => s.project);
  const selection = useUiStore((s) => s.selection);
  const count = useUiStore((s) => selectedFurnitureIds(s).length);
  const walking = useUiStore((s) => s.cameraMode === 'walk' && s.viewMode !== '2d');
  const carrying = useUiStore((s) => s.walkCarry);
  const entities = useSimStore((s) => s.state?.entities);
  const derived = useMemo(() => derivePlan(project), [project]);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const target = menu?.target;
  const model = useMemo(() => {
    if (!target) return null;
    const dev = target.type === 'device' ? project.devices.find((d) => d.id === target.id) : undefined;
    const st = dev ? deviceOn(project, dev, entities) : null;
    const deviceStatus = dev && st ? { label: statusLabel(dev, st.on, st.brightness), on: st.on } : undefined;
    return objectMenuModel(project, derived, target, { walking, carrying, count, deviceStatus });
  }, [project, derived, target, walking, carrying, count, entities]);

  // the object is gone (deleted, undone) or another object was chosen: close
  const stale = !!menu && (!model || selection?.type !== menu.target.type || selection.id !== menu.target.id);
  useEffect(() => {
    if (stale) closeObjectMenu();
  }, [stale]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) closeObjectMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc only closes the menu – the selection stays
      e.stopPropagation();
      e.preventDefault();
      closeObjectMenu();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  // keep the panel inside the window, next to the pointer (or centred on the crosshair)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!menu || !el || menu.place === 'sheet') return setPos(null);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = menu.place === 'walk' ? menu.x - w / 2 : menu.x + 4;
    let top = menu.place === 'walk' ? menu.y + 24 : menu.y + 4;
    left = Math.max(GAP, Math.min(left, window.innerWidth - w - GAP));
    top = Math.max(GAP, Math.min(top, window.innerHeight - h - GAP));
    setPos({ left, top });
  }, [menu, model]);

  // focus the first action so the keyboard (Tab / Enter) works right away
  useEffect(() => {
    if (menu) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, [menu]);

  if (!menu || !model || stale) return null;

  const run = (id: ObjectActionId) => {
    const t = menu.target;
    switch (id) {
      case 'rotate-left':
        rotateSelection(-Math.PI / 2);
        return; // stays open: turning twice is common
      case 'rotate-right':
        rotateSelection(Math.PI / 2);
        return;
      case 'duplicate':
        duplicateSelection();
        break;
      case 'carry':
      case 'drop':
        walkCommands.toggleCarry?.();
        break;
      case 'toggle-open':
        toggleOpening(t.id);
        return;
      case 'toggle-light':
        useProjectStore.getState().apply((d) => {
          const l = d.lights.find((x) => x.id === t.id);
          if (l) l.on = !l.on;
        });
        return;
      case 'toggle-device': {
        const dev = project.devices.find((d) => d.id === t.id);
        if (dev?.kind === 'contact') {
          if (dev.openingId) toggleOpening(dev.openingId);
        } else if (dev) useSimStore.getState().setEntity(dev.id, !deviceOn(project, dev, entities).on);
        return;
      }
      case 'trigger-device':
        useSimStore.getState().trigger(t.id);
        return;
      case 'delete':
        void deleteSelection();
        break;
      case 'properties':
        useUiStore.getState().setRightTab('properties');
        if (menu.place === 'sheet') onDetails?.();
        break;
    }
    closeObjectMenu();
  };

  const sheet = menu.place === 'sheet';
  return (
    <div
      ref={ref}
      className={`object-menu${sheet ? ' sheet' : ''}`}
      role="menu"
      aria-label={`Aktionen für ${model.title}`}
      data-testid="object-menu"
      data-target={menu.target.type}
      data-place={menu.place}
      style={sheet ? undefined : { left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="object-menu-head">
        <strong data-testid="object-menu-title">{model.title}</strong>
        <button type="button" className="object-menu-close" aria-label="Schließen" onClick={closeObjectMenu}>
          ✕
        </button>
      </div>
      {model.details.map((line) => (
        <span key={line} className="object-menu-detail">
          {line}
        </span>
      ))}
      <div className="object-menu-actions">
        {model.actions.map((a) => (
          <button
            key={a.id}
            type="button"
            role="menuitem"
            className={a.danger ? 'danger' : undefined}
            title={a.hint}
            data-action={a.id}
            onClick={() => run(a.id)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
