import { useMemo, useState } from 'react';
import { makeLightSmartWithFeedback } from '../../smarthome/actions';
import { DEVICE_PRODUCTS } from '../../smarthome/catalog';
import { DeviceInfo } from '../../smarthome/DeviceInfo';
import { FixtureProps } from '../../installation/FixtureProps';
import { ASSEMBLIES, estimateInsulation, ratingOf, soundIssues, wallRooms, type WallAssembly } from '../../model/acoustics';
import { derivePlan } from '../../model/derived';
import { statedAreaSummary } from '../../model/statedArea';
import { wallLength } from '../../model/graph';
import { rectangularRoomSize } from '../../model/geometry/rooms';
import { deleteRoomWithWalls, setRectRoomSize, setWallAngle, setWallLength, splitWall, moveNode } from '../../model/operations';
import { degToRad, formatArea, formatEuro, formatLength, radToDeg } from '../../model/units';
import { categoryLabel, CATEGORIES } from '../../catalog/types';
import { packsNeeded } from '../../catalog/packSize';
import { catalogColors } from '../../catalog/generic';
import { useCatalogStore } from '../../catalog/catalogStore';
import { defaultLeafOpen, openingLabel, type Furniture, type FurnitureFinish, type Light, type Material, type Opening, type Project, type Provenance, type Room } from '../../model/schema';
import { FURNITURE_FINISH_PRESETS, FURNITURE_FINISHES } from '../../model/furnitureFinishes';
import { WINDOW_TWO_SASH_WIDTH } from '../../model/geometry/leaves';
import { useProjectStore } from '../../store/projectStore';
import { DEFAULT_LAMP_KELVIN } from '../../view3d/lighting';
import { runDeliveryCheck, useDeliveryStore } from '../../editor2d/deliveryStore';
import { selectedFurnitureIds, useUiStore } from '../../store/uiStore';
import { CurtainStateSection, OpeningShadingSection } from './ShadingSection';
import { InteriorSection } from './InteriorSection';
import { PhotosSection } from '../../photos/PhotosSection';
import { NotesSection } from '../../planning/NotesSection';
import { RoomTasksSection } from '../../planning/TaskSections';
import { deleteSelection, duplicateSelection, rotateSelection, setFurnitureRotation } from '../actions';
import { confirmDialog, useDialogStore } from '../dialogStore';
import { AngleSlider, Badge, CheckField, NumberField, PanelGroup, Section, SelectField, TextField } from '../fields';
import { validateModel } from '../../model/validation';
import { DEFAULT_LUMEN, FALLBACK_LUMEN } from '../../model/lux';
import { conflictSummary, issueLevel, placementIssues } from '../../model/placement';
import { ArrangeControls } from './ArrangeControls';
import { GroupControls } from './GroupControls';
import { groupName, selectedGroup } from '../../model/groups';

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection);
  const project = useProjectStore((s) => s.project);
  const derived = useMemo(() => derivePlan(project), [project]);

  if (!selection) return <NothingSelected project={project} />;
  switch (selection.type) {
    case 'wall':
      return <WallProps id={selection.id} project={project} />;
    case 'node':
      return <NodeProps id={selection.id} project={project} />;
    case 'room':
      return <RoomProps id={selection.id} project={project} area={derived.rooms.get(selection.id)} />;
    case 'opening':
      return <OpeningProps id={selection.id} project={project} />;
    case 'furniture':
      return <FurnitureProps id={selection.id} project={project} />;
    case 'light':
      return <LightProps id={selection.id} project={project} />;
    case 'device':
      return <DeviceInfo id={selection.id} project={project} />;
    case 'fixture':
      return <FixtureProps id={selection.id} project={project} />;
  }
}

function useApply() {
  return useProjectStore((s) => s.apply);
}

function ProvenanceInfo({ p }: { p?: Provenance }) {
  if (!p) return null;
  const src = { manual: 'manuell', 'imported-json': 'aus JSON importiert', detected: 'automatisch erkannt', traced: 'nachgezeichnet' }[p.source];
  const st = { confirmed: ['ok', 'bestätigt'], estimated: ['warn', 'geschätzt'], uncertain: ['error', 'unsicher'] }[p.status] as ['ok' | 'warn' | 'error', string];
  return (
    <p className="small">
      Herkunft: {src} <Badge kind={st[0]}>{st[1]}</Badge>
    </p>
  );
}

function MaterialSelect({ label, value, materials, kinds, onChange, emptyLabel }: { label: string; value?: string; materials: Material[]; kinds: Material['kind'][]; onChange: (id: string | undefined) => void; emptyLabel: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
          <option value="">{emptyLabel}</option>
          {materials
            .filter((m) => kinds.includes(m.kind))
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </select>
      </span>
    </label>
  );
}

function WallProps({ id, project }: { id: string; project: Project }) {
  const apply = useApply();
  const w = project.walls.find((x) => x.id === id);
  if (!w) return <Gone />;
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const a = nodes.get(w.a)!;
  const b = nodes.get(w.b)!;
  const len = wallLength(w, nodes);
  const angle = radToDeg(Math.atan2(b.y - a.y, b.x - a.x));
  const openings = project.openings.filter((o) => o.wallId === w.id);
  return (
    <div className="panel-scroll">
      <PanelGroup groupKey="wall.object" title="Wand">
        <ProvenanceInfo p={w.provenance} />
        <NumberField
          label="Länge (Achse)"
          value={len}
          factor={100}
          unit="cm"
          min={5}
          max={10000}
          title="Länge entlang der Wandachse – der Endpunkt wird verschoben"
          onChange={(v) => apply((d) => setWallLength(d, id, v))}
        />
        <div className="field-row">
          <NumberField
            label="Dicke"
            value={w.thickness}
            factor={100}
            unit="cm"
            min={2}
            max={200}
            onChange={(v) =>
              apply((d) => {
                const x = d.walls.find((q) => q.id === id);
                if (x) x.thickness = v;
              })
            }
          />
          <NumberField
            label="Höhe"
            value={w.height}
            factor={100}
            unit="cm"
            min={10}
            max={1000}
            onChange={(v) =>
              apply((d) => {
                const x = d.walls.find((q) => q.id === id);
                if (x) x.height = v;
              })
            }
          />
        </div>
        <NumberField label="Winkel" value={angle} unit="°" min={-360} max={360} step={1} onChange={(v) => apply((d) => setWallAngle(d, id, degToRad(v)))} />
      </PanelGroup>
      <PanelGroup groupKey="wall.position" title="Position" defaultOpen={false}>
        <div className="field-row">
          <NumberField label="Start X" value={a.x} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.a, { x: v, y: a.y }))} />
          <NumberField label="Start Y" value={a.y} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.a, { x: a.x, y: v }))} />
        </div>
        <div className="field-row">
          <NumberField label="Ende X" value={b.x} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.b, { x: v, y: b.y }))} />
          <NumberField label="Ende Y" value={b.y} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.b, { x: b.x, y: v }))} />
        </div>
      </PanelGroup>
      <PanelGroup groupKey="wall.sound" title="Aufbau und Schallschutz">
        <SelectField
          label="Aufbau"
          value={w.assembly ?? ''}
          options={[{ value: '', label: 'unbekannt (wie Ziegel)' }, ...ASSEMBLIES.map((x) => ({ value: x.id as string, label: x.label }))]}
          onChange={(v) =>
            apply((d) => {
              const x = d.walls.find((q) => q.id === id);
              if (x) x.assembly = v ? (v as WallAssembly) : undefined;
            })
          }
        />
        <dl className="stats">
          <dt>Schallschutz (Schätzung)</dt>
          <dd>
            ca. {estimateInsulation(w)} dB, {ratingOf(estimateInsulation(w))}
          </dd>
        </dl>
        {soundIssues(project)
          .filter((i) => i.wallId === id)
          .map((i) => (
            <p key={i.quietRoomId} className="warning small">
              Laut neben ruhig: {project.rooms.find((r) => r.id === i.loudRoomId)?.name} grenzt an {project.rooms.find((r) => r.id === i.quietRoomId)?.name}.
            </p>
          ))}
        {wallRooms(project, id).length < 2 && <p className="muted small">Grenzt an höchstens einen Raum – Raumnachbarn werden nur zwischen zwei Räumen bewertet.</p>}
        <p className="muted small">Grobe Schätzung zur Orientierung, keine bauphysikalische Berechnung. Typische Richtwerte je Bauart.</p>
      </PanelGroup>
      <PanelGroup groupKey="wall.surfaces" title="Oberflächen">
        <MaterialSelect
          label="Seite links"
          value={w.leftMaterialId}
          materials={project.materials}
          kinds={['paint', 'concrete', 'tile', 'wood', 'stone']}
          emptyLabel="wie Raum"
          onChange={(m) =>
            apply((d) => {
              const x = d.walls.find((q) => q.id === id);
              if (x) x.leftMaterialId = m;
            })
          }
        />
        <MaterialSelect
          label="Seite rechts"
          value={w.rightMaterialId}
          materials={project.materials}
          kinds={['paint', 'concrete', 'tile', 'wood', 'stone']}
          emptyLabel="wie Raum"
          onChange={(m) =>
            apply((d) => {
              const x = d.walls.find((q) => q.id === id);
              if (x) x.rightMaterialId = m;
            })
          }
        />
      </PanelGroup>
      <PanelGroup groupKey="wall.openings" title={`Öffnungen (${openings.length})`}>
        {openings.length === 0 ? <p className="muted small">Tür/Fenster-Werkzeug wählen und auf die Wand klicken.</p> : null}
        <ul className="plain">
          {openings.map((o) => (
            <li key={o.id}>
              <button className="link-btn" onClick={() => useUiStore.getState().setSelection({ type: 'opening', id: o.id })}>
                {openingLabel(o)} {Math.round(o.width * 100)} cm
              </button>
            </li>
          ))}
        </ul>
      </PanelGroup>
      <PhotosSection project={project} wallId={id} length={len} />
      <div className="btn-row padded">
        <button
          onClick={() => {
            let nid = '';
            apply((d) => {
              nid = splitWall(d, id, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
            });
            useUiStore.getState().setSelection({ type: 'node', id: nid });
          }}
          title="Wand in der Mitte teilen (erzeugt eine verschiebbare Ecke)"
        >
          In der Mitte teilen
        </button>
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
    </div>
  );
}

function NodeProps({ id, project }: { id: string; project: Project }) {
  const apply = useApply();
  const n = project.nodes.find((x) => x.id === id);
  if (!n) return <Gone />;
  const walls = project.walls.filter((w) => w.a === id || w.b === id);
  return (
    <div className="panel-scroll">
      <Section title="Ecke / Knoten">
        <div className="field-row">
          <NumberField label="X" value={n.x} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, id, { x: v, y: n.y }))} />
          <NumberField label="Y" value={n.y} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, id, { x: n.x, y: v }))} />
        </div>
        <p className="muted small">{walls.length} angeschlossene Wand/Wände. Im Plan ziehen, um die Ecke zu verschieben – auf eine andere Ecke ziehen verbindet beide.</p>
        <button className="danger block" onClick={() => void deleteSelection()}>
          Ecke mit Wänden löschen
        </button>
      </Section>
    </div>
  );
}

function RoomProps({ id, project, area }: { id: string; project: Project; area?: ReturnType<typeof derivePlan>['rooms'] extends Map<string, infer G> ? G : never }) {
  const apply = useApply();
  const r = project.rooms.find((x) => x.id === id);
  if (!r) return <Gone />;
  const rect = area ? rectangularRoomSize(simplifyGeo(area)) : null;
  const upd = (fn: (x: Room) => void) =>
    apply((d) => {
      const x = d.rooms.find((q) => q.id === id);
      if (x) fn(x);
    });
  const furnitureInRoom = area ? project.furniture.filter((f) => pointIn({ x: f.x, y: f.y }, area.interior)).length : 0;
  return (
    <div className="panel-scroll">
      <PanelGroup groupKey="room.object" title="Raum">
        <ProvenanceInfo p={r.provenance} />
        <TextField label="Name" value={r.name} onChange={(v) => upd((x) => (x.name = v.slice(0, 100)))} />
        {area && (
          <dl className="stats">
            <dt>Nutzfläche (innen)</dt>
            <dd>{formatArea(area.area)}</dd>
            <dt>Fläche Wandachsen</dt>
            <dd>{formatArea(area.centerlineArea)}</dd>
            <dt>Umfang innen</dt>
            <dd>{formatLength(area.perimeter)}</dd>
            <dt>Möbel im Raum</dt>
            <dd>{furnitureInRoom}</dd>
          </dl>
        )}
        {soundIssues(project)
          .filter((i) => i.loudRoomId === id || i.quietRoomId === id)
          .map((i) => (
            <p key={i.wallId} className="warning small">
              Schall (Schätzung): {project.rooms.find((q) => q.id === i.loudRoomId)?.name} grenzt an {project.rooms.find((q) => q.id === i.quietRoomId)?.name} – Wand mit ca. {i.db} dB, {i.rating}.
            </p>
          ))}
        {!area?.closed && <p className="warning small">Der Raum ist nicht vollständig von Wänden umschlossen.</p>}
      </PanelGroup>
      {rect && (
        <PanelGroup groupKey="room.size" title="Innenmaße (lichte Weite)">
          <div className="field-row">
            <NumberField label="Breite" value={rect.width} factor={100} unit="cm" min={30} max={10000} onChange={(v) => apply((d) => void setRectRoomSize(d, id, v, rect.depth))} />
            <NumberField label="Tiefe" value={rect.depth} factor={100} unit="cm" min={30} max={10000} onChange={(v) => apply((d) => void setRectRoomSize(d, id, rect.width, v))} />
          </div>
          <p className="muted small">Verschiebt die gegenüberliegenden Wände. Angrenzende Räume passen sich an.</p>
        </PanelGroup>
      )}
      {!rect && area && (
        <PanelGroup groupKey="room.size" title="Maße">
          <p className="muted small">Nicht-rechteckiger Raum: Maße über die Wände oder Ecken ändern (anklicken bzw. ziehen).</p>
        </PanelGroup>
      )}
      <PanelGroup groupKey="room.surfaces" title="Oberflächen">
        <MaterialSelect label="Boden" value={r.floorMaterialId} materials={project.materials} kinds={['wood', 'tile', 'stone', 'carpet', 'concrete']} emptyLabel="Standard (Eiche)" onChange={(m) => upd((x) => (x.floorMaterialId = m))} />
        <MaterialSelect label="Wände" value={r.wallMaterialId} materials={project.materials} kinds={['paint', 'concrete', 'tile', 'wood', 'stone']} emptyLabel="Standard (Weiß)" onChange={(m) => upd((x) => (x.wallMaterialId = m))} />
        <MaterialSelect label="Decke" value={r.ceilingMaterialId} materials={project.materials} kinds={['paint', 'concrete', 'wood']} emptyLabel="Standard (Weiß)" onChange={(m) => upd((x) => (x.ceilingMaterialId = m))} />
      </PanelGroup>
      <RoomTasksSection project={project} roomId={id} />
      <NotesSection project={project} type="room" targetId={id} />
      <div className="btn-row padded">
        <button onClick={() => void deleteSelection()}>Raum entfernen (Wände behalten)</button>
        <button
          className="danger"
          onClick={async () => {
            if (await confirmDialog(`Raum „${r.name}“ samt nicht geteilter Wände löschen?`, { confirmLabel: 'Löschen', danger: true })) {
              apply((d) => deleteRoomWithWalls(d, id));
              useUiStore.getState().setSelection(null);
            }
          }}
        >
          Mit Wänden löschen
        </button>
      </div>
    </div>
  );
}

function OpeningProps({ id, project }: { id: string; project: Project }) {
  const apply = useApply();
  const o = project.openings.find((x) => x.id === id);
  if (!o) return <Gone />;
  const w = project.walls.find((x) => x.id === o.wallId);
  const nodes = new Map(project.nodes.map((n) => [n.id, n]));
  const L = w ? wallLength(w, nodes) : 0;
  const upd = (fn: (x: Opening) => void) =>
    apply((d) => {
      const x = d.openings.find((q) => q.id === id);
      if (x) fn(x);
    });
  const issues = validateModel(project).filter((i) => i.elementId === id);
  return (
    <div className="panel-scroll">
      {issues.length > 0 && (
        <div className="panel-issues">
          {issues.map((i, k) => (
            <p key={k} className="warning small">
              {i.message}
            </p>
          ))}
        </div>
      )}
      <PanelGroup groupKey="opening.object" title={openingLabel(o)}>
        <ProvenanceInfo p={o.provenance} />
        <SelectField
          label="Typ"
          value={o.kind}
          options={[
            { value: 'door', label: 'Tür' },
            { value: 'window', label: 'Fenster' },
            { value: 'passage', label: 'Durchgang (ohne Tür)' },
          ]}
          onChange={(k) =>
            upd((x) => {
              if (k !== x.kind) x.open = defaultLeafOpen(k);
              x.kind = k;
              if (k === 'window' && x.sillHeight === 0) {
                x.sillHeight = 0.9;
                x.height = Math.min(x.height, 1.4);
              }
              if (k !== 'window') x.sillHeight = 0;
            })
          }
        />
      </PanelGroup>
      <PanelGroup groupKey="opening.size" title="Maße und Lage">
        <div className="field-row">
          <NumberField label="Breite" value={o.width} factor={100} unit="cm" min={10} max={Math.max(10, L * 100)} onChange={(v) => upd((x) => (x.width = v))} />
          <NumberField label="Höhe" value={o.height} factor={100} unit="cm" min={10} max={1000} onChange={(v) => upd((x) => (x.height = v))} />
        </div>
        <div className="field-row">
          <NumberField label="Brüstung" value={o.sillHeight} factor={100} unit="cm" min={0} max={500} onChange={(v) => upd((x) => (x.sillHeight = v))} />
          <NumberField
            label="Abstand Wandanfang"
            value={o.offset - o.width / 2}
            factor={100}
            unit="cm"
            min={0}
            max={Math.max(0, (L - o.width) * 100)}
            title="Abstand vom Wand-Startpunkt bis zur Öffnungskante (Achsmaß)"
            onChange={(v) => upd((x) => (x.offset = v + x.width / 2))}
          />
        </div>
      </PanelGroup>
      {o.kind !== 'passage' && (
        <PanelGroup groupKey="opening.leaf" title="Flügel">
          {o.kind === 'door' && (
            <div className="field-row">
              <SelectField label="Anschlag" value={o.hinge} options={[{ value: 'start', label: 'Wandanfang' }, { value: 'end', label: 'Wandende' }]} onChange={(v) => upd((x) => (x.hinge = v))} />
              <SelectField label="Öffnet nach" value={o.swing} options={[{ value: 'left', label: 'Seite A' }, { value: 'right', label: 'Seite B' }]} onChange={(v) => upd((x) => (x.swing = v))} />
            </div>
          )}
          {o.kind === 'window' && o.width <= WINDOW_TWO_SASH_WIDTH && (
            // single-sash window: hinge side; it opens into the room (two sashes hinge at the outer sides)
            <SelectField label="Anschlag" value={o.hinge} options={[{ value: 'start', label: 'Wandanfang' }, { value: 'end', label: 'Wandende' }]} onChange={(v) => upd((x) => (x.hinge = v))} />
          )}
          <CheckField
            label={o.kind === 'door' ? 'Tür geöffnet' : 'Fenster geöffnet'}
            checked={o.open}
            title="Zustand in der 3D-Ansicht; ein geöffneter Flügel zählt in der Kollisionsprüfung. Auch: Taste O, Doppelklick in 3D, beim Begehen Taste F (oder Klick) aufs Fadenkreuz-Ziel"
            onChange={(v) => upd((x) => (x.open = v))}
          />
        </PanelGroup>
      )}
      <OpeningShadingSection o={o} />
      <div className="btn-row padded">
        {o.kind === 'door' && (
          <button
            onClick={() =>
              upd((x) => {
                x.swing = x.swing === 'left' ? 'right' : 'left';
              })
            }
          >
            Richtung umkehren
          </button>
        )}
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
    </div>
  );
}

function FurnitureProps({ id, project }: { id: string; project: Project }) {
  const apply = useApply();
  const more = useUiStore((s) => s.multi.length);
  const multi = useUiStore((s) => s.multi);
  const extraCatalog = useCatalogStore((s) => s.items);
  const f = project.furniture.find((x) => x.id === id);
  if (!f) return <Gone />;
  const group = more > 0 ? selectedGroup(project, selectedFurnitureIds({ selection: { type: 'furniture', id }, multi })) : null;
  const upd = (fn: (x: Furniture) => void) =>
    apply((d) => {
      const x = d.furniture.find((q) => q.id === id);
      if (x) fn(x);
    });
  const packSize = f.price?.packSize ?? 1;
  const packs = packsNeeded(f.quantity, packSize);
  const issues = placementIssues(project, derivePlan(project), f);
  const summary = conflictSummary(issues);
  const original = catalogColors(f.catalogId, extraCatalog);
  const colorIsOriginal =
    !!original && f.color.toLowerCase() === original.color.toLowerCase() && (f.kitchen?.frontColor ?? '').toLowerCase() === (original.frontColor ?? '').toLowerCase();
  return (
    <div className="panel-scroll">
      {more > 0 && (
        <p className="multi-note" data-testid="multi-note">
          {group ? (
            <>
              <strong>
                Gruppe „{groupName(project, group)}“ ausgewählt ({more + 1} Möbel).
              </strong>{' '}
              Ziehen, Drehen, Pfeiltasten, Entf, Strg+D und Strg+C wirken auf die ganze Gruppe. Die Felder unten gelten nur für „{f.name}“.
            </>
          ) : (
            <>
              <strong>{more + 1} Möbel ausgewählt.</strong> Ziehen verschiebt alle, Pfeiltasten/Entf/Strg+D/Strg+C wirken auf alle. Die Felder unten gelten nur für „{f.name}“.
            </>
          )}
        </p>
      )}
      <GroupControls />
      <ArrangeControls />
      {issues.length > 0 && (
        <div className="panel-issues" data-testid="furniture-issues">
          {/* why the item is marked in 2D/3D, in a few words (#16) */}
          {summary && (
            <p className={summary.level === 'error' ? 'warning small error-text' : 'warning small'} data-testid="conflict-summary" data-level={summary.level}>
              <strong>{summary.label}:</strong> {summary.reasons.join(' · ')}
            </p>
          )}
          {issues.map((i, k) => (
            <p key={k} className={issueLevel(i.kind) === 'error' ? 'warning small error-text' : 'warning small'}>
              {i.message}
            </p>
          ))}
        </div>
      )}
      <PanelGroup groupKey="furniture.object" title="Objekt" actions={f.approximate ? <Badge kind="muted" title="Vereinfachtes 3D-Modell, Maße sind maßgeblich">Näherungsmodell</Badge> : undefined}>
        <TextField label="Name" value={f.name} onChange={(v) => upd((x) => (x.name = v.slice(0, 200)))} />
        <SelectField
          label="Kategorie"
          value={f.category}
          options={[...CATEGORIES.map((c) => ({ value: c.id as string, label: c.label })), ...(CATEGORIES.some((c) => c.id === f.category) ? [] : [{ value: f.category, label: categoryLabel(f.category) }])]}
          onChange={(v) => upd((x) => (x.category = v))}
        />
      </PanelGroup>
      {(f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape) === 'curtain' && <CurtainStateSection f={f} />}
      {f.category === 'lighting' && (
        <PanelGroup groupKey="furniture.lamp" title="Licht">
          <CheckField
            label="Lampe eingeschaltet"
            checked={!f.lightOff}
            title="Im Realismus-Modus leuchtet die Lampe abends und nachts (Schalter „Lampen“ im Menü „Mehr“). Ausgeschaltet bleibt sie dunkel."
            onChange={(v) => upd((x) => void (v ? delete x.lightOff : (x.lightOff = true)))}
          />
          <label className="field">
            <span className="field-label">
              Lichtfarbe {f.kelvin ?? DEFAULT_LAMP_KELVIN} K ({(f.kelvin ?? DEFAULT_LAMP_KELVIN) < 3300 ? 'warm' : (f.kelvin ?? DEFAULT_LAMP_KELVIN) < 5000 ? 'neutral' : 'kalt'})
              {f.kelvin === undefined ? ' – Annahme' : ''}
            </span>
            <input type="range" aria-label="Lichtfarbe der Lampe" min={2200} max={6500} step={100} value={f.kelvin ?? DEFAULT_LAMP_KELVIN} onChange={(e) => upd((x) => (x.kelvin = Number(e.target.value)))} />
          </label>
          <NumberField
            label="Lichtstrom"
            value={f.lumen ?? (f.model.type === 'procedural' ? DEFAULT_LUMEN[f.model.shape] : undefined) ?? FALLBACK_LUMEN}
            unit="lm"
            digits={0}
            min={0}
            max={20000}
            step={50}
            title="Lichtstrom der Lampe in Lumen (steht auf der Verpackung oder im Datenblatt). Bestimmt Helligkeit und Reichweite in 3D und die Lux-Lichtkarte im Tab Projekt."
            onChange={(v) => upd((x) => (x.lumen = Math.round(v)))}
          />
          <p className="muted small" data-testid="lamp-lumen-hint">
            {f.lumen === undefined ? 'Annahme: typischer Wert dieser Lampenart, kein Herstellerwert.' : 'Eigener Wert (z. B. von der Verpackung).'}
          </p>
          {f.lumen !== undefined && (
            <button type="button" onClick={() => upd((x) => void delete x.lumen)}>
              Auf typischen Wert zurücksetzen
            </button>
          )}
        </PanelGroup>
      )}
      <PanelGroup groupKey="furniture.position" title="Position" actions={f.locked ? <Badge kind="muted" title="Unter „Erweitert“ entsperren">gesperrt</Badge> : undefined}>
        <div className="field-row">
          <NumberField label="X" value={f.x} factor={100} unit="cm" disabled={f.locked} onChange={(v) => upd((x) => (x.x = v))} />
          <NumberField label="Y" value={f.y} factor={100} unit="cm" disabled={f.locked} onChange={(v) => upd((x) => (x.y = v))} />
        </div>
        <div className="field-row">
          <NumberField label="Drehung" value={radToDeg(f.rotation)} unit="°" min={-360} max={360} step={15} disabled={f.locked} onChange={(v) => setFurnitureRotation(f.id, degToRad(v))} />
          <AngleSlider label="Winkel (Regler)" testId="furniture-rotation-slider" value={radToDeg(f.rotation)} disabled={f.locked} onChange={(v) => setFurnitureRotation(f.id, degToRad(v))} />
          <NumberField label="Über Boden" value={f.elevation} factor={100} unit="cm" min={0} max={1000} onChange={(v) => upd((x) => (x.elevation = v))} />
        </div>
      </PanelGroup>
      <PanelGroup groupKey="furniture.size" title="Maße">
        {isRoundFootprint(f) && (
          <NumberField
            label="Durchmesser"
            value={f.width}
            factor={100}
            unit="cm"
            min={1}
            max={2000}
            title="Rund (Pflanze, Rundtisch, Lampe, Pouf): Breite und Tiefe werden gleich dem Durchmesser"
            onChange={(v) => upd((x) => { x.width = v; x.depth = v; })}
          />
        )}
        <div className="field-grid three">
          <NumberField label="Breite" value={f.width} factor={100} unit="cm" min={1} max={2000} onChange={(v) => upd((x) => (x.width = v))} />
          <NumberField label="Tiefe" value={f.depth} factor={100} unit="cm" min={1} max={2000} onChange={(v) => upd((x) => (x.depth = v))} />
          <NumberField label="Höhe" value={f.height} factor={100} unit="cm" min={0.1} max={1000} onChange={(v) => upd((x) => (x.height = v))} />
        </div>
      </PanelGroup>
      <PanelGroup groupKey="furniture.appearance" title="Aussehen">
        <SelectField<FurnitureFinish | 'auto'>
          label="Material"
          value={f.finish ?? 'auto'}
          options={[{ value: 'auto', label: 'Automatisch (Modell)' }, ...FURNITURE_FINISHES.map((m) => ({ value: m.id, label: m.label }))]}
          onChange={(v) =>
            upd((x) => {
              if (v === 'auto') delete x.finish;
              else x.finish = v;
            })
          }
        />
        <div className="finish-presets" role="group" aria-label="Standardmaterialien">
          {FURNITURE_FINISH_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="finish-preset"
              title={p.label}
              aria-label={p.label}
              aria-pressed={f.finish === p.finish && f.color.toLowerCase() === p.color}
              onClick={() =>
                upd((x) => {
                  x.finish = p.finish;
                  x.color = p.color;
                })
              }
            >
              <span className={`swatch finish-${p.finish}`} style={{ background: p.color }} />
            </button>
          ))}
        </div>
        {f.model.type === 'gltf' && <p className="small muted">Das Material wirkt auf das Ersatzmodell; eigene 3D-Modelle behalten ihre Oberfläche.</p>}
        <div className="field-row">
          <label className="field">
            <span className="field-label">Farbe</span>
            <span className="field-input">
              <input type="color" value={f.color} onChange={(e) => upd((x) => (x.color = e.target.value))} />
              <button
                type="button"
                className="color-auto"
                disabled={!original || colorIsOriginal}
                aria-pressed={colorIsOriginal}
                title={original ? 'Farbe auf die Originalfarbe des Modells zurückstellen' : 'Originalfarbe unbekannt (Modell nicht im Katalog)'}
                onClick={() =>
                  original &&
                  upd((x) => {
                    x.color = original.color;
                    if (x.kitchen) {
                      if (original.frontColor) x.kitchen.frontColor = original.frontColor;
                      else delete x.kitchen.frontColor;
                    }
                  })
                }
              >
                Automatisch
              </button>
            </span>
          </label>
          {f.kitchen && (
            <label className="field">
              <span className="field-label">Frontfarbe</span>
              <span className="field-input">
                <input type="color" value={f.kitchen.frontColor ?? f.color} onChange={(e) => upd((x) => x.kitchen && (x.kitchen.frontColor = e.target.value))} />
              </span>
            </label>
          )}
        </div>
      </PanelGroup>
      <PanelGroup groupKey="furniture.price" title="Preis">
        <div className="field-row">
          <NumberField
            label="Preis"
            value={f.price?.amount ?? 0}
            unit="€"
            min={0}
            max={1000000}
            digits={2}
            onChange={(v) => upd((x) => (x.price = { amount: v, currency: 'EUR', status: 'user', recordedAt: new Date().toISOString().slice(0, 10) }))}
          />
          <NumberField label={packSize > 1 ? 'Menge (Stück)' : 'Menge'} value={f.quantity} min={1} max={999} digits={0} onChange={(v) => upd((x) => (x.quantity = Math.max(1, Math.round(v))))} />
        </div>
        <div className="field-row">
          <NumberField
            label="Stück pro Packung"
            value={packSize}
            min={1}
            max={999}
            digits={0}
            onChange={(v) =>
              upd((x) => {
                const n = Math.max(1, Math.round(v));
                if (!x.price) return; // first enter the price
                if (n > 1) x.price.packSize = n;
                else delete x.price.packSize;
              })
            }
          />
        </div>
        {!f.price && <p className="muted small">Erst den Preis eintragen, dann „Stück pro Packung“ setzen.</p>}
        {packSize > 1 && <p className="muted small">Der Preis oben gilt für 1 Packung mit {packSize} Stück ({f.price ? formatEuro(f.price.amount / packSize) : '–'} pro Stück).</p>}
        <p className="small">
          {f.price ? (
            <>
              {formatEuro(f.price.amount * packs)} gesamt{packSize > 1 ? ` (${packs} ${packs === 1 ? 'Packung' : 'Packungen'} à ${packSize} Stück)` : ''} ·{' '}
              <Badge kind={f.price.status === 'confirmed' ? 'ok' : f.price.status === 'user' ? 'info' : 'warn'}>
                {f.price.status === 'confirmed' ? 'bestätigter Preis' : f.price.status === 'user' ? 'eigene Angabe' : 'Schätzung'}
              </Badge>
              {f.price.recordedAt && <span className="muted"> ({f.price.recordedAt})</span>}
            </>
          ) : (
            <Badge kind="error">Preis fehlt</Badge>
          )}
        </p>
        {f.price && (
          <button className="link-btn" onClick={() => upd((x) => (x.price = undefined))}>
            Preis entfernen
          </button>
        )}
      </PanelGroup>
      <InteriorSection f={f} upd={upd} />
      <PanelGroup groupKey="furniture.model" title="3D-Modell" defaultOpen={false} actions={f.model.type === 'gltf' ? <Badge kind="ok">GLB</Badge> : <Badge kind="muted">prozedural</Badge>}>
        <div className="btn-row">
          <button onClick={() => useDialogStore.getState().openModal('model', { furnitureId: f.id })}>{f.model.type === 'gltf' ? 'Anderes GLB…' : 'Eigenes GLB hinterlegen…'}</button>
          {f.model.type === 'gltf' && (
            <button
              onClick={() =>
                upd((x) => {
                  if (x.model.type === 'gltf') x.model = { type: 'procedural', shape: x.model.fallbackShape };
                  x.approximate = true;
                })
              }
            >
              Näherungsmodell verwenden
            </button>
          )}
        </div>
      </PanelGroup>
      <PanelGroup groupKey="furniture.product" title="Produkt" defaultOpen={false}>
        <TextField label="Marke" value={f.brand ?? ''} onChange={(v) => upd((x) => (x.brand = v || undefined))} />
        <TextField label="Händler" value={f.retailer ?? ''} onChange={(v) => upd((x) => (x.retailer = v || undefined))} placeholder="z. B. IKEA Österreich" />
        <TextField label="Produkt-URL" value={f.productUrl ?? ''} onChange={(v) => upd((x) => (x.productUrl = v || undefined))} placeholder="https://…" />
        {f.productUrl && /^https?:\/\//.test(f.productUrl) && (
          <a href={f.productUrl} target="_blank" rel="noopener noreferrer" className="small">
            Produktseite öffnen ↗
          </a>
        )}
      </PanelGroup>
      <DeliveryGroup f={f} />
      <PanelGroup groupKey="furniture.advanced" title="Erweitert" defaultOpen={false}>
        <CheckField label="Hindernis beim Begehen" checked={f.solid} onChange={(v) => upd((x) => (x.solid = v))} />
        <CheckField label="Gesperrt (nicht verschiebbar)" checked={f.locked} onChange={(v) => upd((x) => (x.locked = v))} />
        <CheckField label="Bestand (schon in der Wohnung, nicht im Budget)" checked={f.existing} onChange={(v) => upd((x) => (x.existing = v))} />
      </PanelGroup>
      <NotesSection project={project} type="furniture" targetId={id} />
      <div className="btn-row padded">
        <span className="rotate-group" role="group" aria-label="Drehen">
          <button onClick={() => (group ? rotateSelection(-Math.PI / 2) : setFurnitureRotation(f.id, f.rotation - Math.PI / 2))} disabled={f.locked} title="90° gegen den Uhrzeigersinn">
            ⟲ 90°
          </button>
          <button onClick={() => (group ? rotateSelection(-Math.PI / 12) : setFurnitureRotation(f.id, f.rotation - Math.PI / 12))} disabled={f.locked} title="15° gegen den Uhrzeigersinn (Taste Q)">
            ⟲ 15°
          </button>
          <button onClick={() => (group ? rotateSelection(Math.PI / 12) : setFurnitureRotation(f.id, f.rotation + Math.PI / 12))} disabled={f.locked} title="15° im Uhrzeigersinn (Taste E)">
            ⟳ 15°
          </button>
          <button onClick={() => (group ? rotateSelection(Math.PI / 2) : setFurnitureRotation(f.id, f.rotation + Math.PI / 2))} disabled={f.locked} title="90° im Uhrzeigersinn">
            ⟳ 90°
          </button>
        </span>
        <button onClick={duplicateSelection} title="Strg+D">
          Duplizieren
        </button>
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
      <p className="muted small padded">Tipp: Q/E dreht in 15°-Schritten, Pfeiltasten verschieben um 1 cm (Shift: 10 cm).</p>
    </div>
  );
}

function DeliveryGroup({ f }: { f: Furniture }) {
  const { furnitureId, result } = useDeliveryStore();
  const mine = furnitureId === f.id ? result : null;
  return (
    <PanelGroup groupKey="furniture.delivery" title="Lieferweg" defaultOpen={false}>
      <button className="block" onClick={() => runDeliveryCheck(f.id)} title="Prüft grob, ob das Möbel vom Eingang bis an seinen Platz getragen werden kann">
        Lieferweg prüfen
      </button>
      {mine && (
        <p className="small" data-testid="delivery-result" data-fits={mine.ok && mine.fits ? '1' : '0'} role="status">
          {mine.ok ? mine.message : mine.reason}
          {mine.ok && mine.bottleneck && mine.fits && <><br />{mine.bottleneck.label}</>}
        </p>
      )}
      <p className="muted small">Schätzung: Türen und Gänge, Kippen/Hochkant grob; Treppen und Drehen um Ecken werden nicht geprüft.</p>
    </PanelGroup>
  );
}

function LightProps({ id, project }: { id: string; project: Project }) {
  const apply = useApply();
  const l = project.lights.find((x) => x.id === id);
  if (!l) return <Gone />;
  const upd = (fn: (x: Light) => void) =>
    apply((d) => {
      const x = d.lights.find((q) => q.id === id);
      if (x) fn(x);
    });
  return (
    <div className="panel-scroll">
      <PanelGroup groupKey="light.object" title="Leuchte">
        <TextField label="Name" value={l.name} onChange={(v) => upd((x) => (x.name = v))} />
        <CheckField label="Eingeschaltet" checked={l.on} onChange={(v) => upd((x) => (x.on = v))} />
      </PanelGroup>
      <PanelGroup groupKey="light.position" title="Position">
        <div className="field-row">
          <NumberField label="X" value={l.x} factor={100} unit="cm" onChange={(v) => upd((x) => (x.x = v))} />
          <NumberField label="Y" value={l.y} factor={100} unit="cm" onChange={(v) => upd((x) => (x.y = v))} />
        </div>
        <NumberField label="Höhe" value={l.elevation} factor={100} unit="cm" min={0} max={1000} onChange={(v) => upd((x) => (x.elevation = v))} />
      </PanelGroup>
      <PanelGroup groupKey="light.light" title="Licht">
        <label className="field">
          <span className="field-label">Lichtfarbe {l.temperature} K ({l.temperature < 3300 ? 'warm' : l.temperature < 5000 ? 'neutral' : 'kalt'})</span>
          <input type="range" min={2200} max={6500} step={100} value={l.temperature} onChange={(e) => upd((x) => (x.temperature = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span className="field-label">Helligkeit {l.intensity.toFixed(1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={l.intensity} onChange={(e) => upd((x) => (x.intensity = Number(e.target.value)))} />
        </label>
      </PanelGroup>
      <LightSmart id={id} project={project} />
      <div className="btn-row padded">
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
    </div>
  );
}

/** „Smart machen“ for a placed light (#250): links a smart lamp device to it instead of adding a second light. */
function LightSmart({ id, project }: { id: string; project: Project }) {
  const lamps = DEVICE_PRODUCTS.filter((p) => p.kind === 'light');
  const [productId, setProductId] = useState(lamps[0]?.id ?? '');
  const dev = project.devices.find((x) => x.lightId === id);
  return (
    <PanelGroup groupKey="light.smart" title="Smart Home">
      {dev ? (
        <p className="small" data-testid="light-smart-linked">
          Smart: {dev.name}. Im Smart-Home-Reiter schaltbar; beim Löschen des Geräts bleibt die Leuchte erhalten.
        </p>
      ) : (
        <>
          <SelectField label="Produkt" value={productId} options={[...lamps.map((p) => ({ value: p.id, label: `${p.brand} ${p.model}` })), { value: '', label: 'Allgemein (Annahmewerte)' }]} onChange={setProductId} />
          <button onClick={() => makeLightSmartWithFeedback(id, productId || undefined)} data-testid="light-make-smart">
            Smart machen
          </button>
        </>
      )}
    </PanelGroup>
  );
}

function NothingSelected({ project }: { project: Project }) {
  const derived = useMemo(() => derivePlan(project), [project]);
  const total = [...derived.rooms.values()].reduce((s, g) => s + g.area, 0);
  const stated = statedAreaSummary(project.rooms, derived.rooms);
  return (
    <div className="panel-scroll">
      <Section title="Nichts ausgewählt">
        <p className="muted small">Ein Element im 2D-Plan oder in der 3D-Ansicht anklicken, um seine Eigenschaften und Maße zu bearbeiten.</p>
        <dl className="stats">
          <dt>Räume</dt>
          <dd>{project.rooms.length}</dd>
          <dt>Gesamtfläche</dt>
          <dd>{formatArea(total)}</dd>
          {stated && (
            <>
              <dt>Laut Plan</dt>
              <dd data-testid="stated-area">{formatArea(stated.stated)}</dd>
            </>
          )}
          <dt>Wände</dt>
          <dd>{project.walls.length}</dd>
          <dt>Türen / Fenster</dt>
          <dd>
            {project.openings.filter((o) => o.kind !== 'window').length} / {project.openings.filter((o) => o.kind === 'window').length}
          </dd>
          <dt>Objekte</dt>
          <dd>{project.furniture.length}</dd>
        </dl>
        {stated && (
          <p className="muted small" data-testid="stated-area-note">
            Die Gesamtfläche ist die Summe der Netto-Raumflächen (lichte Maße zwischen den Wandoberflächen). Der Plan nennt für {stated.withStated} Räume zusammen {formatArea(stated.stated)}; die berechnete Summe dieser Räume ist {formatArea(stated.computed)} ({stated.diff >= 0 ? '+' : '−'}
            {formatArea(Math.abs(stated.diff))}). Abweichungen entstehen durch gerundete Plan-Angaben, anders gezeichnete Wandstärken und Flächen, die der Plan nicht als Raum ausweist (Flur, Nischen, Schächte).
          </p>
        )}
      </Section>
      {project.rooms.length > 0 && (
        <Section title="Räume">
          <ul className="plain">
            {project.rooms.map((r) => (
              <li key={r.id}>
                <button className="link-btn" onClick={() => useUiStore.getState().setSelection({ type: 'room', id: r.id })}>
                  {r.name} – {formatArea(derived.rooms.get(r.id)?.area ?? 0)}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {project.walls.length === 0 && (
        <Section title="Loslegen">
          <ol className="steps">
            <li>Links „Raum mit Maßen anlegen“ – oder Werkzeug „Raum“ (R) und ein Rechteck aufziehen.</li>
            <li>Mit „Wand“ (W) weitere Wände zeichnen; Länge in cm tippen + Enter.</li>
            <li>Türen (T) und Fenster (F) auf Wände klicken.</li>
            <li>Möbel aus dem Katalog hinzufügen.</li>
            <li>Oder einen vorhandenen Plan importieren (Tab „Import“).</li>
          </ol>
        </Section>
      )}
    </div>
  );
}

function Gone() {
  return <p className="muted padded">Das ausgewählte Element existiert nicht mehr.</p>;
}

function pointIn(p: { x: number; y: number }, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Drop collinear interior vertices so split walls do not hide a rectangular room. */
function simplifyGeo<G extends { interior: { x: number; y: number }[] }>(g: G): G {
  const p = g.interior;
  const keep = p.filter((c, i) => {
    const a = p[(i - 1 + p.length) % p.length];
    const b = p[(i + 1) % p.length];
    const cr = (c.x - a.x) * (b.y - c.y) - (c.y - a.y) * (b.x - c.x);
    return Math.abs(cr) > 1e-6;
  });
  return { ...g, interior: keep };
}

const ROUND_SHAPES = new Set(['table-round', 'plant', 'floor-lamp', 'table-lamp', 'pendant', 'stool', 'pouf']);
/** Round things are listed by diameter in shops: offer one field that sets width = depth. */
function isRoundFootprint(f: { model: { type: string; shape?: string; fallbackShape?: string }; width: number; depth: number }): boolean {
  const shape = f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape;
  return ROUND_SHAPES.has(shape ?? '') || Math.abs(f.width - f.depth) < 0.0005;
}
