import { useMemo, useState } from 'react';
import { GENERIC_CATALOG } from '../../catalog/generic';
import { generateCountertops, kitchenChecksForItem, kitchenComponents, placeKitchenRun, wallFaceLength, type RunModule } from '../../kitchen/kitchen';
import { formatEuro, formatLength } from '../../model/units';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { Badge, NumberField, Section, SelectField } from '../fields';

const MODULES = GENERIC_CATALOG.filter((c) => c.kitchen && c.kitchen.type !== 'countertop');

export function KitchenPanel() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const [run, setRun] = useState<RunModule[]>([
    { catalogId: 'generic-k-tall-60' },
    { catalogId: 'generic-k-drawer-60' },
    { catalogId: 'generic-k-sink-80' },
    { catalogId: 'generic-k-dishwasher' },
    { catalogId: 'generic-k-oven' },
    { catalogId: 'generic-k-base-40' },
  ]);
  const [side, setSide] = useState<1 | -1>(1);
  const [start, setStart] = useState(0);
  const [frontColor, setFrontColor] = useState('#f2f0eb');
  const wallId = selection?.type === 'wall' ? selection.id : null;
  const faceLen = wallId ? wallFaceLength(project, wallId) : 0;
  const runLen = run.reduce((s, m) => {
    const it = MODULES.find((x) => x.id === m.catalogId);
    if (!it || ['wall', 'hood', 'cooktop'].includes(it.kitchen!.type)) return s;
    return s + (m.width ?? it.width);
  }, 0);
  const comps = useMemo(() => kitchenComponents(project), [project]);
  const problems = useMemo(
    () =>
      project.furniture
        .filter((f) => f.kitchen)
        .flatMap((f) => kitchenChecksForItem(project, f.id).map((msg) => ({ id: f.id, name: f.name, msg }))),
    [project],
  );

  return (
    <div className="panel-scroll">
      <Section title="Küchenzeile planen">
        <p className="muted small">
          1. Im Plan eine Wand anklicken. 2. Module zusammenstellen. 3. Platzieren. Module sind normale Objekte – danach frei verschieb- und editierbar.
        </p>
        {wallId ? (
          <p className="small">
            Wand gewählt · nutzbare Länge ca. <strong>{formatLength(faceLen)}</strong> · Zeile: <strong>{formatLength(runLen)}</strong>{' '}
            {start + runLen > faceLen + 0.005 && <Badge kind="error">zu lang</Badge>}
          </p>
        ) : (
          <p className="warning small">Bitte zuerst im Plan eine Wand auswählen.</p>
        )}
        <div className="field-row">
          <SelectField label="Wandseite" value={side === 1 ? 'l' : 'r'} options={[{ value: 'l', label: 'Seite A' }, { value: 'r', label: 'Seite B' }]} onChange={(v) => setSide(v === 'l' ? 1 : -1)} />
          <NumberField label="Start ab Wandanfang" value={start} factor={100} unit="cm" min={0} max={10000} onChange={setStart} />
        </div>
        <ol className="run-list">
          {run.map((m, i) => {
            const it = MODULES.find((x) => x.id === m.catalogId);
            return (
              <li key={i}>
                <select value={m.catalogId} onChange={(e) => setRun(run.map((r, k) => (k === i ? { catalogId: e.target.value } : r)))} aria-label="Modul">
                  {MODULES.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
                <input
                  className="w-num"
                  type="number"
                  min={15}
                  max={150}
                  step={5}
                  value={Math.round((m.width ?? it?.width ?? 0.6) * 100)}
                  onChange={(e) => setRun(run.map((r, k) => (k === i ? { ...r, width: Math.max(0.15, Number(e.target.value) / 100) } : r)))}
                  aria-label="Breite in cm"
                  title="Breite (cm)"
                />
                <button aria-label="Nach oben" disabled={i === 0} onClick={() => setRun(swap(run, i, i - 1))}>
                  ↑
                </button>
                <button aria-label="Entfernen" onClick={() => setRun(run.filter((_, k) => k !== i))}>
                  ×
                </button>
              </li>
            );
          })}
        </ol>
        <div className="btn-row">
          <button onClick={() => setRun([...run, { catalogId: 'generic-k-base-60' }])}>+ Unterschrank</button>
          <button onClick={() => setRun([...run, { catalogId: 'generic-k-wall-60' }])}>+ Oberschrank</button>
        </div>
        <label className="field">
          <span className="field-label">Frontfarbe</span>
          <span className="field-input">
            <input type="color" value={frontColor} onChange={(e) => setFrontColor(e.target.value)} />
          </span>
        </label>
        <button
          className="primary block"
          disabled={!wallId || run.length === 0}
          onClick={() => {
            if (!wallId) return;
            let n = 0;
            apply((d) => {
              n = placeKitchenRun(d, { wallId, side, start, modules: run, frontColor }).length;
              generateCountertops(d);
            });
            useUiStore.getState().toast(`${n} Küchenmodule platziert, Arbeitsplatten erzeugt.`, 'success');
          }}
        >
          Küchenzeile platzieren
        </button>
        <p className="muted small">Oberschränke, Hauben und Kochfelder hängen über der Zeile und verlängern sie nicht. Tipp: falsche Seite? „Wandseite“ wechseln und mit Strg+Z zurück.</p>
      </Section>
      <Section title="Arbeitsplatten">
        <button
          className="block"
          onClick={() => {
            let n = 0;
            apply((d) => {
              n = generateCountertops(d);
            });
            useUiStore.getState().toast(n ? `${n} Arbeitsplatte(n) neu erzeugt.` : 'Keine Unterschränke gefunden.', n ? 'success' : 'info');
          }}
        >
          Arbeitsplatten neu erzeugen
        </button>
        <p className="muted small">Erzeugt durchgehende Platten über aneinandergereihten Unterschränken (nach dem Verschieben von Modulen erneut ausführen).</p>
      </Section>
      <Section title="Stückliste Küche">
        {comps.components.length === 0 ? (
          <p className="muted small">Noch keine Küchenmodule.</p>
        ) : (
          <>
            <ul className="plain">
              {comps.components.map((c) => (
                <li key={c.label} className="row-between small">
                  <span>
                    {c.count}× {c.label}
                  </span>
                  <span>
                    {formatEuro(c.total)} {c.missingPrices > 0 && <Badge kind="error">{c.missingPrices} ohne Preis</Badge>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="row-between">
              <strong>Summe</strong>
              <strong>{formatEuro(comps.total)}</strong>
            </p>
            <p className="muted small">Arbeitsplatte gesamt: {formatLength(comps.countertopLength)}. Preise der generischen Module sind Schätzungen.</p>
          </>
        )}
      </Section>
      {problems.length > 0 && (
        <Section title={`Konflikte (${problems.length})`}>
          <ul className="issues">
            {problems.map((p, i) => (
              <li key={i}>
                <button className="link-btn" onClick={() => useUiStore.getState().setSelection({ type: 'furniture', id: p.id })}>
                  {p.name}: {p.msg}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      <p className="muted small padded">
        Hinweis: Der Küchenplaner ist eine Entwurfshilfe. Elektro-, Wasser-, Abluft- und Bauvorschriften werden nicht geprüft – bitte mit Fachbetrieben abstimmen.
      </p>
    </div>
  );
}

function swap<T>(arr: T[], i: number, j: number): T[] {
  const c = [...arr];
  [c[i], c[j]] = [c[j], c[i]];
  return c;
}
