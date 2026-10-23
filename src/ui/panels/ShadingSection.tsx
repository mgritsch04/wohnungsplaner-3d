import type { Furniture, Opening } from '../../model/schema';
import { canHaveShading, closedLabel, SHADING_LABEL, SHADING_TYPES } from '../../model/shading';
import { CheckField, NumberField, PanelGroup, SelectField, TextField } from '../fields';
import { setCurtainClosed, setShading } from '../shadingActions';

/** Closing degree slider shared by window coverings and curtains: offen / halb / zu. */
function ClosedSlider({ value, onChange, testId }: { value: number; onChange: (v: number) => void; testId: string }) {
  return (
    <div className="field">
      <span className="field-label">Zustand</span>
      <span className="field-input">
        <input type="range" min={0} max={100} step={5} value={Math.round(value * 100)} aria-label="Zustand offen bis zu" data-testid={testId} onChange={(e) => onChange(Number(e.target.value) / 100)} />
        <span className="small" data-testid={`${testId}-label`}> {closedLabel(value)}</span>
      </span>
      <span className="btn-row">
        <button onClick={() => onChange(0)}>Offen</button>
        <button onClick={() => onChange(0.5)}>Halb</button>
        <button onClick={() => onChange(1)}>Zu</button>
      </span>
    </div>
  );
}

/** Window covering (roller shutter, venetian or pleated blind) of a window, #413. */
export function OpeningShadingSection({ o }: { o: Opening }) {
  if (!canHaveShading(o)) return null;
  const s = o.shading;
  return (
    <PanelGroup groupKey="opening.shading" title="Behang (Jalousie, Rollladen)">
      <SelectField
        label="Art"
        value={s?.type ?? 'none'}
        options={[{ value: 'none', label: 'Keiner' }, ...SHADING_TYPES.map((t) => ({ value: t as string, label: SHADING_LABEL[t] }))]}
        onChange={(v) => setShading(o.id, v === 'none' ? null : { type: v as (typeof SHADING_TYPES)[number] })}
      />
      {s && (
        <>
          <ClosedSlider value={s.closed} onChange={(closed) => setShading(o.id, { closed })} testId="shading-closed" />
          <CheckField label="Motor / Funk (smart steuerbar)" checked={s.motor} onChange={(motor) => setShading(o.id, { motor })} title="Im Reiter Smart Home ein „Jalousie-/Vorhang-Antrieb“ hinzufügen, um den Behang per Regel zu steuern" />
          <TextField label="Produkt (eigene Eingabe)" value={s.productName ?? ''} onChange={(v) => setShading(o.id, { productName: v.slice(0, 200) || undefined })} />
          <TextField label="Link zum Produkt" value={s.productUrl ?? ''} onChange={(v) => setShading(o.id, { productUrl: v.slice(0, 2000) || undefined })} />
          <NumberField label="Preis" unit="€" digits={2} min={0} max={100000} value={s.price ?? 0} onChange={(v) => setShading(o.id, { price: v > 0 ? v : undefined })} />
          <p className="muted small">Doppelklick auf den Behang in 3D schaltet offen → halb → zu.</p>
        </>
      )}
    </PanelGroup>
  );
}

/** Open/close state of a curtain, #413. */
export function CurtainStateSection({ f }: { f: Furniture }) {
  return (
    <PanelGroup groupKey="furniture.curtain" title="Vorhang öffnen / schließen">
      <ClosedSlider value={f.closed ?? 0} onChange={(v) => setCurtainClosed(f.id, v)} testId="curtain-closed" />
      <p className="muted small">Doppelklick auf den Vorhang in 3D schaltet offen → halb → zu.</p>
    </PanelGroup>
  );
}
