import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { usePerformanceStore } from '../view3d/performanceStore';

export function StatusBar() {
  const cursor = useUiStore((s) => s.cursor);
  const zoom = useUiStore((s) => s.view2d.zoom);
  const fps = useUiStore((s) => s.fps);
  const selection = useUiStore((s) => s.selection);
  const tool = useUiStore((s) => s.tool);
  const quality = useProjectStore((s) => s.project.settings.quality);
  const underlay = useProjectStore((s) => s.project.underlay);
  const suggest = usePerformanceStore((s) => s.suggestPlanning);
  const dismiss = usePerformanceStore((s) => s.dismissSuggestion);
  const apply = useProjectStore((s) => s.apply);
  const toolLabel = { select: 'Auswählen', wall: 'Wand', room: 'Raum', door: 'Tür', window: 'Fenster', passage: 'Durchgang', measure: 'Messen', walkpath: 'Laufweg', mark: 'Markierung', calibrate: 'Kalibrieren' }[tool];
  return (
    <footer className="statusbar">
      <span>Werkzeug: {toolLabel}</span>
      <span>{cursor ? `x ${(cursor.x * 100).toFixed(0)} cm · y ${(cursor.y * 100).toFixed(0)} cm` : '—'}</span>
      <span title="Bildschirm-Pixel pro Meter">1 m = {zoom.toFixed(0)} px</span>
      {selection && <span>Auswahl: {{ wall: 'Wand', node: 'Ecke', room: 'Raum', opening: 'Öffnung', furniture: 'Objekt', light: 'Leuchte', device: 'Smart-Home-Gerät' }[selection.type]}</span>}
      {underlay && <span className={underlay.calibrated ? '' : 'warn-text'}>Plan: {underlay.calibrated ? 'kalibriert' : underlay.scaleSource === 'notation' ? 'Maßstab angenommen' : 'NICHT kalibriert'}</span>}
      <span className="spacer" />
      {suggest && quality === 'realism' && (
        <span className="warn-text">
          Niedrige Bildrate –{' '}
          <button
            className="link-btn"
            onClick={() => {
              apply((d) => {
                d.settings.quality = 'planning';
              });
              dismiss();
            }}
          >
            Planungsmodus aktivieren
          </button>{' '}
          <button className="link-btn" onClick={dismiss}>
            ignorieren
          </button>
        </span>
      )}
      <span>{quality === 'planning' ? 'Planungsmodus' : 'Realismusmodus'}</span>
      {fps !== null && <span>{fps} FPS</span>}
    </footer>
  );
}
