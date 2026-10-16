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
import { checkScale, scaleCheckMessage } from '../dimensions';
import { proposeRooms, refreshRoomProposals, type PlacedText } from '../rooms';
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
    // rooms: closed areas of the proposed walls; names/areas only from the plan's own text layer
    draft.rooms = proposeRooms(draft.walls, { texts: planTextsInWorld() });
    if (draft.rooms.length > 0) draft.warnings.push('Räume wurden aus geschlossenen Wandzügen vorgeschlagen – Namen und Flächen bitte prüfen.');
    // dimension texts of a vector PDF that contradict the scale
    if (analysis?.dimensions?.length && analysis.imageAssetId === u.imageAssetId) {
      const check = checkScale(analysis.dimensions, u.metersPerPixel);
      if (check.status === 'mismatch') draft.warnings.push(scaleCheckMessage(check)!);
    }
    draft.warnings.push(...findDraftConflicts(draft).map((c) => c.message));
    useImportStore.getState().setDraft(draft);
    useUiStore.getState().toast(`${draft.walls.length} Wände, ${draft.openings.length} Öffnungen und ${draft.rooms.length} Räume vorgeschlagen – bitte prüfen.`, 'success');
  } catch (e) {
    reportError(e, 'Erkennung fehlgeschlagen');
  } finally {
    progress(null);
  }
}

/** Texts of the current PDF underlay (centre of each text) in plan metres, if available. */
function planTextsInWorld(): PlacedText[] | undefined {
  const u = useProjectStore.getState().project.underlay;
  const analysis = useSourceAnalysis.getState().analysis;
  if (!u || !analysis || analysis.imageAssetId !== u.imageAssetId) return undefined;
  return analysis.texts.map((t) => {
    const c = t.dir && t.width ? { x: t.x + (t.dir.x * t.width) / 2, y: t.y + (t.dir.y * t.width) / 2 } : t;
    return { str: t.str, ...imageToWorld(u, c) };
  });
}

/** Re-propose rooms in the review after walls were removed, deselected or moved. */
export function refreshDraftRooms() {
  const draft = useImportStore.getState().draft;
  if (!draft) return;
  const rooms = refreshRoomProposals(draft, { texts: draft.source === 'json' ? undefined : planTextsInWorld() });
  useImportStore.getState().patchDraft({ rooms });
  useUiStore.getState().toast(`${rooms.length} Räume aus den ausgewählten Wänden vorgeschlagen.`, 'info');
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
