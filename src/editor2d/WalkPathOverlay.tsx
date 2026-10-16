import { formatWalkLength } from '../model/walkPath';
import { useWalkPathStore } from './walkPathStore';

const BLUE = '#0d9488';

/** Walking path (#67): polyline with start/goal markers and the length in metres. */
export function WalkPathOverlay({ px }: { px: number }) {
  const { start, goal, result } = useWalkPathStore();
  if (!start) return null;
  const ok = result?.ok ? result : null;
  const pts = ok?.points ?? [];
  // label at the middle segment of the path
  const mid = pts.length >= 2 ? pts[Math.floor((pts.length - 1) / 2)] : null;
  const next = pts.length >= 2 ? pts[Math.floor((pts.length - 1) / 2) + 1] : null;
  const label = mid && next ? { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 } : null;
  return (
    <g pointerEvents="none" data-testid="walk-path">
      {ok && (
        <polyline
          points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={BLUE}
          strokeWidth={3}
          strokeLinejoin="round"
          strokeLinecap="round"
          strokeDasharray="8 5"
          vectorEffect="non-scaling-stroke"
          data-testid="walk-path-line"
        />
      )}
      {[start, goal].map(
        (p, i) =>
          p && <circle key={i} cx={p.x} cy={p.y} r={6 * px} fill={i === 0 ? '#ffffff' : BLUE} stroke={BLUE} strokeWidth={2} vectorEffect="non-scaling-stroke" />,
      )}
      {ok && label && (
        <text
          x={label.x}
          y={label.y - 10 * px}
          fontSize={13 * px}
          fontWeight={700}
          fill={BLUE}
          textAnchor="middle"
          paintOrder="stroke"
          stroke="#ffffff"
          strokeWidth={4 * px}
          data-testid="walk-path-length"
          data-length-m={ok.length.toFixed(3)}
        >
          {formatWalkLength(ok.length)}
        </text>
      )}
    </g>
  );
}

/** Hint line under the 2D plan while the tool is active. */
export function WalkPathHint() {
  const { start, goal, result } = useWalkPathStore();
  const text = !start
    ? 'Laufweg: Startpunkt anklicken.'
    : !goal
      ? 'Laufweg: Ziel anklicken.'
      : result && !result.ok
        ? `${result.reason}. Neuer Klick = neuer Weg.`
        : `Laufweg ${result?.ok ? formatWalkLength(result.length) : ''} – neuer Klick beginnt einen neuen Weg, Esc beendet.`;
  return <div className="editor-hint">{text}</div>;
}
