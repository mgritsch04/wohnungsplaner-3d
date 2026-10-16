import { useState } from 'react';
import { addRectRoom } from '../../model/operations';
import { boundsOf } from '../../model/vec';
import { DEFAULT_FLOOR_MATERIAL_ID } from '../../model/materials';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore, type Tool } from '../../store/uiStore';
import { addLight } from '../actions';
import { CheckField, NumberField, Section, SelectField, TextField } from '../fields';

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: 'select', label: 'Auswählen', key: 'V', hint: 'Elemente auswählen, verschieben, Ecken und Wände ziehen' },
  { id: 'wall', label: 'Wand', key: 'W', hint: 'Wände zeichnen – Länge numerisch eingeben möglich' },
  { id: 'room', label: 'Raum', key: 'R', hint: 'Rechteckigen Raum aufziehen oder umschlossene Fläche anklicken' },
  { id: 'door', label: 'Tür', key: 'T', hint: 'Tür in eine Wand setzen' },
  { id: 'window', label: 'Fenster', key: 'F', hint: 'Fenster in eine Wand setzen' },
  { id: 'passage', label: 'Durchgang', key: 'G', hint: 'Türlose Öffnung in eine Wand setzen' },
  { id: 'measure', label: 'Messen', key: 'M', hint: 'Abstand zwischen zwei Punkten messen' },
];

export function ToolsPanel() {
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const measurements = useUiStore((s) => s.measurements);
  const clearMeasurements = useUiStore((s) => s.clearMeasurements);
  const settings = useProjectStore((s) => s.project.settings);
  const apply = useProjectStore((s) => s.apply);
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
        {measurements.length > 0 && (
          <button className="link-btn" onClick={clearMeasurements}>
            {measurements.length} Messung(en) entfernen
          </button>
        )}
      </Section>

      <Section title="Raum mit Maßen anlegen">
        <p className="muted small">Innenmaße (lichte Weite) eingeben. Der Raum wird rechts neben den bestehenden Räumen angelegt und kann danach verschoben werden.</p>
        <TextField label="Name" value={room.name} onChange={(name) => setRoom({ ...room, name })} />
        <div className="field-row">
          <NumberField label="Breite" value={room.width} factor={100} unit="cm" min={30} max={5000} onChange={(width) => setRoom({ ...room, width })} />
          <NumberField label="Tiefe" value={room.depth} factor={100} unit="cm" min={30} max={5000} onChange={(depth) => setRoom({ ...room, depth })} />
        </div>
        <button className="primary block" onClick={createRoom}>
          Raum anlegen
        </button>
      </Section>

      <Section title="Standardwerte für neue Wände">
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
      </Section>

      <Section title="Raster & Fang">
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
      </Section>

      <Section title="Beleuchtung">
        <button className="block" onClick={addLight}>
          + Deckenleuchte hinzufügen
        </button>
        <p className="muted small">Leuchten wirken in der 3D-Ansicht (Lichtfarbe und Helligkeit rechts einstellbar).</p>
      </Section>
    </div>
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
    default:
      return null;
  }
}
