import { newId } from '../../model/ids';
import { roundMm } from '../../model/units';
import { rotate } from '../../model/vec';
import { db } from '../../persistence/db';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { reportError } from '../../ui/actions';
import type { ReconstructionDraft } from '../draft';
import { useImportStore, useSourceAnalysis } from '../importStore';
import { findDraftConflicts } from '../review';
import { imageToWorld } from '../underlayTransform';
import { RECOGNIZERS } from './recognizers';
import type { RasterOutput } from './raster';
import type { Underlay } from '../../model/schema';

/** Run the best available local recognizer on the current underlay and open the review. */
export async function runRecognition() {
  const u = useProjectStore.getState().project.underlay;
  const progress = useImportStore.getState().setProgress;
  if (!u) return;
  if (!u.calibrated) {
    useUiStore.getState().toast('Bitte zuerst den Maßstab kalibrieren.', 'info');
    return;
  }
  try {
    progress({ label: 'Erkennung wird vorbereitet…', value: 0.02 });
    const image = await db.getAsset(u.imageAssetId);
    if (!image) throw new Error('Das Planbild ist lokal nicht mehr vorhanden.');
    const analysis = useSourceAnalysis.getState().analysis;
    const segments = analysis && analysis.imageAssetId === u.imageAssetId ? analysis.segments : undefined;
    const input = { image, pixelWidth: u.pixelWidth, pixelHeight: u.pixelHeight, metersPerPixel: u.metersPerPixel, vectorSegments: segments };
    const recognizer = RECOGNIZERS.find((r) => r.canHandle(input))!;
    progress({ label: `${recognizer.label}…`, value: 0.05 });
    let out = await recognizer.recognize(input, (v) => progress({ label: `${recognizer.label}…`, value: v }));
    let source: ReconstructionDraft['source'] = recognizer.id === 'local-vector' ? 'pdf-vector' : 'raster';
    // fall back to raster analysis if vector data yields nothing useful
    if (out.walls.length < 2 && recognizer.id === 'local-vector') {
      const raster = RECOGNIZERS.find((r) => r.id === 'local-raster')!;
      out = await raster.recognize(input, (v) => progress({ label: `${raster.label}…`, value: v }));
      source = 'raster';
    }
    const draft = outputToDraft(out, u, source, recognizer.label);
    if (draft.walls.length === 0) {
      useUiStore.getState().toast('Es wurden keine Wände erkannt. Bitte die Wände manuell nachzeichnen (Werkzeug „Wand“).', 'info');
      return;
    }
    draft.warnings.push(...findDraftConflicts(draft).map((c) => c.message));
    useImportStore.getState().setDraft(draft);
    useUiStore.getState().toast(`${draft.walls.length} Wände und ${draft.openings.length} Öffnungen vorgeschlagen – bitte prüfen.`, 'success');
  } catch (e) {
    reportError(e, 'Erkennung fehlgeschlagen');
  } finally {
    progress(null);
  }
}

export function outputToDraft(out: RasterOutput, u: Underlay, source: ReconstructionDraft['source'], label: string): ReconstructionDraft {
  const W = (p: { x: number; y: number }) => {
    const w = imageToWorld(u, p);
    return { x: roundMm(w.x), y: roundMm(w.y) };
  };
  const L = (px: number) => roundMm(px * u.metersPerPixel);
  const area = u.crop;
  const inCrop = (p: { x: number; y: number }) => !area || (p.x >= area.x && p.y >= area.y && p.x <= area.x + area.width && p.y <= area.y + area.height);
  return {
    source,
    sourceName: `${u.fileName} – ${label}`,
    scaleConfirmed: u.calibrated,
    walls: out.walls
      .filter((w) => inCrop(w.a) && inCrop(w.b))
      .map((w) => {
        // snap thickness to whole centimetres – it is an estimate anyway
        const thickness = Math.max(0.05, Math.round(L(w.thickness) * 100) / 100);
        return {
          id: newId('dw'),
          a: W(w.a),
          b: W(w.b),
          thickness,
          height: useProjectStore.getState().project.settings.defaultWallHeight,
          status: w.confidence >= 0.7 ? 'estimated' : 'uncertain',
          confidence: w.confidence,
          note: 'Automatisch erkannt – Lage und Dicke prüfen',
          accepted: true,
        };
      }),
    openings: out.openings
      .filter((o) => inCrop(o.center))
      .map((o) => ({
        id: newId('dop'),
        kind: o.kind,
        center: W(o.center),
        width: L(o.width),
        height: o.kind === 'window' ? 1.4 : 2.1,
        sillHeight: o.kind === 'window' ? 0.9 : 0,
        swingSide: o.swingSide ? rotate(o.swingSide, u.rotation) : undefined,
        status: 'uncertain',
        confidence: o.confidence,
        note: `${o.note ?? ''} – Höhe/Brüstung sind Standardwerte`,
        accepted: true,
      })),
    rooms: [],
    furniture: [],
    warnings: ['Automatisch erkannte Geometrie ist ein Vorschlag. Höhen von Türen/Fenstern sind Standardannahmen.'],
    mode: useProjectStore.getState().project.walls.length > 0 ? 'merge' : 'replace',
  };
}
