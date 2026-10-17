import type { PDFDocumentProxy } from 'pdfjs-dist';
import { newId } from '../model/ids';
import type { Underlay } from '../model/schema';
import { db } from '../persistence/db';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { reportError } from '../ui/actions';
import { pickFile } from '../ui/fileUtils';
import { confirmDialog, useDialogStore } from '../ui/dialogStore';
import { matchDimensions } from './dimensions';
import { MAX_IMAGE_PIXELS, PlanFileError, validatePlanFile, type PlanFileKind } from './fileValidation';
import { useImportStore, useSourceAnalysis } from './importStore';

/** Provisional display size (long side) for uncalibrated plans. NOT a real scale. */
const PROVISIONAL_LONG_SIDE_M = 15;

/** File types accepted for a plan underlay (PDF or image). */
export const PLAN_FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg';

/**
 * "Grundriss importieren" from outside the import panel (start card, project menu, #214):
 * shows the import panel and opens the file picker right away, so the click visibly does something.
 */
export async function importPlanFile() {
  useUiStore.getState().setLeftTab('import');
  const file = await pickFile(PLAN_FILE_ACCEPT);
  if (file) await startPlanImport(file);
}

/** Entry point: validate the file, ask for a PDF page if needed, create the underlay. */
export async function startPlanImport(file: File) {
  const progress = useImportStore.getState().setProgress;
  try {
    const existing = useProjectStore.getState().project.underlay;
    if (existing && !(await confirmDialog('Der bestehende Plan-Hintergrund wird ersetzt. Fortfahren?', { confirmLabel: 'Ersetzen' }))) return;
    progress({ label: 'Datei wird geprüft…', value: 0.05 });
    const kind = await validatePlanFile(file);
    if (kind === 'pdf') {
      progress({ label: 'PDF wird geöffnet…', value: 0.15 });
      const { openPdf } = await import('./pdf');
      const pdf = await openPdf(await file.arrayBuffer());
      if (pdf.numPages > 1) {
        progress(null);
        useDialogStore.getState().openModal('pdfPage', { pdf, file });
        return;
      }
      await importPdfPage(file, pdf, 1);
    } else {
      await importImage(file, kind);
    }
  } catch (e) {
    reportError(e, 'Plan-Import fehlgeschlagen');
  } finally {
    progress(null);
  }
}

export async function importPdfPage(file: File, pdf: PDFDocumentProxy, pageNumber: number) {
  const progress = useImportStore.getState().setProgress;
  try {
    const { renderPdfPage, analyzePdfPage } = await import('./pdf');
    progress({ label: `Seite ${pageNumber} wird gerendert…`, value: 0.3 });
    const page = await pdf.getPage(pageNumber);
    const rendered = await renderPdfPage(page);
    progress({ label: 'Inhalt wird analysiert…', value: 0.65 });
    const analysis = await analyzePdfPage(page, rendered.pixelsPerPoint).catch(() => null);
    progress({ label: 'Wird gespeichert…', value: 0.85 });
    const imageAssetId = newId('asset');
    const sourceAssetId = newId('asset');
    await db.putAsset(imageAssetId, rendered.blob);
    await db.putAsset(sourceAssetId, file);
    setUnderlay({
      imageAssetId,
      sourceAssetId,
      fileName: file.name,
      sourceKind: 'pdf',
      pdfPage: pageNumber,
      pdfPageCount: pdf.numPages,
      pdfContent: analysis?.kind ?? 'unknown',
      pixelsPerPoint: rendered.pixelsPerPoint,
      pixelWidth: rendered.width,
      pixelHeight: rendered.height,
    });
    if (analysis) {
      const dimensions = matchDimensions(analysis.texts, analysis.segments.filter((s) => !s.curve));
      useSourceAnalysis.getState().set({ imageAssetId, kind: analysis.kind, segments: analysis.segments, texts: analysis.texts, dimensions });
    }
    const kindLabel = analysis?.kind === 'vector' ? 'Vektor-PDF' : analysis?.kind === 'raster' ? 'gescanntes PDF (Rasterbild)' : analysis?.kind === 'mixed' ? 'gemischtes PDF' : 'PDF';
    useUiStore.getState().toast(`${kindLabel} importiert (${rendered.width}×${rendered.height} px). Bitte jetzt den Maßstab kalibrieren.`, 'success');
    void pdf.loadingTask.destroy();
  } catch (e) {
    reportError(e, 'PDF-Seite konnte nicht importiert werden');
  } finally {
    progress(null);
  }
}

async function importImage(file: File, kind: PlanFileKind) {
  const progress = useImportStore.getState().setProgress;
  progress({ label: 'Bild wird gelesen…', value: 0.4 });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PlanFileError('Das Bild ist beschädigt oder kann nicht gelesen werden.');
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width * height > MAX_IMAGE_PIXELS) throw new PlanFileError(`Das Bild ist zu groß (${width}×${height} px, max. ${MAX_IMAGE_PIXELS / 1e6} Megapixel).`);
  progress({ label: 'Wird gespeichert…', value: 0.8 });
  const imageAssetId = newId('asset');
  await db.putAsset(imageAssetId, file);
  setUnderlay({
    imageAssetId,
    sourceAssetId: imageAssetId,
    fileName: file.name,
    sourceKind: kind,
    pixelWidth: width,
    pixelHeight: height,
  });
  useSourceAnalysis.getState().set({ imageAssetId, kind: 'raster', segments: [], texts: [] });
  useUiStore.getState().toast(`Bild importiert (${width}×${height} px). Bitte jetzt den Maßstab kalibrieren.`, 'success');
}

function setUnderlay(u: Pick<Underlay, 'imageAssetId' | 'sourceAssetId' | 'fileName' | 'sourceKind' | 'pixelWidth' | 'pixelHeight'> & Partial<Underlay>) {
  const view = useUiStore.getState().view2d;
  const mpp = PROVISIONAL_LONG_SIDE_M / Math.max(u.pixelWidth, u.pixelHeight);
  const underlay: Underlay = {
    pdfContent: undefined,
    ...u,
    metersPerPixel: mpp,
    calibrated: false,
    scaleSource: 'none',
    checks: [],
    x: view.cx - (u.pixelWidth * mpp) / 2,
    y: view.cy - (u.pixelHeight * mpp) / 2,
    rotation: 0,
    opacity: 0.55,
    visible: true,
    locked: false,
  };
  useProjectStore.getState().apply((d) => {
    d.underlay = underlay;
  });
  useUiStore.getState().requestFit();
}

/** Apply a stated drawing scale (e.g. 1:100) for PDFs. Marked as unverified. */
export function applyScaleNotation(denominator: number) {
  useProjectStore.getState().apply((d) => {
    const u = d.underlay;
    if (!u || !u.pixelsPerPoint) return;
    const metersPerPoint = ((25.4 / 72) * denominator) / 1000;
    u.metersPerPixel = metersPerPoint / u.pixelsPerPoint;
    u.scaleSource = 'notation';
    u.calibrated = false;
  });
}

export async function removeUnderlay() {
  const u = useProjectStore.getState().project.underlay;
  if (!u) return;
  if (!(await confirmDialog('Plan-Hintergrund entfernen? Die nachgezeichneten Wände bleiben erhalten.', { confirmLabel: 'Entfernen', danger: true }))) return;
  useProjectStore.getState().apply((d) => {
    d.underlay = null;
  });
  useSourceAnalysis.getState().set(null);
}
