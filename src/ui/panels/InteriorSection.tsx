import { useMemo } from 'react';
import { BOARD, checkInterior, columnWidth, DEFAULT_DRAWER_HEIGHT, INTERIOR_PRESETS, innerHeight, partSpan, presetInterior, summarizeInterior, supportsInterior, type InteriorPreset } from '../../model/interior';
import type { Furniture, Interior, InteriorPart } from '../../model/schema';
import { useUiStore } from '../../store/uiStore';
import { Badge, NumberField, PanelGroup, SelectField } from '../fields';

const KIND_LABEL: Record<InteriorPart['kind'], string> = { shelf: 'Fachboden', drawer: 'Schublade', rod: 'Kleiderstange' };

/** Front view of the inner layout (2D), problems in red. */
export function InteriorFront({ f, interior, bad }: { f: Pick<Furniture, 'width' | 'depth' | 'height'>; interior: Interior; bad: Set<number> }) {
  const { width: w, height: h } = f;
  const n = interior.columns;
  const cw = columnWidth(f, n);
  const x0 = (c: number) => BOARD + c * (cw + BOARD);
  const y = (z: number) => h - BOARD - z; // SVG y grows downwards
  const stroke = 'var(--color-text, #374151)';
  return (
    <svg viewBox={`-0.03 -0.03 ${w + 0.06} ${h + 0.06}`} width="100%" style={{ maxHeight: 280 }} role="img" aria-label="Innenaufteilung von vorn" data-testid="interior-front">
      <rect x={0} y={0} width={w} height={h} fill="none" stroke={stroke} strokeWidth={0.012} />
      <rect x={BOARD} y={BOARD} width={w - 2 * BOARD} height={h - 2 * BOARD} fill="rgba(120,120,120,0.08)" stroke={stroke} strokeWidth={0.004} />
      {Array.from({ length: n - 1 }, (_, i) => (
        <line key={i} x1={x0(i + 1) - BOARD / 2} x2={x0(i + 1) - BOARD / 2} y1={BOARD} y2={h - BOARD} stroke={stroke} strokeWidth={BOARD} />
      ))}
      {interior.parts.map((p, i) => {
        if (p.column >= n) return null;
        const a = x0(p.column);
        const col = bad.has(i) ? '#dc2626' : stroke;
        if (p.kind === 'rod') return <line key={i} x1={a + 0.02} x2={a + cw - 0.02} y1={y(p.z)} y2={y(p.z)} stroke={col} strokeWidth={0.02} strokeLinecap="round" />;
        const [lo, hi] = partSpan(p);
        if (p.kind === 'shelf') return <rect key={i} x={a} y={y(hi)} width={cw} height={BOARD} fill={col} />;
        return <rect key={i} x={a + 0.005} y={y(hi)} width={cw - 0.01} height={hi - lo} fill="rgba(180,140,90,0.35)" stroke={col} strokeWidth={0.006} />;
      })}
    </svg>
  );
}

/** Panel for the inner layout of a cabinet (#85): columns, shelves, drawers and rods, checked against minimum sizes. */
export function InteriorSection({ f, upd }: { f: Furniture; upd: (fn: (x: Furniture) => void) => void }) {
  const shape = f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape;
  const open = useUiStore((s) => s.interiorOpen.includes(f.id));
  const interior = f.interior;
  const issues = useMemo(() => (interior ? checkInterior(f, interior) : []), [f, interior]);
  if (!supportsInterior(shape)) return null;

  const set = (fn: (i: Interior) => void) =>
    upd((x) => {
      if (!x.interior) x.interior = { columns: 1, parts: [] };
      fn(x.interior);
    });
  const free = (c: number) => {
    const top = Math.max(0, ...(interior?.parts ?? []).filter((p) => p.column === c && p.kind !== 'rod').map((p) => partSpan(p)[1]));
    return Math.round(top * 1000) / 1000;
  };
  const addPart = (kind: InteriorPart['kind']) =>
    set((i) => {
      const column = 0;
      const top = innerHeight(f);
      if (kind === 'rod') i.parts.push({ kind, column, z: Math.round(Math.max(0.6, top - 0.08) * 1000) / 1000 });
      else if (kind === 'drawer') i.parts.push({ kind, column, z: Math.min(free(column), Math.max(0, top - DEFAULT_DRAWER_HEIGHT)), h: DEFAULT_DRAWER_HEIGHT });
      else i.parts.push({ kind, column, z: Math.min(free(column) + 0.3, Math.max(0, top - BOARD)) });
    });
  const sum = interior ? summarizeInterior(interior) : null;
  const bad = new Set(issues.map((x) => x.part));

  return (
    <PanelGroup
      groupKey="furniture.interior"
      title="Innenaufteilung"
      defaultOpen={!!interior}
      actions={interior ? <Badge kind={issues.length ? 'warn' : 'ok'}>{issues.length ? `${issues.length} Hinweis${issues.length > 1 ? 'e' : ''}` : 'passt'}</Badge> : <Badge kind="muted">nicht geplant</Badge>}
    >
      <SelectField
        label="Voreinstellung"
        value={'' as InteriorPreset | ''}
        options={[{ value: '', label: interior ? 'Neu aufteilen …' : 'Aufteilung beginnen …' }, ...INTERIOR_PRESETS.map((p) => ({ value: p.id, label: p.label }))]}
        onChange={(v) => v && upd((x) => void (x.interior = presetInterior(x, v)))}
      />
      {interior && (
        <>
          <NumberField
            label="Spalten"
            value={interior.columns}
            min={1}
            max={6}
            digits={0}
            onChange={(v) =>
              set((i) => {
                i.columns = Math.max(1, Math.min(6, Math.round(v)));
                for (const p of i.parts) p.column = Math.min(p.column, i.columns - 1);
              })
            }
          />
          <p className="muted small">
            Innenmaß je Spalte: {Math.round(columnWidth(f, interior.columns) * 100)} cm breit, {Math.round(innerHeight(f) * 100)} cm hoch, {Math.round(f.depth * 100)} cm tief
            {sum ? ` · ${sum.shelves} Fachböden, ${sum.drawers} Schubladen, ${sum.rods} Stangen` : ''}
          </p>
          <InteriorFront f={f} interior={interior} bad={bad} />
          <label className="check">
            <input type="checkbox" checked={open} onChange={() => useUiStore.getState().toggleInteriorOpen(f.id)} />
            <span>Schrank geöffnet zeigen (2D und 3D)</span>
          </label>
          {interior.parts.map((p, i) => (
            <div key={i} className="interior-part" data-testid="interior-part" style={{ borderLeft: bad.has(i) ? '3px solid #dc2626' : '3px solid transparent', paddingLeft: 6 }}>
              <strong>
                {KIND_LABEL[p.kind]} {i + 1}
              </strong>
              <NumberField label="Spalte" value={p.column + 1} min={1} max={interior.columns} digits={0} onChange={(v) => set((x) => void (x.parts[i].column = Math.max(0, Math.min(x.columns - 1, Math.round(v) - 1))))} />
              <NumberField label={p.kind === 'rod' ? 'Höhe der Stange' : 'Höhe von unten'} value={p.z} factor={100} unit="cm" min={0} max={f.height * 100} digits={1} onChange={(v) => set((x) => void (x.parts[i].z = v))} />
              {p.kind === 'drawer' && (
                <NumberField label="Höhe der Schublade" value={p.h ?? DEFAULT_DRAWER_HEIGHT} factor={100} unit="cm" min={1} max={f.height * 100} digits={1} onChange={(v) => set((x) => void (x.parts[i].h = v))} />
              )}
              <button className="link-btn" onClick={() => set((x) => void x.parts.splice(i, 1))}>
                Entfernen
              </button>
            </div>
          ))}
        </>
      )}
      <div className="btn-row">
        <button onClick={() => addPart('shelf')}>+ Fachboden</button>
        <button onClick={() => addPart('drawer')}>+ Schublade</button>
        <button onClick={() => addPart('rod')}>+ Stange</button>
      </div>
      {issues.length > 0 && (
        <ul className="small" data-testid="interior-issues">
          {issues.map((x, i) => (
            <li key={i}>{x.message}</li>
          ))}
        </ul>
      )}
      {interior && (
        <button className="link-btn" onClick={() => upd((x) => void delete x.interior)}>
          Aufteilung entfernen
        </button>
      )}
      <p className="muted small">Mindestmaße sind Richtwerte (Schublade ab 10 cm Höhe, 30 cm Breite; Stange ab 40 cm Breite, 45 cm Tiefe, 60 cm Hängelänge), keine Herstellerangabe.</p>
    </PanelGroup>
  );
}
