import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { derivePlan } from '../model/derived';
import { markKindInfo, markLabels, marksByRoom } from '../model/marks';
import type { Project } from '../model/schema';
import { useAssetUrl } from '../persistence/useAssetUrl';
import { useProjectStore } from '../store/projectStore';
import { PAGE_MARGIN_MM, PX_PER_MM, fitPlanToBox, padBounds, planBounds, planBoxOnA4 } from './planExport';
import { PlanSheet, SHEET_FOOTER, SHEET_PAD } from './PlanSheet';

/** Übergabeprotokoll und Bohrloch-Plan (Mieter-Paket, #362): Druckansicht wie beim Plan-PDF. */
export const useHandoverStore = create<{ open: boolean; setOpen: (o: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }));
export const openHandoverView = () => useHandoverStore.getState().setOpen(true);
const close = () => useHandoverStore.getState().setOpen(false);

export function HandoverViewHost() {
  const open = useHandoverStore((s) => s.open);
  return open ? createPortal(<HandoverView />, document.body) : null;
}

function HandoverView() {
  const project = useProjectStore((s) => s.project);
  const derived = useMemo(() => derivePlan(project), [project]);
  const now = useMemo(() => new Date(), []);
  const labels = useMemo(() => markLabels(project.marks), [project.marks]);
  const groups = useMemo(() => marksByRoom(project, derived), [project, derived]);

  const sheet = useMemo(() => {
    const b = planBounds(project, derived);
    if (!b) return null;
    const bounds = padBounds(b, 0.15);
    const box = planBoxOnA4('portrait');
    const fit = fitPlanToBox(bounds, box.widthMm - (2 * SHEET_PAD) / PX_PER_MM, box.heightMm * 0.6 - (SHEET_PAD + SHEET_FOOTER) / PX_PER_MM);
    return { bounds, fit };
  }, [project, derived]);

  const only = (kinds: Project['marks'][number]['kind'][]): Project => ({ ...project, marks: project.marks.filter((m) => kinds.includes(m.kind)) });
  const conditionProject = useMemo(() => only(['condition']), [project]); // eslint-disable-line react-hooks/exhaustive-deps
  const drillProject = useMemo(() => only(['drill', 'glue']), [project]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const prev = document.title;
    document.title = `uebergabeprotokoll-${now.toISOString().slice(0, 10)}`;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      document.title = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [now]);

  const plan = (p: Project, testId: string, title: string) => (
    <section className="handover-plan" data-testid={testId}>
      <h2>{title}</h2>
      {sheet ? <PlanSheet project={p} derived={derived} bounds={sheet.bounds} pxPerM={sheet.fit.pxPerM} scaleDenominator={sheet.fit.denominator} physical /> : <p className="muted">Der Plan ist noch leer.</p>}
    </section>
  );

  return (
    <div className="print-view" data-testid="handover-view" role="dialog" aria-label="Übergabeprotokoll">
      <style>{`@page { size: A4 portrait; margin: ${PAGE_MARGIN_MM}mm; }`}</style>
      <div className="print-controls">
        <button className="primary" onClick={() => window.print()}>
          Drucken / Als PDF speichern
        </button>
        <button onClick={close}>Schließen</button>
        <span className="muted small">Fotos bleiben auf diesem Gerät; im PDF sind sie eingebettet. Im Druckdialog „Als PDF speichern“ wählen.</span>
      </div>
      <div className="print-page handover-page">
        <header className="print-header">
          <h1>Übergabeprotokoll{project.name ? ` – ${project.name}` : ''}</h1>
          <span>{now.toLocaleDateString('de-AT')}</span>
        </header>
        <p className="muted">
          {project.marks.length} Markierung(en): Zustand beim Einzug (Z), Bohrlöcher (B) und Klebestellen (K). Rückgabe und Kaution: Zustand und Eingriffe sind hier je Raum festgehalten.
        </p>
        {plan(conditionProject, 'handover-plan-condition', 'Zustand je Raum')}
        {plan(drillProject, 'handover-plan-drill', 'Bohrloch-Plan (gebohrt und geklebt)')}
        {groups.length === 0 && <p className="muted" data-testid="handover-empty">Noch keine Markierungen gesetzt.</p>}
        {groups.map((g) => (
          <section key={g.room} className="handover-room print-list" data-testid="handover-room">
            <h2>{g.room}</h2>
            <table>
              <thead>
                <tr>
                  <th>Nr.</th>
                  <th>Art</th>
                  <th>Notiz</th>
                  <th>Foto</th>
                </tr>
              </thead>
              <tbody>
                {g.marks.map((m) => (
                  <tr key={m.id} data-testid="handover-mark">
                    <td>
                      <strong>{labels.get(m.id)}</strong>
                    </td>
                    <td>{markKindInfo(m.kind).label}</td>
                    <td>{m.note || <span className="muted">–</span>}</td>
                    <td>
                      <HandoverPhoto assetId={m.photoAssetId} label={labels.get(m.id)!} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </div>
  );
}

function HandoverPhoto({ assetId, label }: { assetId?: string; label: string }) {
  const { url, missing } = useAssetUrl(assetId);
  if (!assetId) return <span className="muted">–</span>;
  if (missing) return <span className="muted">Foto fehlt</span>;
  return url ? <img src={url} alt={`Foto ${label}`} className="handover-photo" /> : null;
}
