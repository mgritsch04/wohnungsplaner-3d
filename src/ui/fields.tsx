import { useEffect, useId, useState, type ReactNode } from 'react';
import { useProjectStore } from '../store/projectStore';
import { usePanelGroupOpen, usePanelGroupStore } from './panelGroupStore';

interface NumberFieldProps {
  label: string;
  /** Value in base units (meters for lengths). */
  value: number;
  onChange: (v: number) => void;
  /** Display factor: 100 shows meters as cm. */
  factor?: number;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  disabled?: boolean;
  title?: string;
}

/**
 * Numeric input that commits on Enter/blur, accepts German decimal commas,
 * validates against min/max (in display units) and reverts invalid input.
 */
export function NumberField({ label, value, onChange, factor = 1, unit, min, max, step, digits = 1, disabled, title }: NumberFieldProps) {
  const fmt = (v: number) => {
    const x = v * factor;
    return String(Math.round(x * 10 ** digits) / 10 ** digits).replace('.', ',');
  };
  const [text, setText] = useState(fmt(value));
  const [error, setError] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmt(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);

  const commit = () => {
    const parsed = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
      setError(true);
      setText(fmt(value));
      setTimeout(() => setError(false), 1200);
      return;
    }
    setError(false);
    const next = parsed / factor;
    if (Math.abs(next - value) > 1e-9) onChange(next);
  };

  return (
    <label className={`field ${error ? 'field-error' : ''}`} title={title ?? (min !== undefined && max !== undefined ? `${min} – ${max} ${unit ?? ''}` : undefined)}>
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          step={step}
          onFocus={(e) => {
            setFocused(true);
            e.target.select();
          }}
          onBlur={() => {
            setFocused(false);
            commit();
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setText(fmt(value));
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const s = (step ?? 1) * (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
              const cur = parseFloat(text.replace(',', '.'));
              if (Number.isFinite(cur)) {
                let n = cur + s;
                if (min !== undefined) n = Math.max(min, n);
                if (max !== undefined) n = Math.min(max, n);
                onChange(n / factor);
                setText(String(Math.round(n * 10 ** digits) / 10 ** digits).replace('.', ','));
              }
            }
          }}
        />
        {unit && <span className="field-unit">{unit}</span>}
      </span>
    </label>
  );
}

/**
 * Slider 0–360° for an angle (degrees). One drag is one undo step: the project store runs a transaction
 * from pointer down to release, so `onChange` may use the normal (collision-checked) actions.
 */
export function AngleSlider({ value, onChange, label, testId, disabled }: { value: number; onChange: (deg: number) => void; label: string; testId?: string; disabled?: boolean }) {
  const st = () => useProjectStore.getState();
  const end = () => st().commitTransaction();
  return (
    <input
      type="range"
      min={0}
      max={360}
      step={1}
      value={((Math.round(value) % 360) + 360) % 360}
      disabled={disabled}
      aria-label={label}
      data-testid={testId}
      onPointerDown={() => st().beginTransaction()}
      onPointerUp={end}
      onPointerCancel={end}
      onBlur={end}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value);
  }, [value, focused]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          value={text}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (text !== value) onChange(text);
          }}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      </span>
    </label>
  );
}

export function SelectField<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function CheckField({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <label className="check" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
      <div className="panel-section-body">{children}</div>
    </section>
  );
}

/**
 * Collapsible group of the properties panel (#99). The heading is a button
 * (`aria-expanded`, Enter/Space); the open state is kept per kind of group
 * (`groupKey`, e.g. `furniture.product`), so it survives selecting another object.
 * Closed groups do not render their fields.
 */
export function PanelGroup({ groupKey, title, defaultOpen = true, actions, children }: { groupKey: string; title: string; defaultOpen?: boolean; actions?: ReactNode; children: ReactNode }) {
  const open = usePanelGroupOpen(groupKey, defaultOpen);
  const bodyId = useId();
  return (
    <section className={`panel-section panel-group${open ? '' : ' panel-group-collapsed'}`} data-group={groupKey}>
      <header>
        <h3>
          <button
            type="button"
            className="panel-group-toggle"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => usePanelGroupStore.getState().setOpen(groupKey, !open)}
            // the 2D editor uses Space for panning (window listener, preventDefault) – keep it from swallowing the button press
            onKeyDown={(e) => e.key === ' ' && e.stopPropagation()}
          >
            <svg className="panel-group-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
            {title}
          </button>
        </h3>
        {actions}
      </header>
      <div id={bodyId} className="panel-section-body" hidden={!open}>
        {open ? children : null}
      </div>
    </section>
  );
}

export function Badge({ kind, children, title }: { kind: 'ok' | 'warn' | 'info' | 'muted' | 'error'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${kind}`} title={title}>
      {children}
    </span>
  );
}
