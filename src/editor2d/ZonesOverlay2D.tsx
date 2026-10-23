import { useEffect, useRef, useState } from 'react';
import type { PlanZone } from '../model/schema';
import type { Vec2 } from '../model/vec';
import { isKeepFree, ZONE_PRESETS, zoneCenter, zoneColor } from '../model/zones';

const pts = (p: Vec2[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

/** Marked areas (#416): tinted, dashed outline, label „1 · Arbeitsecke“ in the middle (numbers as in the tools panel). */
export function ZonesOverlay2D({ zones, px, editingId }: { zones: PlanZone[]; px: number; editingId?: string | null }) {
  if (!zones.length) return null;
  return (
    <g pointerEvents="none" data-testid="zones-2d">
      {zones.map((z, i) => {
        const color = zoneColor(i);
        const c = zoneCenter(z);
        const free = isKeepFree(z.purpose);
        const text = `${i + 1} · ${z.purpose || 'ohne Angabe'}`;
        return (
          <g key={z.id} data-testid="zone-2d" data-zone-id={z.id}>
            <polygon
              points={pts(z.points)}
              fill={color}
              fillOpacity={free ? 0.06 : 0.14}
              stroke={color}
              strokeWidth={(editingId === z.id ? 3 : 1.6) * px}
              strokeDasharray={`${6 * px} ${4 * px}`}
            />
            <text
              x={c.x}
              y={c.y}
              fontSize={12 * px}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="middle"
              fill={color}
              stroke="var(--color-plan-bg, #fafaf9)"
              strokeWidth={3 * px}
              paintOrder="stroke"
            >
              {text.length > 40 ? `${text.slice(0, 39)}…` : text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Drawing in progress: rectangle being dragged or the points of a free shape. */
export function ZoneDraft({ points, cursor, px }: { points: Vec2[]; cursor?: Vec2 | null; px: number }) {
  if (!points.length) return null;
  const line = cursor ? [...points, cursor] : points;
  return (
    <g pointerEvents="none" data-testid="zone-draft">
      <polyline points={pts(line)} fill="rgba(13,148,136,0.12)" stroke="#0d9488" strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`} />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 5 : 3.5) * px} fill={i === 0 ? '#fff' : '#0d9488'} stroke="#0d9488" strokeWidth={1.5 * px} />
      ))}
    </g>
  );
}

/**
 * The little text box that opens right after drawing a zone (#416): what the area is for. Quick
 * picks fill the field; Enter saves, Esc cancels. For an existing zone also „Löschen“.
 */
export function ZoneTextBox({ at, initial, editing, onSave, onCancel, onDelete }: { at: Vec2; initial: string; editing: boolean; onSave: (text: string) => void; onCancel: () => void; onDelete?: () => void }) {
  const [text, setText] = useState(initial);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <div
      className="zone-box"
      style={{ left: at.x, top: at.y }}
      data-testid="zone-box"
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(text.trim());
        }}
      >
        <label className="small" htmlFor="zone-purpose">
          {editing ? 'Bereich – wofür?' : 'Wofür ist dieser Bereich?'}
        </label>
        <input id="zone-purpose" ref={input} type="text" value={text} maxLength={200} placeholder="z. B. Arbeitsecke mit Schreibtisch am Fenster" onChange={(e) => setText(e.target.value)} data-testid="zone-purpose" />
        <div className="zone-presets">
          {ZONE_PRESETS.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => setText(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="btn-row">
          <button type="submit" className="primary small" data-testid="zone-save">
            Speichern
          </button>
          <button type="button" className="small" onClick={onCancel}>
            Abbrechen
          </button>
          {onDelete && (
            <button type="button" className="small danger" onClick={onDelete} data-testid="zone-delete">
              Löschen
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
