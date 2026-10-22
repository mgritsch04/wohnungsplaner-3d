import { useEffect, useRef, useState } from 'react';
import { fixtureCorners, fixtureLabel, snapFixtureToWall } from '../model/fixtures';
import type { Fixture, FixtureKind, Project } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { placeFixture } from './actions';
import { useFixtureStore } from './fixtureStore';
import { FIXTURE_COLOR, FixtureGlyph } from './glyphs';

/** big enough to catch every click of the plan while placing */
const CATCH = 1e4;

type Drag = { id: string; dx: number; dy: number; moved: boolean };


/**
 * Installation plan in 2D (#64, #81): every socket, switch, radiator and water/waste-water
 * connection as its footprint on the wall plus a symbol. A click selects it („Eigenschaften“),
 * dragging moves it along the walls (it snaps onto the nearest wall face). While a kind waits
 * to be placed, a click next to a wall puts it there (Esc cancels).
 */
export function Fixtures2D({ project, px }: { project: Project; px: number }) {
  const ref = useRef<SVGGElement>(null);
  const drag = useRef<Drag | null>(null);
  const placing = useFixtureStore((s) => s.placing);
  const setPlacing = useFixtureStore((s) => s.setPlacing);
  const selection = useUiStore((s) => s.selection);
  const selectTool = useUiStore((s) => s.tool === 'select');
  const [hoverAt, setHoverAt] = useState<Vec2 | null>(null);

  useEffect(() => {
    if (!placing) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setPlacing(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [placing, setPlacing]);

  if (!project.fixtures.length && !placing) return null;

  const toWorld = (e: React.PointerEvent): Vec2 | null => {
    const m = ref.current?.getScreenCTM();
    if (!m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const st = () => useProjectStore.getState();
  const down = (e: React.PointerEvent, f: Fixture) => {
    if (e.button !== 0) return;
    const w = toWorld(e);
    if (!w) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { id: f.id, dx: w.x - f.x, dy: w.y - f.y, moved: false };
    useUiStore.getState().setSelection({ type: 'fixture', id: f.id });
    st().beginTransaction();
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const w = d && toWorld(e);
    if (!d || !w) return;
    e.stopPropagation();
    const target = { x: w.x - d.dx, y: w.y - d.dy };
    if (!d.moved) {
      // a click without movement only selects (and adds no undo step)
      const f = st().project.fixtures.find((x) => x.id === d.id);
      if (!f || Math.hypot(target.x - f.x, target.y - f.y) < 4 * px) return;
      d.moved = true;
    }
    st().updateTransient((p) => {
      const f = p.fixtures.find((x) => x.id === d.id);
      if (!f) return;
      // the pointer (on the symbol in front of the wall) decides the wall side: the fixture
      // centre lies just in front of the face and would flip sides with every jitter
      const snap = snapFixtureToWall(p, f, w);
      if (snap) Object.assign(f, { x: snap.x, y: snap.y, rotation: snap.rotation });
    });
  };
  const end = (e: React.PointerEvent) => {
    if (!drag.current) return;
    e.stopPropagation();
    drag.current = null;
    st().commitTransaction();
  };
  const place = (e: React.PointerEvent) => {
    if (!placing || e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e);
    if (!w) return;
    if (placeFixture(placing, w)) {
      setPlacing(null);
      setHoverAt(null);
    }
  };
  const r = 8 * px;
  const preview = placing && hoverAt ? snapFixtureToWall(project, { kind: placing, count: 1 }, hoverAt) : null;

  return (
    <g ref={ref} data-testid="fixtures-overlay">
      {project.fixtures.map((f) => {
        const sel = selection?.type === 'fixture' && selection.id === f.id;
        return (
          <FixtureSymbol
            key={f.id}
            f={f}
            px={px}
            r={r}
            selected={sel}
            interactive={selectTool && !placing}
            onPointerDown={(e) => down(e, f)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />
        );
      })}
      {placing && (
        <g data-testid="fixture-placing">
          <rect
            x={-CATCH}
            y={-CATCH}
            width={2 * CATCH}
            height={2 * CATCH}
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onPointerDown={place}
            onPointerMove={(e) => setHoverAt(toWorld(e))}
            onPointerLeave={() => setHoverAt(null)}
          />
          {preview && (
            <g pointerEvents="none" opacity={0.6}>
              <FixtureSymbol f={{ id: 'preview', kind: placing, count: 1, elevation: 0, ...preview }} px={px} r={r} selected={false} interactive={false} />
            </g>
          )}
        </g>
      )}
    </g>
  );
}

function FixtureSymbol({
  f,
  px,
  r,
  selected,
  interactive,
  ...handlers
}: {
  f: Fixture | (Omit<Fixture, 'kind'> & { kind: FixtureKind });
  px: number;
  r: number;
  selected: boolean;
  interactive: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onPointerMove?: (e: React.PointerEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
  onPointerCancel?: (e: React.PointerEvent) => void;
}) {
  const color = FIXTURE_COLOR[f.kind];
  const corners = fixtureCorners(f);
  // the symbol sits a little in front of the wall so it does not hide the wall line
  const fwd = { x: -Math.sin(f.rotation), y: Math.cos(f.rotation) };
  const c = f.kind === 'radiator' ? { x: f.x, y: f.y } : { x: f.x + fwd.x * (r + 2 * px), y: f.y + fwd.y * (r + 2 * px) };
  const s = (1.4 * r) / 24;
  return (
    <g
      data-testid="fixture-2d"
      data-fixture-id={f.id}
      data-kind={f.kind}
      data-selected={selected}
      style={{ cursor: interactive ? 'pointer' : undefined }}
      pointerEvents={interactive ? undefined : 'none'}
      {...handlers}
    >
      <path d={`M ${corners.map((p) => `${p.x} ${p.y}`).join(' L ')} Z`} fill={color} fillOpacity={f.kind === 'radiator' ? 0.25 : 0.9} stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {selected && <circle cx={c.x} cy={c.y} r={r + 4 * px} fill="none" stroke="#2563eb" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
      <circle cx={c.x} cy={c.y} r={r} fill="#ffffff" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <g transform={`translate(${c.x - 12 * s} ${c.y - 12 * s}) scale(${s})`} fill="none" stroke={color} color={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none">
        <FixtureGlyph kind={f.kind} />
      </g>
      <title>{fixtureLabel(f)}</title>
    </g>
  );
}
