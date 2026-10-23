import { useState } from 'react';
import { addRectRoom } from '../../model/operations';
import { boundsOf } from '../../model/vec';
import { DEFAULT_FLOOR_MATERIAL_ID } from '../../model/materials';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore, type Tool } from '../../store/uiStore';
import { addLight } from '../actions';
import { FIXTURE_KINDS, FIXTURE_LABEL } from '../../model/fixtures';
import { guessAndPlaceSockets } from '../../installation/actions';
import { useFixtureStore } from '../../installation/fixtureStore';
import { CheckField, NumberField, PanelGroup, Section, SelectField, TextField } from '../fields';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Auswählen', key: 'V', hint: 'Elemente auswählen, verschieben, Ecken und Wände ziehen' },
  { id: 'wall', label: 'Wand', key: 'W', hint: 'Wände zeichnen – Länge numerisch eingeben möglich' },
  { id: 'room', label: 'Raum', key: 'R', hint: 'Rechteckigen Raum aufziehen oder umschlossene Fläche anklicken' },
  { id: 'door', label: 'Tür', key: 'T', hint: 'Tür in eine Wand setzen' },
  { id: 'window', label: 'Fenster', key: 'F', hint: 'Fenster in eine Wand setzen' },
  { id: 'passage', label: 'Durchgang', key: 'G', hint: 'Türlose Öffnung in eine Wand setzen' },
  { id: 'measure', label: 'Messen', key: 'M', hint: 'Abstand zwischen zwei Punkten messen' },
  { id: 'walkpath', label: 'Laufweg', key: 'L', hint: 'Kürzesten begehbaren Weg zwischen zwei Punkten messen' },
];

export function ToolsPanel() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const measurements = useUiStore((s) => s.measurements);
  const clearMeasurements = useUiStore((s) => s.clearMeasurements);
  const settings = useProjectStore((s) => s.project.settings);
  const apply = useProjectStore((s) => s.apply);
  const fixtureCount = useProjectStore((s) => s.project.fixtures.length);
  const [room, setRoom] = useState({ name: 'Neuer Raum', width: 4, depth: 3.5 });

  const createRoom = () => {
    let id = '';
    apply((d) => {
      const b = boundsOf(d.nodes);
      const x = b ? b.maxX + 1 : 0;
      const y = b ? b.minY + d.settings.defaultWallThickness / 2 : 0;
      id = addRectRoom(d, {
        x,
        y,
        width: room.width,
        depth: room.depth,
        name: room.name || 'Raum',
        thickness: d.settings.defaultWallThickness,
        height: d.settings.defaultWallHeight,
        floorMaterialId: DEFAULT_FLOOR_MATERIAL_ID,
      });
    });
    useUiStore.getState().setSelection({ type: 'room', id });
    useUiStore.getState().requestFit();
  };

  return (
    <div className="panel-scroll">
      <Section title="Werkzeuge">
        <div className="tool-grid">
          {TOOLS.map((t) => (
            <button key={t.id} className={`tool-btn ${tool === t.id ? 'active' : ''}`} onClick={() => setTool(t.id)} title={`${t.hint} (${t.key})`}>
              <ToolIcon id={t.id} />
              <span>{t.label}</span>
              <kbd>{t.key}</kbd>
            </button>
          ))}
        </div>
        <p className="tool-hint muted small" data-testid="tool-hint">
          {TOOLS.find((t) => t.id === tool)?.hint}
        </p>
        {measurements.length > 0 && (
          <button className="link-btn" onClick={clearMeasurements}>
            {measurements.length} Messung(en) entfernen
          </button>
        )}
      </Section>

      <PanelGroup groupKey="tools.room" title="Raum mit Maßen anlegen">
        <p className="muted small">Innenmaße (lichte Weite). Der neue Raum erscheint rechts neben dem Plan und lässt sich danach verschieben.</p>
        <TextField label="Name" value={room.name} onChange={(name) => setRoom({ ...room, name })} />
        <div className="field-row">
          <NumberField label="Breite" value={room.width} factor={100} unit="cm" min={30} max={5000} onChange={(width) => setRoom({ ...room, width })} />
          <NumberField label="Tiefe" value={room.depth} factor={100} unit="cm" min={30} max={5000} onChange={(depth) => setRoom({ ...room, depth })} />
        </div>
        <button className="primary block" onClick={createRoom}>
          Raum anlegen
        </button>
      </PanelGroup>

      <PanelGroup groupKey="tools.walls" title="Neue Wände" defaultOpen={false}>
        <div className="field-row">
          <NumberField
            label="Dicke"
            value={settings.defaultWallThickness}
            factor={100}
            unit="cm"
            min={2}
            max={200}
            onChange={(v) =>
              apply((d) => {
                d.settings.defaultWallThickness = v;
              })
            }
          />
          <NumberField
            label="Höhe"
            value={settings.defaultWallHeight}
            factor={100}
            unit="cm"
            min={50}
            max={1000}
            onChange={(v) =>
              apply((d) => {
                d.settings.defaultWallHeight = v;
              })
            }
          />
        </div>
      </PanelGroup>

      <PanelGroup groupKey="tools.snap" title="Raster & Einrasten" defaultOpen={false}>
        <div className="field-row">
          <NumberField
            label="Raster"
            value={settings.gridSize}
            factor={100}
            unit="cm"
            min={1}
            max={500}
            onChange={(v) =>
              apply((d) => {
                d.settings.gridSize = v;
              })
            }
          />
        </div>
        <CheckField
          label="Am Raster fangen"
          checked={settings.snapToGrid}
          onChange={(v) =>
            apply((d) => {
              d.settings.snapToGrid = v;
            })
          }
          title="Alt gedrückt halten, um den Fang vorübergehend zu deaktivieren"
        />
        <SelectField
          label="Möbel einrasten"
          value={settings.furnitureSnap}
          options={[
            { value: 'grid5', label: 'Raster 5 cm + Wandkante' },
            { value: 'grid10', label: 'Raster 10 cm + Wandkante' },
            { value: 'wall', label: 'nur Wandkante' },
            { value: 'off', label: 'aus (frei)' },
          ]}
          onChange={(v) => apply((d) => void (d.settings.furnitureSnap = v))}
        />
        <p className="muted small">Gilt beim Ziehen in 2D und 3D. Alt gedrückt halten = vorübergehend frei platzieren.</p>
      </PanelGroup>

      <PanelGroup groupKey="tools.passages" title="Engstellen" defaultOpen={false}>
        <NumberField
          label="Durchgang mindestens"
          value={settings.minPassageWidth}
          factor={100}
          digits={0}
          unit="cm"
          min={60}
          max={150}
          step={5}
          title="Lichte Breite, ab der ein Durchgang als eng markiert wird (60–150 cm)"
          onChange={(v) => apply((d) => void (d.settings.minPassageWidth = Math.max(0.6, Math.min(1.5, v))))}
        />
        <p className="muted small">Richtwert, keine Norm. Standard 90 cm.</p>
        <CheckField
          label="Engstellen anzeigen"
          checked={settings.showNarrowPassages}
          onChange={(v) => apply((d) => void (d.settings.showNarrowPassages = v))}
          title="Lücken zwischen Möbeln, Möbel und Wand sowie Türen schmaler als die Mindestbreite rot markieren (2D und 3D)"
        />
      </PanelGroup>

      <PanelGroup groupKey="tools.lights" title="Beleuchtung" defaultOpen={false}>
        <button className="block" onClick={addLight}>
          + Deckenleuchte hinzufügen
        </button>
        <p className="muted small">Leuchten wirken in der 3D-Ansicht (Lichtfarbe und Helligkeit rechts einstellbar).</p>
      </PanelGroup>

      <InstallationGroup count={fixtureCount} />
    </div>
  );
}

/** Installation plan (#64, #81): pick a kind, then click next to a wall in the 2D plan. */
function InstallationGroup({ count }: { count: number }) {
  const placing = useFixtureStore((s) => s.placing);
  const setPlacing = useFixtureStore((s) => s.setPlacing);
  const pick = (k: (typeof FIXTURE_KINDS)[number]) => {
    setPlacing(placing === k ? null : k);
    const ui = useUiStore.getState();
    ui.setTool('select');
    if (ui.viewMode === '3d') ui.setViewMode('split');
  };
  return (
    <PanelGroup groupKey="tools.installation" title="Steckdosen & Anschlüsse" defaultOpen={false}>
      <div className="btn-row" data-testid="fixture-buttons">
        {FIXTURE_KINDS.map((k) => (
          <button key={k} className={placing === k ? 'active' : ''} aria-pressed={placing === k} onClick={() => pick(k)}>
            + {FIXTURE_LABEL[k]}
          </button>
        ))}
      </div>
      <button className="block" data-testid="guess-sockets" onClick={() => guessAndPlaceSockets()} title="Schlägt Steckdosen anhand der Wände und Türen vor – nur auf Klick">
        Steckdosen raten
      </button>
      <p className="muted small">
        {placing
          ? `Jetzt im 2D-Plan auf oder neben eine Wand klicken – ${FIXTURE_LABEL[placing]} rastet an der Wand ein (Esc bricht ab).`
          : `Art wählen, dann im 2D-Plan an eine Wand klicken. Möbel vor Wasser- und Abwasseranschlüssen werden orange markiert. ${count ? `${count} im Plan.` : ''}`}
      </p>
    </PanelGroup>
  );
}

function ToolIcon({ id }: { id: Tool }) {
  const common = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (id) {
    case 'select':
      return (
        <svg {...common}>
          <path d="M5 3l14 8-6 2-2 6z" />
        </svg>
      );
    case 'wall':
      return (
        <svg {...common}>
          <path d="M3 8h18v8H3z" fill="currentColor" fillOpacity={0.25} />
        </svg>
      );
    case 'room':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" />
          <path d="M3 4l18 16" strokeOpacity={0.3} />
        </svg>
      );
    case 'door':
      return (
        <svg {...common}>
          <path d="M4 20h16M6 20V6M6 6a14 14 0 0 1 14 14" />
        </svg>
      );
    case 'window':
      return (
        <svg {...common}>
          <rect x="3" y="9" width="18" height="6" />
          <path d="M3 12h18" />
        </svg>
      );
    case 'passage':
      return (
        <svg {...common}>
          <path d="M3 12h5M16 12h5M8 9v6M16 9v6" />
        </svg>
      );
    case 'measure':
      return (
        <svg {...common}>
          <path d="M4 16L16 4l4 4L8 20z" />
          <path d="M7 13l2 2M10 10l2 2M13 7l2 2" />
        </svg>
      );
    case 'walkpath':
      return (
        <svg {...common}>
          <circle cx="5" cy="19" r="2" />
          <circle cx="19" cy="5" r="2" />
          <path d="M7 19h5a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h8" strokeDasharray="2 2" />
        </svg>
      );
    default:
      return null;
  }
}
