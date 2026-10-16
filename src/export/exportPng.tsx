import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob } from '../ui/fileUtils';
import { padBounds, planBounds, planFileName } from './planExport';
import { PlanSheet, planSheetSize } from './PlanSheet';

/** On-screen resolution of the exported sheet (CSS px per metre); the PNG is rendered at twice that. */
const PNG_PX_PER_M = 80;
const PNG_SCALE = 2;
/** Keep the canvas well inside browser limits for very large plans. */
const MAX_CANVAS = 8000;

/** Serialize the static plan sheet (same SVG as the print view) to markup. */
function renderSheetSvg(el: React.ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(el));
  const svg = host.innerHTML;
  root.unmount();
  return svg;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Plan konnte nicht als Bild gezeichnet werden'));
    img.src = src;
  });
}

export async function exportPlanPng() {
  const ui = useUiStore.getState();
  const project = useProjectStore.getState().project;
  const derived = derivePlan(project);
  const b = planBounds(project, derived);
  if (!b) {
    ui.toast('Der Plan ist noch leer – nichts zu exportieren.', 'info');
    return;
  }
  try {
    const bounds = padBounds(b, 0.3);
    const now = new Date();
    let pxPerM = PNG_PX_PER_M;
    const size0 = planSheetSize(bounds, pxPerM, true);
    const fit = Math.min(1, MAX_CANVAS / PNG_SCALE / Math.max(size0.width, size0.height));
    pxPerM *= fit;
    const { width, height } = planSheetSize(bounds, pxPerM, true);
    const svg = renderSheetSvg(<PlanSheet project={project} derived={derived} bounds={bounds} pxPerM={pxPerM} header={{ title: project.name || 'Grundriss', date: now.toLocaleDateString('de-AT') }} />);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * PNG_SCALE);
      canvas.height = Math.round(height * PNG_SCALE);
      const g = canvas.getContext('2d');
      if (!g) throw new Error('Canvas nicht verfügbar');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, canvas.width, canvas.height);
      g.drawImage(img, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!png) throw new Error('PNG konnte nicht erzeugt werden');
      downloadBlob(png, planFileName(project.name, now, 'png'));
      ui.toast('Plan als PNG exportiert', 'success');
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (e) {
    ui.toast(`PNG-Export fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`, 'error');
  }
}
