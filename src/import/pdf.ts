// The "legacy" build ships polyfills for very new JS features (e.g. Map#getOrInsertComputed)
// that current browsers may not support yet; the modern build fails on them.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PlanText } from './dimensions';
import { PlanFileError } from './fileValidation';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Max long side of the rendered underlay raster in pixels. */
export const PDF_RENDER_MAX_SIDE = 4096;

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/password/i.test(msg)) throw new PlanFileError('Das PDF ist passwortgeschützt und kann nicht geöffnet werden.');
    throw new PlanFileError(`Das PDF ist beschädigt oder ungültig (${msg}).`);
  }
}

export interface RenderedPage {
  blob: Blob;
  width: number;
  height: number;
  /** Rendered pixels per PDF point (1 pt = 1/72 inch on paper). */
  pixelsPerPoint: number;
  /** Paper size of the page in millimetres. */
  paperMm: { width: number; height: number };
}

export async function renderPdfPage(page: PDFPageProxy, maxSide = PDF_RENDER_MAX_SIDE): Promise<RenderedPage> {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(8, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PlanFileError('Canvas wird von diesem Browser nicht unterstützt.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport, background: '#ffffff' }).promise;
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG-Erzeugung fehlgeschlagen'))), 'image/png'));
  const result = {
    blob,
    width: canvas.width,
    height: canvas.height,
    pixelsPerPoint: scale,
    paperMm: { width: (base.width / 72) * 25.4, height: (base.height / 72) * 25.4 },
  };
  canvas.width = canvas.height = 0; // release memory
  return result;
}

export async function renderPdfThumbnail(page: PDFPageProxy, maxSide = 220): Promise<string> {
  const r = await renderPdfPage(page, maxSide);
  return URL.createObjectURL(r.blob);
}

export interface PdfSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Line width in rendered pixels (0 for fill outlines). */
  width: number;
  filled: boolean;
}

export interface PdfContentAnalysis {
  kind: 'vector' | 'raster' | 'mixed' | 'unknown';
  pathCount: number;
  imageCount: number;
  textItems: number;
  /** Straight segments in rendered-pixel coordinates (same frame as the underlay image). */
  segments: PdfSegment[];
  /** Text snippets with positions (rendered pixels) – e.g. room labels or dimensions. */
  texts: PlanText[];
}

type Matrix = [number, number, number, number, number, number];
const mul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

/**
 * Classify a PDF page as vector/raster drawing and extract straight line
 * segments from its drawing operators (vector PDFs exported from CAD tools).
 */
export async function analyzePdfPage(page: PDFPageProxy, pixelsPerPoint: number, maxSegments = 200_000): Promise<PdfContentAnalysis> {
  const viewport = page.getViewport({ scale: pixelsPerPoint });
  const ops = await page.getOperatorList();
  const O = pdfjs.OPS;
  let ctm: Matrix = viewport.transform as Matrix;
  const stack: Matrix[] = [];
  let lineWidth = 1;
  const lwStack: number[] = [];
  let pathCount = 0;
  let imageCount = 0;
  const segments: PdfSegment[] = [];
  const imageOps = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObject, O.paintInlineImageXObjectGroup]);
  const strokeOps = new Set([O.stroke, O.closeStroke, O.fillStroke, O.closeFillStroke, O.eoFillStroke, O.closeEOFillStroke]);
  const fillOps = new Set([O.fill, O.eoFill, O.fillStroke, O.closeFillStroke, O.eoFillStroke, O.closeEOFillStroke]);

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[];
    if (fn === O.save) {
      stack.push(ctm);
      lwStack.push(lineWidth);
    } else if (fn === O.restore) {
      ctm = stack.pop() ?? ctm;
      lineWidth = lwStack.pop() ?? lineWidth;
    } else if (fn === O.transform) {
      ctm = mul(ctm, args as Matrix);
    } else if (fn === O.setLineWidth) {
      lineWidth = args[0] as number;
    } else if (imageOps.has(fn)) {
      imageCount++;
    } else if (fn === O.constructPath) {
      pathCount++;
      if (segments.length >= maxSegments) continue;
      const paintOp = args[0] as number;
      const data = (args[1] as unknown[] | undefined)?.[0] as ArrayLike<number> | null | undefined;
      if (!data) continue;
      const stroked = strokeOps.has(paintOp);
      const filled = fillOps.has(paintOp);
      if (!stroked && !filled) continue;
      const scaleFactor = Math.hypot(ctm[0], ctm[1]);
      const w = stroked ? Math.max(0.5, lineWidth * scaleFactor) : 0;
      let cur: { x: number; y: number } | null = null;
      let start: { x: number; y: number } | null = null;
      for (let k = 0; k < data.length; ) {
        const op = data[k++];
        if (op === 0) {
          cur = apply(ctm, data[k++], data[k++]);
          start = cur;
        } else if (op === 1) {
          const p = apply(ctm, data[k++], data[k++]);
          if (cur) segments.push({ x1: cur.x, y1: cur.y, x2: p.x, y2: p.y, width: w, filled });
          cur = p;
        } else if (op === 2) {
          k += 4;
          cur = apply(ctm, data[k++], data[k++]);
        } else if (op === 3) {
          k += 2;
          cur = apply(ctm, data[k++], data[k++]);
        } else if (op === 4) {
          if (cur && start) segments.push({ x1: cur.x, y1: cur.y, x2: start.x, y2: start.y, width: w, filled });
          cur = start;
        } else break;
      }
    }
  }

  const textContent = await page.getTextContent();
  const texts: PdfContentAnalysis['texts'] = [];
  for (const item of textContent.items) {
    if (!('str' in item) || !item.str.trim()) continue;
    const m = mul(viewport.transform as Matrix, item.transform as Matrix);
    // reading direction and font height in rendered pixels; the advance width is given in PDF units
    const dirLen = Math.hypot(m[0], m[1]);
    texts.push({
      str: item.str.trim(),
      x: m[4],
      y: m[5],
      ...(dirLen > 0 ? { dir: { x: m[0] / dirLen, y: m[1] / dirLen }, height: Math.hypot(m[2], m[3]), width: item.width * pixelsPerPoint } : {}),
    });
  }

  let kind: PdfContentAnalysis['kind'] = 'unknown';
  const drawn = segments.length;
  if (imageCount === 0 && drawn >= 4) kind = 'vector';
  else if (imageCount > 0 && drawn >= 20) kind = 'mixed';
  else if (imageCount > 0) kind = 'raster';
  return { kind, pathCount, imageCount, textItems: texts.length, segments, texts };
}
