import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { derivePlan } from '../model/derived';
import { addOpening, addRectRoom, closestWall, insertWall, mergeNodes, moveNode, moveWallLine, snapToGrid } from '../model/operations';
import { faceAtPoint, sameCycle } from '../model/roomDetection';
import { newId } from '../model/ids';
import { add, boundsOf, dist, dot, normalize, perp, rotate, scale, sub, type Vec2 } from '../model/vec';
import { formatLength, radToDeg, roundMm } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { selectedFurnitureIds, useUiStore } from '../store/uiStore';
import { furnitureCorners } from './furnitureGeometry';
import { hitTest } from './hitTest';
import { PlanDrawing } from './PlanDrawing';
import { snapPoint, type SnapResult } from './snapping';
import { fitView, niceGridStep, screenToWorld, zoomAt, type Viewport } from './viewTransform';
import { ZoomSlider } from '../ui/ZoomSlider';
import { useWalkPose } from '../store/walkPoseStore';
import { UnderlayImage } from './UnderlayImage';
import { imageToWorld, worldToImage } from '../import/underlayTransform';
import { OPENING_DEFAULTS } from '../model/operations';
import type { OpeningKind } from '../model/schema';
import { DEFAULT_FLOOR_MATERIAL_ID } from '../model/materials';
import { buildPlacementObstacles, furnitureConflicts, furnitureSnapOptions, moveFurnitureTo } from '../model/placement';
import { useImportStore } from '../import/importStore';
import { DraftOverlay, hitTestDraft } from './DraftOverlay';
import { NarrowPassageOverlay } from './NarrowPassageOverlay';
import { calibrateUnderlay } from '../import/underlayTransform';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startView: { cx: number; cy: number; zoom: number }; moved: boolean; clickSel: boolean }
  | { kind: 'furniture'; id: string; grab: Vec2; moved: boolean; origin: Vec2; group: { id: string; x: number; y: number }[] }
  | { kind: 'box'; start: Vec2 }
  | { kind: 'rotate'; id: string }
  | { kind: 'node'; id: string; moved: boolean }
  | { kind: 'wall'; id: string; start: Vec2; normal: Vec2; moved: boolean; wholeLine: boolean }
  | { kind: 'opening'; id: string; wallId: string; grabOffset: number; moved: boolean }
  | { kind: 'light'; id: string; moved: boolean }
  | { kind: 'room-rect'; start: Vec2 }
  | { kind: 'underlay'; start: Vec2; origin: Vec2 };

interface Preview {
  snap?: SnapResult | null;
  rect?: { a: Vec2; b: Vec2 } | null;
  /** furniture selection box (Shift+drag) */
  box?: { a: Vec2; b: Vec2 } | null;
  opening?: { wallId: string; s: number; kind: OpeningKind } | null;
  measure?: { a: Vec2; b: Vec2 } | null;
  /** Walls a dragged item is snapped to (highlighted). */
  snapWalls?: string[];
}

const SNAP_PX = 10;
const DRAG_THRESHOLD_PX = 4;

export function Editor2D() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const beginTx = useProjectStore((s) => s.beginTransaction);
  const updateTx = useProjectStore((s) => s.updateTransient);
  const commitTx = useProjectStore((s) => s.commitTransaction);
  const cancelTx = useProjectStore((s) => s.cancelTransaction);

  const selection = useUiStore((s) => s.selection);
  const hover = useUiStore((s) => s.hover);
  const multi = useUiStore((s) => s.multi);
  const tool = useUiStore((s) => s.tool);
  const view = useUiStore((s) => s.view2d);
  const fitRequest = useUiStore((s) => s.fitRequest);
  const measurements = useUiStore((s) => s.measurements);
  const ui = useUiStore.getState;

  const derived = useMemo(() => derivePlan(project), [project]);
  const obstacles = useMemo(() => buildPlacementObstacles(derived), [derived]);
  const conflicts = useMemo(() => {
    const m = new Map<string, 'error' | 'warn'>();
    for (const [id, c] of furnitureConflicts(project, derived, obstacles)) m.set(id, c.level);
    return m;
  }, [project, derived, obstacles]);
  const draft = useImportStore((s) => s.draft);
  const draftSel = useImportStore((s) => s.selected);
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [vp, setVp] = useState<Viewport>({ width: 800, height: 600 });
  const drag = useRef<Drag | null>(null);
  const downScreen = useRef<{ x: number; y: number } | null>(null);
  const dragStarted = useRef(false);
  const [preview, setPreview] = useState<Preview>({});
  /** Points of the wall chain currently being drawn. */
  const [chain, setChain] = useState<Vec2[]>([]);
  const [measureStart, setMeasureStart] = useState<Vec2 | null>(null);
  const [calib, setCalib] = useState<{ p1: Vec2 | null; p2: Vec2 | null }>({ p1: null, p2: null });
  const [lengthInput, setLengthInput] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  // track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setVp({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // fit to content on request (and again if the pane resizes right after the request)
  const lastFit = useRef({ request: -1, at: 0 });
  useEffect(() => {
    if (vp.width < 10) return;
    const now = performance.now();
    const isNewRequest = lastFit.current.request !== fitRequest;
    if (!isNewRequest && now - lastFit.current.at > 400) return;
    if (isNewRequest) lastFit.current = { request: fitRequest, at: now };
    const p = useProjectStore.getState().project;
    const points: Vec2[] = [...p.nodes, ...p.furniture.flatMap((f) => furnitureCorners(f))];
    if (p.underlay && p.underlay.visible) {
      const u = p.underlay;
      points.push(imageToWorld(u, { x: 0, y: 0 }), imageToWorld(u, { x: u.pixelWidth, y: u.pixelHeight }));
    }
    const b = boundsOf(points) ?? { minX: -2, minY: -2, maxX: 6, maxY: 5 };
    ui().setView2d(fitView(b, vp, 0.08));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest, vp.width, vp.height]);

  // reset tool-local state when the tool changes
  useEffect(() => {
    setChain([]);
    setMeasureStart(null);
    setCalib({ p1: null, p2: null });
    setPreview({});
    setLengthInput(null);
  }, [tool]);

  const toWorld = useCallback(
    (e: { clientX: number; clientY: number }): Vec2 => {
      const r = svgRef.current!.getBoundingClientRect();
      return screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }, view, vp);
    },
    [view, vp],
  );

  const settings = project.settings;
  const grid = settings.snapToGrid ? settings.gridSize : null;
  const radius = SNAP_PX / view.zoom;

  const snap = (raw: Vec2, e: { shiftKey: boolean; altKey?: boolean }, origin?: Vec2 | null, exclude?: Set<string>) =>
    e.altKey
      ? ({ point: raw, kind: 'none', guides: [] } as SnapResult)
      : snapPoint(project, raw, { radius, grid, origin, angleSnap: !!origin && !e.shiftKey, excludeNodeIds: exclude });

  // ---------- wall chain helpers ----------
  const commitWallTo = (p: Vec2) => {
    const last = chain[chain.length - 1];
    if (!last) {
      setChain([p]);
      return;
    }
    if (dist(last, p) < 0.02) return;
    apply((d) => {
      insertWall(d, last, p, { thickness: d.settings.defaultWallThickness, height: d.settings.defaultWallHeight });
    });
    // closing the loop ends the chain
    if (chain.length >= 2 && dist(chain[0], p) < 1e-3) {
      setChain([]);
      autoCreateRoomAt(p, chain);
      return;
    }
    setChain([...chain, p]);
  };

  const autoCreateRoomAt = (_p: Vec2, pts: Vec2[]) => {
    if (pts.length < 3) return;
    const c = pts.reduce((acc, q) => add(acc, q), { x: 0, y: 0 });
    const centroid = scale(c, 1 / pts.length);
    createRoomFromFace(centroid);
  };

  const createRoomFromFace = (pt: Vec2): boolean => {
    const p = useProjectStore.getState().project;
    const face = faceAtPoint(p, pt);
    if (!face) return false;
    if (p.rooms.some((r) => sameCycle(r.nodeIds, face.nodeIds))) return false;
    const id = newId('room');
    apply((d) => {
      d.rooms.push({ id, name: `Raum ${d.rooms.length + 1}`, nodeIds: face.nodeIds, floorMaterialId: DEFAULT_FLOOR_MATERIAL_ID });
    });
    ui().setSelection({ type: 'room', id });
    ui().toast('Raum aus umschlossener Fläche erstellt', 'success');
    return true;
  };

  const applyTypedLength = (value: string) => {
    const meters = parseFloat(value.replace(',', '.')) / 100;
    const last = chain[chain.length - 1];
    const cursor = preview.snap?.point;
    if (!last || !cursor || !Number.isFinite(meters) || meters <= 0) return;
    let dir = normalize(sub(cursor, last));
    if (dir.x === 0 && dir.y === 0) dir = { x: 1, y: 0 };
    const p = add(last, scale(dir, meters));
    commitWallTo({ x: roundMm(p.x), y: roundMm(p.y) });
  };

  // ---------- pointer handlers ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (lengthInput !== null && (e.target as HTMLElement).tagName === 'INPUT') return;
    const w = toWorld(e);
    downScreen.current = { x: e.clientX, y: e.clientY };
    dragStarted.current = false;
    svgRef.current?.setPointerCapture(e.pointerId);
    const isPan = e.button === 1 || e.button === 2 || spaceDown;
    if (isPan) {
      drag.current = { kind: 'pan', startScreen: { x: e.clientX, y: e.clientY }, startView: view, moved: false, clickSel: false };
      return;
    }
    if (e.button !== 0) return;

    switch (tool) {
      case 'select': {
        const tol = 6 / view.zoom;
        if (draft) {
          const dh = hitTestDraft(draft, w, tol);
          useImportStore.getState().select(dh);
          if (dh) return;
        }
        // rotation handle of selected furniture
        if (selection?.type === 'furniture') {
          const f = project.furniture.find((x) => x.id === selection.id);
          if (f && !f.locked) {
            const handle = add({ x: f.x, y: f.y }, rotate({ x: 0, y: -f.depth / 2 - 22 / view.zoom }, f.rotation));
            if (dist(handle, w) <= 8 / view.zoom) {
              beginTx();
              drag.current = { kind: 'rotate', id: f.id };
              return;
            }
          }
        }
        const hit = hitTest(project, derived, w, tol);
        // Shift+click on furniture: add to / remove from the selection (multi-select)
        if (hit?.type === 'furniture' && e.shiftKey) {
          ui().toggleFurnitureSelection(hit.id);
          drag.current = null;
          return;
        }
        // Shift+drag on empty space or a room floor: selection box for furniture
        if (e.shiftKey && (!hit || hit.type === 'room')) {
          drag.current = { kind: 'box', start: w };
          return;
        }
        if (!hit) {
          // underlay drag when unlocked, otherwise pan
          const u = project.underlay;
          if (u && u.visible && !u.locked && e.ctrlKey) {
            beginTx();
            drag.current = { kind: 'underlay', start: w, origin: { x: u.x, y: u.y } };
            return;
          }
          drag.current = { kind: 'pan', startScreen: { x: e.clientX, y: e.clientY }, startView: view, moved: false, clickSel: true };
          return;
        }
        // grabbing an item of a multi-selection keeps the selection and moves the whole group
        const current = ui();
        const inGroup = hit.type === 'furniture' && current.multi.length > 0 && selectedFurnitureIds(current).includes(hit.id);
        if (!inGroup) ui().setSelection(hit);
        beginTx();
        if (hit.type === 'furniture') {
          const f = project.furniture.find((x) => x.id === hit.id)!;
          if (f.locked) {
            drag.current = null;
            return;
          }
          const group = inGroup
            ? selectedFurnitureIds(current)
                .filter((id) => id !== hit.id)
                .map((id) => project.furniture.find((x) => x.id === id))
                .filter((g): g is NonNullable<typeof g> => !!g && !g.locked)
                .map((g) => ({ id: g.id, x: g.x, y: g.y }))
            : [];
          drag.current = { kind: 'furniture', id: hit.id, grab: sub(w, { x: f.x, y: f.y }), moved: false, origin: { x: f.x, y: f.y }, group };
        } else if (hit.type === 'node') {
          drag.current = { kind: 'node', id: hit.id, moved: false };
        } else if (hit.type === 'wall') {
          const fp = derived.footprints.get(hit.id)!;
          drag.current = { kind: 'wall', id: hit.id, start: w, normal: fp.normal, moved: false, wholeLine: !e.altKey };
        } else if (hit.type === 'opening') {
          const o = project.openings.find((x) => x.id === hit.id)!;
          const fp = derived.footprints.get(o.wallId)!;
          const s = dot(sub(w, fp.a), fp.dir);
          drag.current = { kind: 'opening', id: o.id, wallId: o.wallId, grabOffset: s - o.offset, moved: false };
        } else if (hit.type === 'light') {
          drag.current = { kind: 'light', id: hit.id, moved: false };
        } else {
          drag.current = null;
        }
        return;
      }
      case 'wall': {
        const last = chain[chain.length - 1] ?? null;
        const s = snap(w, e, last);
        if (e.detail >= 2) {
          // double click ends the chain
          setChain([]);
          return;
        }
        commitWallTo(s.point);
        return;
      }
      case 'room': {
        const s = snap(w, e);
        drag.current = { kind: 'room-rect', start: s.point };
        setPreview({ rect: { a: s.point, b: s.point } });
        return;
      }
      case 'door':
      case 'window':
      case 'passage': {
        const hit = closestWall(project, w, 0.6);
        if (!hit) {
          ui().toast('Bitte auf oder nahe an eine Wand klicken', 'info');
          return;
        }
        let id: string | null = null;
        const kind = tool;
        apply((d) => {
          id = addOpening(d, hit.wall.id, kind, hit.s);
        });
        if (id) ui().setSelection({ type: 'opening', id });
        return;
      }
      case 'measure': {
        const s = snap(w, e, measureStart);
        if (!measureStart) setMeasureStart(s.point);
        else {
          ui().addMeasurement({ id: newId('meas'), a: measureStart, b: s.point });
          setMeasureStart(null);
          setPreview({});
        }
        return;
      }
      case 'calibrate': {
        const u = project.underlay;
        if (!u) {
          ui().toast('Zuerst einen Grundriss importieren', 'info');
          return;
        }
        if (!calib.p1) setCalib({ p1: w, p2: null });
        else if (!calib.p2) setCalib({ p1: calib.p1, p2: w });
        return;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const w = toWorld(e);
    ui().setCursor(w);
    const dr = drag.current;
    if (dr) {
      // a click with a little jitter must not move anything
      if (dr.kind !== 'pan' && dr.kind !== 'room-rect' && downScreen.current && !dragStarted.current) {
        if (Math.hypot(e.clientX - downScreen.current.x, e.clientY - downScreen.current.y) < DRAG_THRESHOLD_PX) return;
        dragStarted.current = true;
      }
      switch (dr.kind) {
        case 'pan': {
          const dx = e.clientX - dr.startScreen.x;
          const dy = e.clientY - dr.startScreen.y;
          if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
          ui().setView2d({ ...dr.startView, cx: dr.startView.cx - dx / dr.startView.zoom, cy: dr.startView.cy - dy / dr.startView.zoom });
          return;
        }
        case 'furniture': {
          dr.moved = true;
          let c = sub(w, dr.grab);
          // snapping as chosen under Werkzeuge › „Möbel einrasten“ (#52); Alt = free placement
          const fs = furnitureSnapOptions(settings.furnitureSnap, e.altKey);
          if (fs.grid) c = snapToGrid(c, fs.grid);
          // wall snapping + collision (Alt = free placement)
          let snapped: string[] = [];
          updateTx((d) => {
            // a group moves rigidly (no wall snapping), each item still stops at walls/furniture
            snapped = moveFurnitureTo(d, derived, obstacles, dr.id, c, { snap: fs.walls && !dr.group.length, collide: !e.altKey });
            const moved = d.furniture.find((x) => x.id === dr.id);
            if (!moved || !dr.group.length) return;
            const delta = { x: moved.x - dr.origin.x, y: moved.y - dr.origin.y };
            for (const g of dr.group) moveFurnitureTo(d, derived, obstacles, g.id, { x: roundMm(g.x + delta.x), y: roundMm(g.y + delta.y) }, { snap: false, collide: !e.altKey });
          });
          setPreview({ snapWalls: snapped });
          return;
        }
        case 'box': {
          setPreview({ box: { a: dr.start, b: w } });
          return;
        }
        case 'rotate': {
          const f = project.furniture.find((x) => x.id === dr.id);
          if (!f) return;
          const v = sub(w, { x: f.x, y: f.y });
          let ang = Math.atan2(v.y, v.x) + Math.PI / 2; // handle sits at local -y
          if (!e.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
          updateTx((d) => {
            const ff = d.furniture.find((x) => x.id === dr.id);
            if (ff) ff.rotation = ang;
          });
          return;
        }
        case 'node': {
          dr.moved = true;
          const s = snap(w, e, null, new Set([dr.id]));
          setPreview({ snap: s });
          updateTx((d) => moveNode(d, dr.id, s.point));
          return;
        }
        case 'wall': {
          let delta = dot(sub(w, dr.start), dr.normal);
          if (grid && !e.altKey) delta = Math.round(delta / Math.min(grid, 0.05)) * Math.min(grid, 0.05);
          if (Math.abs(delta) > 1e-4) dr.moved = true;
          const base = useProjectStore.getState().txBase ?? project;
          updateTx((d) => {
            // recompute from the transaction base so moves don't accumulate errors
            d.nodes = structuredClone(base.nodes);
            moveWallLine(d, dr.id, scale(dr.normal, delta), dr.wholeLine);
          });
          return;
        }
        case 'opening': {
          dr.moved = true;
          const fp = derived.footprints.get(dr.wallId);
          if (!fp) return;
          let s = dot(sub(w, fp.a), fp.dir) - dr.grabOffset;
          if (grid && !e.altKey) s = Math.round(s / 0.01) * 0.01;
          updateTx((d) => {
            const o = d.openings.find((x) => x.id === dr.id);
            if (o) o.offset = roundMm(Math.max(o.width / 2, Math.min(fp.length - o.width / 2, s)));
          });
          return;
        }
        case 'light': {
          dr.moved = true;
          const c = grid && !e.altKey ? snapToGrid(w, Math.min(grid, 0.05)) : w;
          updateTx((d) => {
            const l = d.lights.find((x) => x.id === dr.id);
            if (l) {
              l.x = roundMm(c.x);
              l.y = roundMm(c.y);
            }
          });
          return;
        }
        case 'room-rect': {
          const s = snap(w, e);
          setPreview({ rect: { a: dr.start, b: s.point }, snap: s });
          return;
        }
        case 'underlay': {
          const delta = sub(w, dr.start);
          updateTx((d) => {
            if (d.underlay) {
              d.underlay.x = dr.origin.x + delta.x;
              d.underlay.y = dr.origin.y + delta.y;
            }
          });
          return;
        }
      }
      return;
    }

    // hover / previews
    switch (tool) {
      case 'select': {
        const hit = hitTest(project, derived, w, 6 / view.zoom);
        ui().setHover(hit);
        return;
      }
      case 'wall': {
        const last = chain[chain.length - 1] ?? null;
        setPreview({ snap: snap(w, e, last) });
        return;
      }
      case 'room':
        setPreview({ snap: snap(w, e) });
        return;
      case 'door':
      case 'window':
      case 'passage': {
        const hit = closestWall(project, w, 0.6);
        setPreview({ opening: hit ? { wallId: hit.wall.id, s: hit.s, kind: tool } : null });
        return;
      }
      case 'measure': {
        const s = snap(w, e, measureStart);
        setPreview({ snap: s, measure: measureStart ? { a: measureStart, b: s.point } : null });
        return;
      }
      default:
        setPreview({ snap: { point: w, kind: 'none', guides: [] } });
    }
  };

  /**
   * The browser aborted the gesture (pointercancel) or the window lost focus mid-drag
   * (no pointerup will arrive): end the drag so nothing keeps following the pointer.
   * A cancel reverts to the state before the drag, focus loss keeps the result.
   */
  const abortDrag = useCallback(
    (commit: boolean) => {
      if (!drag.current) return;
      drag.current = null;
      dragStarted.current = false;
      setPreview({});
      if (commit) commitTx();
      else cancelTx();
    },
    [commitTx, cancelTx],
  );
  useEffect(() => {
    const onBlur = () => abortDrag(true);
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [abortDrag]);

  const onPointerUp = (e: React.PointerEvent) => {
    const dr = drag.current;
    drag.current = null;
    svgRef.current?.releasePointerCapture?.(e.pointerId);
    if (!dr) return;
    if (dr.kind === 'pan') {
      if (!dr.moved && dr.clickSel) ui().setSelection(null);
      return;
    }
    if (dr.kind === 'box') {
      const b = toWorld(e);
      setPreview({});
      const x0 = Math.min(dr.start.x, b.x);
      const x1 = Math.max(dr.start.x, b.x);
      const y0 = Math.min(dr.start.y, b.y);
      const y1 = Math.max(dr.start.y, b.y);
      const inside = project.furniture.filter((f) => f.x >= x0 && f.x <= x1 && f.y >= y0 && f.y <= y1).map((f) => f.id);
      // add to an existing furniture selection (Shift is held)
      const keep = selectedFurnitureIds(ui());
      ui().selectFurniture([...keep, ...inside.filter((id) => !keep.includes(id))]);
      return;
    }
    if (dr.kind === 'room-rect') {
      const s = snap(toWorld(e), e);
      const a = dr.start;
      const b = s.point;
      setPreview({});
      const w = Math.abs(b.x - a.x);
      const h = Math.abs(b.y - a.y);
      if (w < 0.3 || h < 0.3) {
        // a simple click: create a room from the enclosed area if possible
        if (!createRoomFromFace(a)) ui().toast('Rechteck aufziehen (Innenmaße) oder in eine umschlossene Fläche klicken', 'info');
        return;
      }
      let roomId = '';
      apply((d) => {
        roomId = addRectRoom(d, {
          x: Math.min(a.x, b.x),
          y: Math.min(a.y, b.y),
          width: roundMm(w),
          depth: roundMm(h),
          name: `Raum ${d.rooms.length + 1}`,
          thickness: d.settings.defaultWallThickness,
          height: d.settings.defaultWallHeight,
          floorMaterialId: DEFAULT_FLOOR_MATERIAL_ID,
        });
      });
      ui().setSelection({ type: 'room', id: roomId });
      return;
    }
    if (dr.kind === 'node' && dr.moved) {
      // merge the dragged node into a node it was dropped onto
      const s = preview.snap;
      if (s?.kind === 'node' && s.nodeId && s.nodeId !== dr.id) {
        const target = s.nodeId;
        updateTx((d) => mergeNodes(d, dr.id, target));
      }
      setPreview({});
    }
    if (dr.kind === 'furniture') setPreview({});
    commitTx();
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    ui().setView2d(zoomAt(view, vp, { x: e.clientX - r.left, y: e.clientY - r.top }, factor));
  };

  // keyboard: Escape ends tool actions, digits start length entry, space pans
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === ' ') {
        setSpaceDown(true);
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        setChain([]);
        setMeasureStart(null);
        setCalib({ p1: null, p2: null });
        setLengthInput(null);
        setPreview({});
      }
      if (e.key === 'Enter' && tool === 'wall') setChain([]);
      if (tool === 'wall' && chain.length > 0 && /^[0-9]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
        setLengthInput(e.key);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') setSpaceDown(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [tool, chain.length]);

  // ---------- rendering ----------
  const px = 1 / view.zoom;
  const transform = `translate(${vp.width / 2 - view.cx * view.zoom} ${vp.height / 2 - view.cy * view.zoom}) scale(${view.zoom})`;
  const gridStep = niceGridStep(settings.gridSize, view.zoom);
  const majorStep = gridStep * (gridStep < 1 ? Math.round(1 / gridStep) : 5);
  const gx = vp.width / 2 - view.cx * view.zoom;
  const gy = vp.height / 2 - view.cy * view.zoom;

  const cursorClass =
    spaceDown || drag.current?.kind === 'pan'
      ? 'cursor-grab'
      : tool === 'select'
        ? hover
          ? 'cursor-pointer'
          : 'cursor-default'
        : 'cursor-crosshair';

  const selectedNodes = useMemo(() => {
    if (selection?.type === 'wall') {
      const w = project.walls.find((x) => x.id === selection.id);
      return w ? [w.a, w.b] : [];
    }
    if (selection?.type === 'room') return project.rooms.find((r) => r.id === selection.id)?.nodeIds ?? [];
    if (selection?.type === 'node') return [selection.id];
    return [];
  }, [selection, project]);

  const openingPreview = (() => {
    const op = preview.opening;
    if (!op) return null;
    const fp = derived.footprints.get(op.wallId);
    if (!fp) return null;
    const width = Math.min(OPENING_DEFAULTS[op.kind].width, fp.length);
    const s = Math.max(width / 2, Math.min(fp.length - width / 2, op.s));
    const p0 = add(fp.a, scale(fp.dir, s - width / 2));
    const p1 = add(fp.a, scale(fp.dir, s + width / 2));
    const h = scale(fp.normal, fp.thickness / 2 + 2 * px);
    const poly = [add(p0, h), add(p1, h), sub(p1, h), sub(p0, h)];
    return <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(37,99,235,0.35)" stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />;
  })();

  const lastChain = chain[chain.length - 1];
  const snapPt = preview.snap?.point;

  return (
    <div ref={containerRef} className={`editor2d ${cursorClass}`} data-testid="editor2d">
      <svg
        ref={svgRef}
        width={vp.width}
        height={vp.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => abortDrag(false)}
        onPointerLeave={() => {
          ui().setCursor(null);
          ui().setHover(null);
        }}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (tool === 'select') {
            const hit = hitTest(project, derived, toWorld(e), 6 / view.zoom);
            if (hit?.type === 'room' || hit?.type === 'furniture') ui().setRightTab('properties');
          }
        }}
      >
        <defs>
          <pattern id="grid-minor" width={gridStep * view.zoom} height={gridStep * view.zoom} patternUnits="userSpaceOnUse" x={gx} y={gy}>
            <path d={`M ${gridStep * view.zoom} 0 L 0 0 0 ${gridStep * view.zoom}`} fill="none" stroke="#e5e7eb" strokeWidth={1} />
          </pattern>
          <pattern id="grid-major" width={majorStep * view.zoom} height={majorStep * view.zoom} patternUnits="userSpaceOnUse" x={gx} y={gy}>
            <rect width={majorStep * view.zoom} height={majorStep * view.zoom} fill="url(#grid-minor)" />
            <path d={`M ${majorStep * view.zoom} 0 L 0 0 0 ${majorStep * view.zoom}`} fill="none" stroke="#cbd5e1" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={vp.width} height={vp.height} fill="#fafaf9" />
        <rect width={vp.width} height={vp.height} fill="url(#grid-major)" />
        <g transform={transform}>
          {project.underlay && project.underlay.visible && <UnderlayImage underlay={project.underlay} />}
          <PlanDrawing project={project} derived={derived} selection={selection} multi={multi} hover={hover} zoom={view.zoom} showDimensions conflicts={conflicts} />
          {draft && <DraftOverlay draft={draft} selected={draftSel} px={px} />}
          <NarrowPassageOverlay project={project} derived={derived} px={px} />
          <WalkMarker px={px} />

          {/* node handles */}
          {(tool === 'select' || tool === 'wall') &&
            project.nodes.map((n) => {
              const active = selectedNodes.includes(n.id) || (hover?.type === 'node' && hover.id === n.id);
              if (!active && tool !== 'wall') return null;
              return (
                <circle
                  key={n.id}
                  cx={n.x}
                  cy={n.y}
                  r={(active ? 5 : 3) * px}
                  fill={selection?.type === 'node' && selection.id === n.id ? '#2563eb' : '#ffffff'}
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

          {/* measurements */}
          {[...measurements, ...(preview.measure ? [{ id: 'preview', ...preview.measure }] : [])].map((m) => (
            <MeasureLine key={m.id} a={m.a} b={m.b} px={px} />
          ))}

          {/* wall drawing preview */}
          {tool === 'wall' && lastChain && snapPt && (
            <g pointerEvents="none">
              <line x1={lastChain.x} y1={lastChain.y} x2={snapPt.x} y2={snapPt.y} stroke="#2563eb" strokeWidth={settings.defaultWallThickness} strokeOpacity={0.35} />
              <line x1={lastChain.x} y1={lastChain.y} x2={snapPt.x} y2={snapPt.y} stroke="#2563eb" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="6 4" />
              <text
                x={(lastChain.x + snapPt.x) / 2}
                y={(lastChain.y + snapPt.y) / 2 - 10 * px}
                fontSize={13 * px}
                fill="#1d4ed8"
                textAnchor="middle"
                paintOrder="stroke"
                stroke="#fff"
                strokeWidth={3 * px}
                fontWeight={600}
              >
                {formatLength(dist(lastChain, snapPt))} · {Math.round(((radToDeg(Math.atan2(snapPt.y - lastChain.y, snapPt.x - lastChain.x)) % 360) + 360) % 360)}°
              </text>
            </g>
          )}
          {tool === 'wall' && chain.length > 0 && (
            <polyline points={chain.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#2563eb" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}

          {/* room rectangle preview */}
          {preview.box && (
            <rect
              data-testid="selection-box"
              x={Math.min(preview.box.a.x, preview.box.b.x)}
              y={Math.min(preview.box.a.y, preview.box.b.y)}
              width={Math.abs(preview.box.b.x - preview.box.a.x)}
              height={Math.abs(preview.box.b.y - preview.box.a.y)}
              fill="rgba(37, 99, 235, 0.08)"
              stroke="#2563eb"
              strokeWidth={px}
              strokeDasharray={`${4 * px} ${3 * px}`}
              pointerEvents="none"
            />
          )}
          {preview.rect && (
            <g pointerEvents="none">
              <rect
                x={Math.min(preview.rect.a.x, preview.rect.b.x)}
                y={Math.min(preview.rect.a.y, preview.rect.b.y)}
                width={Math.abs(preview.rect.b.x - preview.rect.a.x)}
                height={Math.abs(preview.rect.b.y - preview.rect.a.y)}
                fill="rgba(37,99,235,0.12)"
                stroke="#2563eb"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              <text
                x={(preview.rect.a.x + preview.rect.b.x) / 2}
                y={(preview.rect.a.y + preview.rect.b.y) / 2}
                fontSize={13 * px}
                textAnchor="middle"
                fill="#1d4ed8"
                fontWeight={600}
              >
                {formatLength(Math.abs(preview.rect.b.x - preview.rect.a.x))} × {formatLength(Math.abs(preview.rect.b.y - preview.rect.a.y))} (innen)
              </text>
            </g>
          )}

          {openingPreview}
          {(preview.snapWalls ?? []).map((id) => {
            const fp = derived.footprints.get(id);
            return fp ? (
              <polygon key={`snap-${id}`} points={fp.polygon.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke="#f97316" strokeWidth={2.5} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            ) : null;
          })}

          {/* snap indicator + guides */}
          {preview.snap && tool !== 'select' && (
            <g pointerEvents="none">
              {preview.snap.guides.map((g, i) => (
                <line key={i} x1={g.a.x} y1={g.a.y} x2={g.b.x} y2={g.b.y} stroke="#f97316" strokeWidth={1} strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
              ))}
              <circle
                cx={preview.snap.point.x}
                cy={preview.snap.point.y}
                r={(preview.snap.kind === 'node' ? 7 : 4) * px}
                fill="none"
                stroke={preview.snap.kind === 'node' ? '#16a34a' : preview.snap.kind === 'wall' ? '#f97316' : '#2563eb'}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            </g>
          )}
          {drag.current?.kind === 'node' && preview.snap && (
            <circle cx={preview.snap.point.x} cy={preview.snap.point.y} r={7 * px} fill="none" stroke="#16a34a" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}

          {/* calibration points */}
          {tool === 'calibrate' && calib.p1 && (
            <g pointerEvents="none">
              <circle cx={calib.p1.x} cy={calib.p1.y} r={5 * px} fill="#dc2626" />
              {(calib.p2 ?? preview.snap?.point) && (
                <line
                  x1={calib.p1.x}
                  y1={calib.p1.y}
                  x2={(calib.p2 ?? preview.snap!.point).x}
                  y2={(calib.p2 ?? preview.snap!.point).y}
                  stroke="#dc2626"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                />
              )}
              {calib.p2 && <circle cx={calib.p2.x} cy={calib.p2.y} r={5 * px} fill="#dc2626" />}
            </g>
          )}
        </g>
      </svg>

      <ZoomSlider
        testId="zoom-2d"
        label="Zoom 2D"
        value={view.zoom}
        min={10}
        max={800}
        onChange={(z) => ui().setView2d(zoomAt(view, vp, { x: vp.width / 2, y: vp.height / 2 }, z / view.zoom))}
        onFit={() => ui().requestFit()}
      />

      {tool === 'wall' && (
        <div className="editor-hint">
          {chain.length === 0
            ? 'Klicken, um eine Wand zu beginnen. Shift = freier Winkel, Alt = ohne Fang.'
            : 'Klicken für nächsten Punkt · Länge als Zahl (cm) tippen + Enter · Doppelklick/Esc beendet'}
        </div>
      )}
      {tool === 'room' && <div className="editor-hint">Rechteck mit Innenmaßen aufziehen – oder in eine umschlossene Fläche klicken.</div>}
      {(tool === 'door' || tool === 'window' || tool === 'passage') && <div className="editor-hint">Auf eine Wand klicken, um {tool === 'door' ? 'eine Tür' : tool === 'window' ? 'ein Fenster' : 'einen Durchgang'} einzusetzen.</div>}
      {tool === 'measure' && <div className="editor-hint">Zwei Punkte klicken, um zu messen. Esc bricht ab.</div>}
      {tool === 'calibrate' && !calib.p2 && (
        <div className="editor-hint">Maßstab kalibrieren: {calib.p1 ? 'zweiten Punkt' : 'ersten Punkt'} einer bekannten Strecke im Plan anklicken.</div>
      )}

      {lengthInput !== null && (
        <form
          className="length-input"
          onSubmit={(e) => {
            e.preventDefault();
            applyTypedLength(lengthInput);
            setLengthInput(null);
          }}
        >
          <label>
            Länge (cm)
            <input
              autoFocus
              value={lengthInput}
              onChange={(e) => setLengthInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setLengthInput(null)}
              inputMode="decimal"
            />
          </label>
          <button type="submit">OK</button>
        </form>
      )}

      {tool === 'calibrate' && calib.p1 && calib.p2 && (
        <CalibrationDialog
          p1={calib.p1}
          p2={calib.p2}
          onCancel={() => setCalib({ p1: null, p2: null })}
          onDone={() => {
            setCalib({ p1: null, p2: null });
            ui().setTool('select');
          }}
        />
      )}
    </div>
  );
}

function MeasureLine({ a, b, px }: { a: Vec2; b: Vec2; px: number }) {
  const d = normalize(sub(b, a));
  const n = scale(perp(d), 5 * px);
  const mid = scale(add(a, b), 0.5);
  return (
    <g pointerEvents="none">
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#dc2626" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={a.x - n.x} y1={a.y - n.y} x2={a.x + n.x} y2={a.y + n.y} stroke="#dc2626" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1={b.x - n.x} y1={b.y - n.y} x2={b.x + n.x} y2={b.y + n.y} stroke="#dc2626" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <text x={mid.x} y={mid.y - 8 * px} fontSize={12 * px} fill="#b91c1c" textAnchor="middle" paintOrder="stroke" stroke="#fff" strokeWidth={3 * px} fontWeight={600}>
        {formatLength(dist(a, b))}
      </text>
    </g>
  );
}

function CalibrationDialog({ p1, p2, onCancel, onDone }: { p1: Vec2; p2: Vec2; onCancel: () => void; onDone: () => void }) {
  const [value, setValue] = useState('');
  const underlay = useProjectStore((s) => s.project.underlay);
  const apply = useProjectStore((s) => s.apply);
  const toast = useUiStore((s) => s.toast);
  if (!underlay) return null;
  const i1 = worldToImage(underlay, p1);
  const i2 = worldToImage(underlay, p2);
  const pxDist = dist(i1, i2);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const cm = parseFloat(value.replace(',', '.'));
    if (!Number.isFinite(cm) || cm <= 0) {
      toast('Bitte eine gültige Länge in cm eingeben', 'error');
      return;
    }
    if (pxDist < 5) {
      toast('Die beiden Punkte liegen zu nah beieinander', 'error');
      return;
    }
    const meters = cm / 100;
    apply((d) => {
      const u = d.underlay!;
      // keeps the first reference point fixed in plan space
      const pose = calibrateUnderlay(u, i1, i2, meters);
      Object.assign(u, pose, { calibrated: true, scaleSource: 'reference', calibration: { p1: i1, p2: i2, distance: meters } });
    });
    toast(`Maßstab kalibriert: ${pxDist.toFixed(0)} px = ${formatLength(meters)}`, 'success');
    onDone();
  };
  return (
    <form className="floating-dialog" onSubmit={submit}>
      <h3>Maßstab kalibrieren</h3>
      <p>
        Gemessene Strecke im Bild: {pxDist.toFixed(1)} px. Wie lang ist diese Strecke in Wirklichkeit?
      </p>
      <label>
        Reale Länge (cm)
        <input autoFocus value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="z. B. 400" />
      </label>
      <div className="row">
        <button type="button" onClick={onCancel}>
          Abbrechen
        </button>
        <button type="submit" className="primary">
          Übernehmen
        </button>
      </div>
    </form>
  );
}

/**
 * "You are here" while walking in 3D next to the 2D plan (#19): dot + viewing cone at the
 * camera position. Subscribes on its own so the plan does not re-render while walking.
 */
function WalkMarker({ px }: { px: number }) {
  const pose = useWalkPose((s) => s.pose);
  const show = useUiStore((s) => s.cameraMode === 'walk' && s.viewMode === 'split');
  if (!show || !pose) return null;
  const dx = -Math.sin(pose.yaw);
  const dy = -Math.cos(pose.yaw);
  const len = 46 * px;
  const spread = 0.45;
  const ray = (a: number) => `${pose.x + (dx * Math.cos(a) - dy * Math.sin(a)) * len} ${pose.y + (dx * Math.sin(a) + dy * Math.cos(a)) * len}`;
  return (
    <g data-testid="walk-marker" pointerEvents="none">
      <path d={`M ${pose.x} ${pose.y} L ${ray(-spread)} L ${ray(spread)} Z`} fill="rgba(37, 99, 235, 0.18)" stroke="none" />
      <circle cx={pose.x} cy={pose.y} r={7 * px} fill="#2563eb" stroke="#fff" strokeWidth={2 * px} />
    </g>
  );
}

