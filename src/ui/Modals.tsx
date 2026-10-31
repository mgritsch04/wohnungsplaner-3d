import { Fragment, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { deleteProject, listProjects, type ProjectMeta } from '../persistence/projects';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { openProject } from './actions';
import { confirmDialog, useDialogStore } from './dialogStore';
import { importPdfPage } from '../import/underlayImport';
import { ProductImportModal } from './ProductImportModal';
import { ModelImportModal } from './ModelImportModal';
import { BugReportModal } from './BugReportModal';
import { SHORTCUT_GROUPS } from './shortcutCatalog';
import { HELP_TEXTS } from './helpTexts';
import { CommandPalette } from './palette/CommandPalette';
import { VersionsModal } from '../versions/VersionsModal';

export function ModalHost() {
  const modal = useDialogStore((s) => s.modal);
  const confirm = useDialogStore((s) => s.confirmRequest);
  const palette = useDialogStore((s) => s.paletteOpen);
  return (
    <>
      {palette && <CommandPalette />}
      {modal === 'projects' && <ProjectsModal />}
      {modal === 'help' && <HelpModal />}
      {modal === 'pdfPage' && <PdfPageModal />}
      {modal === 'product' && <ProductImportModal />}
      {modal === 'model' && <ModelImportModal />}
      {modal === 'bugReport' && <BugReportModal />}
      {modal === 'versions' && <VersionsModal />}
      {confirm && (
        <div className="modal-backdrop" onMouseDown={() => confirm.resolve(false)}>
          <div className="modal small" role="alertdialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <h2>{confirm.title}</h2>
            <p>{confirm.message}</p>
            <div className="btn-row end">
              <button onClick={() => confirm.resolve(false)}>Abbrechen</button>
              <button className={confirm.danger ? 'danger-solid' : 'primary'} autoFocus onClick={() => confirm.resolve(true)}>
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Modal({ title, children, wide }: { title: string; children: React.ReactNode; wide?: boolean }) {
  const close = useDialogStore((s) => s.closeModal);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function ProjectsModal() {
  const [items, setItems] = useState<ProjectMeta[] | null>(null);
  const currentId = useProjectStore((s) => s.project.id);
  const close = useDialogStore((s) => s.closeModal);
  const refresh = () => listProjects().then(setItems).catch(() => setItems([]));
  useEffect(() => {
    void refresh();
  }, []);
  return (
    <Modal title="Gespeicherte Projekte">
      {items === null && <p>Lade…</p>}
      {items?.length === 0 && <p className="muted">Noch keine gespeicherten Projekte.</p>}
      <ul className="project-list">
        {items?.map((m) => (
          <li key={m.id} className={m.id === currentId ? 'current' : ''}>
            <div>
              <strong>{m.name}</strong>
              <span className="muted small">
                {new Date(m.updatedAt).toLocaleString('de-AT')} · {m.rooms} Räume · {m.items} Objekte
              </span>
            </div>
            <div className="btn-row">
              {m.id === currentId ? (
                <span className="muted small">geöffnet</span>
              ) : (
                <button
                  className="primary"
                  onClick={async () => {
                    close();
                    await openProject(m.id);
                  }}
                >
                  Öffnen
                </button>
              )}
              <button
                className="danger"
                disabled={m.id === currentId}
                title={m.id === currentId ? 'Das geöffnete Projekt kann nicht gelöscht werden' : ''}
                onClick={async () => {
                  if (await confirmDialog(`Projekt „${m.name}“ endgültig löschen?`, { confirmLabel: 'Löschen', danger: true })) {
                    await deleteProject(m.id);
                    void refresh();
                  }
                }}
              >
                Löschen
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">Projekte werden nur lokal in diesem Browser gespeichert. Für Sicherungen oder andere Geräte: Export → Projektpaket.</p>
    </Modal>
  );
}

function PdfPageModal() {
  const data = useDialogStore((s) => s.modalData) as { pdf: PDFDocumentProxy; file: File } | null;
  const close = useDialogStore((s) => s.closeModal);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const { renderPdfThumbnail } = await import('../import/pdf');
      const n = Math.min(data.pdf.numPages, 40);
      for (let i = 1; i <= n && !cancelled; i++) {
        try {
          const page = await data.pdf.getPage(i);
          const url = await renderPdfThumbnail(page);
          urls.push(url);
          if (!cancelled) setThumbs((t) => ({ ...t, [i]: url }));
        } catch {
          /* thumbnail is optional */
        }
      }
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [data]);
  if (!data) return null;
  return (
    <Modal title={`Seite wählen – ${data.file.name}`} wide>
      <p className="muted small">Das PDF hat {data.pdf.numPages} Seiten. Welche Seite enthält den Grundriss?</p>
      <div className="page-grid">
        {Array.from({ length: data.pdf.numPages }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className="page-thumb"
            onClick={() => {
              close();
              void importPdfPage(data.file, data.pdf, n);
            }}
          >
            {thumbs[n] ? <img src={thumbs[n]} alt={`Seite ${n}`} /> : <span className="thumb-placeholder">…</span>}
            <span>Seite {n}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function HelpModal() {
  return (
    <Modal title="Hilfe & Tastenkürzel" wide>
      <div className="help-grid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3>
              {g.title} <span className="muted small">· {g.where}</span>
            </h3>
            <dl className="kbd-list">
              {g.items.map((it) => (
                <Fragment key={it.keys}>
                  <dt>{it.keys}</dt>
                  <dd>{it.action}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <h3>Begriffe</h3>
      <dl className="term-list">
        {Object.entries(HELP_TEXTS).map(([id, t]) => (
          <Fragment key={id}>
            <dt>{t.term}</dt>
            <dd className="small">{t.text}</dd>
          </Fragment>
        ))}
      </dl>
      <h3>Koordinaten & Einheiten</h3>
      <p className="small">
        Alle Maße werden intern in Metern gespeichert und in Zentimetern angezeigt. Im Grundriss zeigt x nach rechts und y nach unten; in 3D ist die Höhe die Y-Achse. Raummaße im
        Plan sind lichte Innenmaße.
      </p>
      <p className="small muted">Entwurfswerkzeug ohne Gewähr – keine Prüfung von Bau-, Elektro- oder Installationsvorschriften.</p>
      <div className="btn-row end">
        <button onClick={() => useDialogStore.getState().openModal('bugReport')}>Problem melden …</button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)} role="status">
          {t.text}
        </div>
      ))}
    </div>
  );
}
