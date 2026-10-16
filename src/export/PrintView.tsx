import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { computeBudget, groupBudgetLines } from '../budget/budget';
import { derivePlan } from '../model/derived';
import { formatEuro } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { PAGE_MARGIN_MM, PX_PER_MM, fitPlanToBox, padBounds, planBounds, planBoxOnA4, planFileName, type PageOrientation } from './planExport';
import { exportPlanPng } from './exportPng';
import { PlanSheet, SHEET_FOOTER, SHEET_PAD } from './PlanSheet';

interface PrintStore {
  open: boolean;
  orientation: PageOrientation;
  setOpen: (open: boolean) => void;
  setOrientation: (o: PageOrientation) => void;
}

export const usePrintStore = create<PrintStore>((set) => ({
  open: false,
  orientation: 'portrait',
  setOpen: (open) => set({ open }),
  setOrientation: (orientation) => set({ orientation }),
}));

export const openPrintView = () => usePrintStore.getState().setOpen(true);
const close = () => usePrintStore.getState().setOpen(false);

/** Mounted once in App; renders nothing until the print view is opened. */
export function PrintViewHost() {
  const open = usePrintStore((s) => s.open);
  return open ? createPortal(<PrintView />, document.body) : null;
}

function PrintView() {
  const project = useProjectStore((s) => s.project);
  const orientation = usePrintStore((s) => s.orientation);
  const setOrientation = usePrintStore((s) => s.setOrientation);
  const derived = useMemo(() => derivePlan(project), [project]);
  const now = useMemo(() => new Date(), []);

  const sheet = useMemo(() => {
    const b = planBounds(project, derived);
    if (!b) return null;
    const bounds = padBounds(b, 0.15);
    // the sheet adds its own margins and the scale-bar footer around the drawing
    const box = planBoxOnA4(orientation);
    const extraW = (2 * SHEET_PAD) / PX_PER_MM;
    const extraH = (SHEET_PAD + SHEET_FOOTER) / PX_PER_MM;
    const fit = fitPlanToBox(bounds, box.widthMm - extraW, box.heightMm - extraH);
    return { bounds, fit };
  }, [project, derived, orientation]);

  const lines = useMemo(
    () => groupBudgetLines(computeBudget(project.furniture).lines).sort((a, b) => a.categoryLabel.localeCompare(b.categoryLabel) || a.name.localeCompare(b.name)),
    [project.furniture],
  );
  const total = lines.reduce((s, l) => s + (l.total ?? 0), 0);
  const missing = lines.filter((l) => l.total === null).length;

  useEffect(() => {
    // Chrome/Edge suggest the document title as PDF file name
    const prev = document.title;
    document.title = planFileName(project.name, now, 'pdf').replace(/\.pdf$/, '');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.title = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [project.name, now]);

  return (
    <div className="print-view" data-testid="print-view" role="dialog" aria-label="Druckansicht">
      <style>{`@page { size: A4 ${orientation}; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      <div className="print-controls" data-testid="print-controls">
        <button className="primary" onClick={() => window.print()}>
          Drucken / Als PDF speichern
        </button>
        <div className="segmented" role="group" aria-label="Seitenausrichtung">
          <button className={orientation === 'portrait' ? 'active' : ''} onClick={() => setOrientation('portrait')}>
            A4 hoch
          </button>
          <button className={orientation === 'landscape' ? 'active' : ''} onClick={() => setOrientation('landscape')}>
            A4 quer
          </button>
        </div>
        <button onClick={() => void exportPlanPng()}>Plan als PNG</button>
        <button onClick={close}>Schließen</button>
        <span className="muted small">Für ein PDF im Druckdialog „Als PDF speichern“ wählen.</span>
      </div>
      <div className={`print-page ${orientation}${lines.length > 22 ? ' dense' : ''}`}>
        <header className="print-header">
          <h1>{project.name || 'Grundriss'}</h1>
          <span>
            {now.toLocaleDateString('de-AT')}
            {sheet && ` · Maßstab 1:${sheet.fit.denominator}`}
          </span>
        </header>
        <div className="print-body">
          <div className="print-plan" data-testid="print-plan">
            {sheet ? (
              <PlanSheet project={project} derived={derived} bounds={sheet.bounds} pxPerM={sheet.fit.pxPerM} scaleDenominator={sheet.fit.denominator} physical />
            ) : (
              <p className="muted">Der Plan ist noch leer.</p>
            )}
          </div>
          <section className="print-list" data-testid="print-list">
            <h2>Stückliste</h2>
            {lines.length === 0 ? (
              <p className="muted">Keine Möbel oder Geräte im Projekt.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th className="num">Menge</th>
                    <th>Artikel</th>
                    <th>Maße B × T × H (cm)</th>
                    <th>Händler</th>
                    <th className="num">Summe</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="num">{l.quantity}</td>
                      <td>
                        {l.name}
                        <span className="muted"> · {l.categoryLabel}</span>
                      </td>
                      <td>{l.size}</td>
                      <td>{l.retailer}</td>
                      <td className="num">{l.total === null ? '–' : formatEuro(l.total)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>Summe (bekannte Preise){missing ? ` · ${missing} Position(en) ohne Preis` : ''}</td>
                    <td className="num">{formatEuro(total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
