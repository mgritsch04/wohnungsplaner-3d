import { useMemo } from 'react';
import { derivePlan } from '../../model/derived';
import { wallLength } from '../../model/graph';
import { rectangularRoomSize } from '../../model/geometry/rooms';
import { deleteRoomWithWalls, setRectRoomSize, setWallAngle, setWallLength, splitWall, moveNode } from '../../model/operations';
import { degToRad, formatArea, formatEuro, formatLength, radToDeg } from '../../model/units';
import { categoryLabel, CATEGORIES } from '../../catalog/types';
import type { Furniture, Light, Material, Opening, Project, Provenance, Room } from '../../model/schema';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { deleteSelection, duplicateSelection, setFurnitureRotation } from '../actions';
import { confirmDialog, useDialogStore } from '../dialogStore';
import { Badge, CheckField, NumberField, Section, SelectField, TextField } from '../fields';
import { validateModel } from '../../model/validation';
import { placementIssues } from '../../model/placement';

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
      <Section title="Wand">
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
        <div className="field-row">
          <NumberField label="Start X" value={a.x} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.a, { x: v, y: a.y }))} />
          <NumberField label="Start Y" value={a.y} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.a, { x: a.x, y: v }))} />
        </div>
        <div className="field-row">
          <NumberField label="Ende X" value={b.x} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.b, { x: v, y: b.y }))} />
          <NumberField label="Ende Y" value={b.y} factor={100} unit="cm" onChange={(v) => apply((d) => moveNode(d, w.b, { x: b.x, y: v }))} />
        </div>
      </Section>
      <Section title="Oberflächen">
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
      </Section>
      <Section title={`Öffnungen (${openings.length})`}>
        {openings.length === 0 ? <p className="muted small">Tür/Fenster-Werkzeug wählen und auf die Wand klicken.</p> : null}
        <ul className="plain">
          {openings.map((o) => (
            <li key={o.id}>
              <button className="link-btn" onClick={() => useUiStore.getState().setSelection({ type: 'opening', id: o.id })}>
                {o.kind === 'door' ? 'Tür' : o.kind === 'window' ? 'Fenster' : 'Durchgang'} {Math.round(o.width * 100)} cm
              </button>
            </li>
          ))}
        </ul>
      </Section>
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
      <Section title="Raum">
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
        {!area?.closed && <p className="warning small">Der Raum ist nicht vollständig von Wänden umschlossen.</p>}
      </Section>
      {rect && (
        <Section title="Innenmaße (lichte Weite)">
          <div className="field-row">
            <NumberField label="Breite" value={rect.width} factor={100} unit="cm" min={30} max={10000} onChange={(v) => apply((d) => void setRectRoomSize(d, id, v, rect.depth))} />
            <NumberField label="Tiefe" value={rect.depth} factor={100} unit="cm" min={30} max={10000} onChange={(v) => apply((d) => void setRectRoomSize(d, id, rect.width, v))} />
          </div>
          <p className="muted small">Verschiebt die gegenüberliegenden Wände. Angrenzende Räume passen sich an.</p>
        </Section>
      )}
      {!rect && area && (
        <Section title="Maße">
          <p className="muted small">Nicht-rechteckiger Raum: Maße über die Wände oder Ecken ändern (anklicken bzw. ziehen).</p>
        </Section>
      )}
      <Section title="Oberflächen">
        <MaterialSelect label="Boden" value={r.floorMaterialId} materials={project.materials} kinds={['wood', 'tile', 'stone', 'carpet', 'concrete']} emptyLabel="Standard (Eiche)" onChange={(m) => upd((x) => (x.floorMaterialId = m))} />
        <MaterialSelect label="Wände" value={r.wallMaterialId} materials={project.materials} kinds={['paint', 'concrete', 'tile', 'wood', 'stone']} emptyLabel="Standard (Weiß)" onChange={(m) => upd((x) => (x.wallMaterialId = m))} />
        <MaterialSelect label="Decke" value={r.ceilingMaterialId} materials={project.materials} kinds={['paint', 'concrete', 'wood']} emptyLabel="Standard (Weiß)" onChange={(m) => upd((x) => (x.ceilingMaterialId = m))} />
      </Section>
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
      <Section title={o.kind === 'door' ? 'Tür' : o.kind === 'window' ? 'Fenster' : 'Durchgang'}>
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
              x.kind = k;
              if (k === 'window' && x.sillHeight === 0) {
                x.sillHeight = 0.9;
                x.height = Math.min(x.height, 1.4);
              }
              if (k !== 'window') x.sillHeight = 0;
            })
          }
        />
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
        {o.kind === 'door' && (
          <div className="field-row">
            <SelectField label="Anschlag" value={o.hinge} options={[{ value: 'start', label: 'Wandanfang' }, { value: 'end', label: 'Wandende' }]} onChange={(v) => upd((x) => (x.hinge = v))} />
            <SelectField label="Öffnet nach" value={o.swing} options={[{ value: 'left', label: 'Seite A' }, { value: 'right', label: 'Seite B' }]} onChange={(v) => upd((x) => (x.swing = v))} />
          </div>
        )}
        {issues.map((i, k) => (
          <p key={k} className="warning small">
            {i.message}
          </p>
        ))}
      </Section>
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
  const f = project.furniture.find((x) => x.id === id);
  if (!f) return <Gone />;
  const upd = (fn: (x: Furniture) => void) =>
    apply((d) => {
      const x = d.furniture.find((q) => q.id === id);
      if (x) fn(x);
    });
  const issues = placementIssues(project, derivePlan(project), f);
  return (
    <div className="panel-scroll">
      <Section title="Objekt" actions={f.approximate ? <Badge kind="muted" title="Vereinfachtes 3D-Modell, Maße sind maßgeblich">Näherungsmodell</Badge> : undefined}>
        <TextField label="Name" value={f.name} onChange={(v) => upd((x) => (x.name = v.slice(0, 200)))} />
        <SelectField
          label="Kategorie"
          value={f.category}
          options={[...CATEGORIES.map((c) => ({ value: c.id as string, label: c.label })), ...(CATEGORIES.some((c) => c.id === f.category) ? [] : [{ value: f.category, label: categoryLabel(f.category) }])]}
          onChange={(v) => upd((x) => (x.category = v))}
        />
        <div className="field-row">
          <NumberField label="X" value={f.x} factor={100} unit="cm" disabled={f.locked} onChange={(v) => upd((x) => (x.x = v))} />
          <NumberField label="Y" value={f.y} factor={100} unit="cm" disabled={f.locked} onChange={(v) => upd((x) => (x.y = v))} />
        </div>
        <div className="field-row">
          <NumberField label="Drehung" value={radToDeg(f.rotation)} unit="°" min={-360} max={360} step={15} disabled={f.locked} onChange={(v) => setFurnitureRotation(f.id, degToRad(v))} />
          <NumberField label="Über Boden" value={f.elevation} factor={100} unit="cm" min={0} max={1000} onChange={(v) => upd((x) => (x.elevation = v))} />
        </div>
        <div className="field-grid three">
          <NumberField label="Breite" value={f.width} factor={100} unit="cm" min={1} max={2000} onChange={(v) => upd((x) => (x.width = v))} />
          <NumberField label="Tiefe" value={f.depth} factor={100} unit="cm" min={1} max={2000} onChange={(v) => upd((x) => (x.depth = v))} />
          <NumberField label="Höhe" value={f.height} factor={100} unit="cm" min={0.1} max={1000} onChange={(v) => upd((x) => (x.height = v))} />
        </div>
        <label className="field">
          <span className="field-label">Farbe</span>
          <span className="field-input">
            <input type="color" value={f.color} onChange={(e) => upd((x) => (x.color = e.target.value))} />
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
        <CheckField label="Hindernis beim Begehen" checked={f.solid} onChange={(v) => upd((x) => (x.solid = v))} />
        <CheckField label="Gesperrt (nicht verschiebbar)" checked={f.locked} onChange={(v) => upd((x) => (x.locked = v))} />
        {issues.map((i, k) => (
          <p key={k} className={i.kind === "door-swing" || i.kind === "overlap" ? "warning small" : "warning small error-text"}>
            {i.message}
          </p>
        ))}
      </Section>
      <Section title="Preis">
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
          <NumberField label="Menge" value={f.quantity} min={1} max={999} digits={0} onChange={(v) => upd((x) => (x.quantity = Math.max(1, Math.round(v))))} />
        </div>
        <p className="small">
          {f.price ? (
            <>
              {formatEuro(f.price.amount * f.quantity)} gesamt ·{' '}
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
      </Section>
      <Section title="3D-Modell" actions={f.model.type === 'gltf' ? <Badge kind="ok">GLB</Badge> : <Badge kind="muted">prozedural</Badge>}>
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
      </Section>
      <Section title="Produkt">
        <TextField label="Marke" value={f.brand ?? ''} onChange={(v) => upd((x) => (x.brand = v || undefined))} />
        <TextField label="Händler" value={f.retailer ?? ''} onChange={(v) => upd((x) => (x.retailer = v || undefined))} placeholder="z. B. IKEA Österreich" />
        <TextField label="Produkt-URL" value={f.productUrl ?? ''} onChange={(v) => upd((x) => (x.productUrl = v || undefined))} placeholder="https://…" />
        {f.productUrl && /^https?:\/\//.test(f.productUrl) && (
          <a href={f.productUrl} target="_blank" rel="noopener noreferrer" className="small">
            Produktseite öffnen ↗
          </a>
        )}
      </Section>
      <div className="btn-row padded">
        <span className="rotate-group" role="group" aria-label="Drehen">
          <button onClick={() => setFurnitureRotation(f.id, f.rotation - Math.PI / 2)} disabled={f.locked} title="90° gegen den Uhrzeigersinn">
            ⟲ 90°
          </button>
          <button onClick={() => setFurnitureRotation(f.id, f.rotation - Math.PI / 12)} disabled={f.locked} title="15° gegen den Uhrzeigersinn (Taste Q)">
            ⟲ 15°
          </button>
          <button onClick={() => setFurnitureRotation(f.id, f.rotation + Math.PI / 12)} disabled={f.locked} title="15° im Uhrzeigersinn (Taste E)">
            ⟳ 15°
          </button>
          <button onClick={() => setFurnitureRotation(f.id, f.rotation + Math.PI / 2)} disabled={f.locked} title="90° im Uhrzeigersinn">
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
      <Section title="Leuchte">
        <TextField label="Name" value={l.name} onChange={(v) => upd((x) => (x.name = v))} />
        <CheckField label="Eingeschaltet" checked={l.on} onChange={(v) => upd((x) => (x.on = v))} />
        <div className="field-row">
          <NumberField label="X" value={l.x} factor={100} unit="cm" onChange={(v) => upd((x) => (x.x = v))} />
          <NumberField label="Y" value={l.y} factor={100} unit="cm" onChange={(v) => upd((x) => (x.y = v))} />
        </div>
        <NumberField label="Höhe" value={l.elevation} factor={100} unit="cm" min={0} max={1000} onChange={(v) => upd((x) => (x.elevation = v))} />
        <label className="field">
          <span className="field-label">Lichtfarbe {l.temperature} K ({l.temperature < 3300 ? 'warm' : l.temperature < 5000 ? 'neutral' : 'kalt'})</span>
          <input type="range" min={2200} max={6500} step={100} value={l.temperature} onChange={(e) => upd((x) => (x.temperature = Number(e.target.value)))} />
        </label>
        <label className="field">
          <span className="field-label">Helligkeit {l.intensity.toFixed(1)}</span>
          <input type="range" min={0} max={5} step={0.1} value={l.intensity} onChange={(e) => upd((x) => (x.intensity = Number(e.target.value)))} />
        </label>
      </Section>
      <div className="btn-row padded">
        <button className="danger" onClick={() => void deleteSelection()}>
          Löschen
        </button>
      </div>
    </div>
  );
}

function NothingSelected({ project }: { project: Project }) {
  const derived = useMemo(() => derivePlan(project), [project]);
  const total = [...derived.rooms.values()].reduce((s, g) => s + g.area, 0);
  return (
    <div className="panel-scroll">
      <Section title="Nichts ausgewählt">
        <p className="muted small">Ein Element im 2D-Plan oder in der 3D-Ansicht anklicken, um seine Eigenschaften und Maße zu bearbeiten.</p>
        <dl className="stats">
          <dt>Räume</dt>
          <dd>{project.rooms.length}</dd>
          <dt>Gesamtfläche</dt>
          <dd>{formatArea(total)}</dd>
          <dt>Wände</dt>
          <dd>{project.walls.length}</dd>
          <dt>Türen / Fenster</dt>
          <dd>
            {project.openings.filter((o) => o.kind !== 'window').length} / {project.openings.filter((o) => o.kind === 'window').length}
          </dd>
          <dt>Objekte</dt>
          <dd>{project.furniture.length}</dd>
        </dl>
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
