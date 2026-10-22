import { useRef, useState } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { CheckField, NumberField, Section, Badge, SelectField } from '../fields';
import { importIkeaPlannerFile } from '../../import/ikeaPlanActions';
import { applyScaleNotation, PLAN_FILE_ACCEPT, removeUnderlay, startPlanImport } from '../../import/underlayImport';
import { importFloorPlanJsonFile, acceptDraft } from '../../import/floorPlanActions';
import { useImportStore, useSourceAnalysis } from '../../import/importStore';
import { dist } from '../../model/vec';
import { FIXTURE_KINDS, FIXTURE_LABEL } from '../../model/fixtures';
import type { FixtureKind } from '../../model/schema';
import { openingLabel } from '../../model/schema';
import { degToRad, formatArea, formatLength, radToDeg } from '../../model/units';
import { refreshDraftRooms, runRecognition } from '../../import/recognition/runRecognition';
import type { DraftStatus } from '../../import/draft';
import { findDraftConflicts } from '../../import/review';
import { checkScale, scaleCheckMessage } from '../../import/dimensions';

export function ImportPanel() {
  const underlay = useProjectStore((s) => s.project.underlay);
  const draft = useImportStore((s) => s.draft);
  const progress = useImportStore((s) => s.progress);
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  if (draft) return <DraftReview />;

  return (
    <div className="panel-scroll">
      {progress && (
        <div className="progress" role="status">
          <span>{progress.label}</span>
          <progress value={progress.value} max={1} />
        </div>
      )}
      <Section title="Grundriss importieren">
        <div
          className={`dropzone ${dragOver ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void startPlanImport(f);
          }}
          onClick={() => fileRef.current?.click()}
          role="button"
          tabIndex={0}
        >
          <strong>PDF, PNG oder JPG</strong>
          <span>hierher ziehen oder klicken</span>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept={PLAN_FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void startPlanImport(f);
          }}
        />
        <p className="muted small">Die Datei wird nur lokal in deinem Browser verarbeitet und gespeichert – nichts wird hochgeladen.</p>
        <button className="block" onClick={() => void importFloorPlanJsonFile()}>
          Grundriss-JSON (apartment-plan.json) importieren…
        </button>
        <button className="block" onClick={() => void importIkeaPlannerFile()} title="Gespeicherte Planung aus dem IKEA-PAX-/Aufbewahrungsplaner (JSON). Optional zusammen mit der Produktliste (produktliste.json) wählen – dann bekommen die Korpusse echte Namen und Preise. Anleitung: docs/IKEA_PLANUNG_JSON.md">
          IKEA-Planung (JSON) importieren…
        </button>
      </Section>
      {underlay && <UnderlayControls />}
      {!underlay && (
        <Section title="So funktioniert es">
          <ol className="steps">
            <li>Plan (PDF/Bild) importieren – bei mehrseitigen PDFs die Seite wählen.</li>
            <li>
              Maßstab kalibrieren: zwei Punkte einer <em>bekannten</em> Strecke anklicken und die echte Länge eingeben.
            </li>
            <li>Mit weiteren bekannten Maßen kontrollieren.</li>
            <li>Wände, Türen und Fenster mit den normalen Werkzeugen nachzeichnen – oder die automatische Erkennung (Beta) versuchen und das Ergebnis prüfen.</li>
          </ol>
        </Section>
      )}
    </div>
  );
}

function UnderlayControls() {
  const u = useProjectStore((s) => s.project.underlay)!;
  const apply = useProjectStore((s) => s.apply);
  const setTool = useUiStore((s) => s.setTool);
  const tool = useUiStore((s) => s.tool);
  const measurements = useUiStore((s) => s.measurements);
  const analysis = useSourceAnalysis((s) => s.analysis);
  const [checks, setChecks] = useState<Record<string, string>>({});
  const [scaleText, setScaleText] = useState('100');
  const [cropOn, setCropOn] = useState(!!u.crop);
  const progress = useImportStore((s) => s.progress);

  const set = (fn: (x: NonNullable<typeof u>) => void) =>
    apply((d) => {
      if (d.underlay) fn(d.underlay);
    });

  // dimension texts of a vector PDF vs. the current scale (only shown once a scale is set; never applied automatically)
  const dimCheck = analysis && analysis.imageAssetId === u.imageAssetId && analysis.dimensions?.length && (u.calibrated || u.scaleSource === 'notation') ? checkScale(analysis.dimensions, u.metersPerPixel) : null;
  const dimMessage = dimCheck && scaleCheckMessage(dimCheck);

  const scaleBadge = u.calibrated ? (
    <Badge kind="ok">Kalibriert</Badge>
  ) : u.scaleSource === 'notation' ? (
    <Badge kind="warn" title="Aus Maßstabsangabe berechnet – nicht durch Messung bestätigt">Maßstab angenommen</Badge>
  ) : (
    <Badge kind="error">Nicht kalibriert</Badge>
  );

  return (
    <>
      <Section title="Plan-Hintergrund" actions={scaleBadge}>
        <p className="small">
          <strong>{u.fileName}</strong>
          {u.sourceKind === 'pdf' && ` · Seite ${u.pdfPage}/${u.pdfPageCount}`}
          <br />
          <span className="muted">
            {u.pixelWidth}×{u.pixelHeight} px
            {u.pdfContent &&
              ` · ${u.pdfContent === 'vector' ? 'Vektorzeichnung' : u.pdfContent === 'raster' ? 'gescannt (Raster)' : u.pdfContent === 'mixed' ? 'Vektor + Raster' : 'Inhalt unbekannt'}`}
          </span>
        </p>
        {!u.calibrated && (
          <p className="warning small">
            {u.scaleSource === 'notation'
              ? 'Der Maßstab wurde aus einer Angabe berechnet und ist nicht überprüft. Bitte mit einer Referenzstrecke kalibrieren.'
              : 'Der Plan ist nicht kalibriert – angezeigte Maße sind bedeutungslos, bis der Maßstab festgelegt ist.'}
          </p>
        )}
        <button className={`block ${tool === 'calibrate' ? 'active' : 'primary'}`} onClick={() => setTool(tool === 'calibrate' ? 'select' : 'calibrate')}>
          {tool === 'calibrate' ? 'Kalibrierung abbrechen' : u.calibrated ? 'Neu kalibrieren (2 Punkte)' : 'Maßstab kalibrieren (2 Punkte)'}
        </button>
        {u.calibration && (
          <p className="muted small">
            Referenz: {dist(u.calibration.p1, u.calibration.p2).toFixed(1)} px = {formatLength(u.calibration.distance)} → 1 m = {(1 / u.metersPerPixel).toFixed(1)} px
          </p>
        )}
        {u.sourceKind === 'pdf' && u.pixelsPerPoint && (
          <div className="field-row compact">
            <label className="field">
              <span className="field-label">Maßstab 1:</span>
              <span className="field-input">
                <input value={scaleText} onChange={(e) => setScaleText(e.target.value)} inputMode="numeric" />
              </span>
            </label>
            <button
              onClick={() => {
                const n = parseFloat(scaleText.replace(',', '.'));
                if (n > 0 && n < 100000) applyScaleNotation(n);
              }}
              title="Nur sinnvoll, wenn das PDF in Originalgröße (1:1 Papiermaß) vorliegt. Wird als ungeprüft markiert."
            >
              Aus Angabe übernehmen
            </button>
          </div>
        )}
        {dimMessage && (
          <p className={dimCheck?.status === 'mismatch' ? 'warning small' : 'muted small'} data-testid="dimension-check">
            {dimMessage}
          </p>
        )}
      </Section>

      <Section title="Darstellung & Ausrichtung">
        <CheckField label="Anzeigen" checked={u.visible} onChange={(v) => set((x) => (x.visible = v))} />
        <CheckField label="Sperren (gegen Verschieben)" checked={u.locked} onChange={(v) => set((x) => (x.locked = v))} />
        <label className="field">
          <span className="field-label">Deckkraft {Math.round(u.opacity * 100)} %</span>
          <input type="range" min={0.05} max={1} step={0.05} value={u.opacity} onChange={(e) => set((x) => (x.opacity = Number(e.target.value)))} />
        </label>
        <div className="field-row">
          <NumberField label="X" value={u.x} factor={100} unit="cm" disabled={u.locked} onChange={(v) => set((x) => (x.x = v))} />
          <NumberField label="Y" value={u.y} factor={100} unit="cm" disabled={u.locked} onChange={(v) => set((x) => (x.y = v))} />
        </div>
        <NumberField label="Drehung" value={radToDeg(u.rotation)} unit="°" min={-360} max={360} step={0.5} disabled={u.locked} onChange={(v) => set((x) => (x.rotation = degToRad(v)))} />
        <p className="muted small">Verschieben: Strg + Ziehen im Plan (wenn nicht gesperrt).</p>
        <CheckField
          label="Zuschneiden"
          checked={cropOn}
          onChange={(v) => {
            setCropOn(v);
            set((x) => (x.crop = v ? { x: 0, y: 0, width: x.pixelWidth, height: x.pixelHeight } : undefined));
          }}
        />
        {u.crop && (
          <div className="field-grid">
            <NumberField label="Links" value={u.crop.x} unit="px" min={0} max={u.pixelWidth - 10} digits={0} onChange={(v) => set((x) => x.crop && (x.crop.x = v))} />
            <NumberField label="Oben" value={u.crop.y} unit="px" min={0} max={u.pixelHeight - 10} digits={0} onChange={(v) => set((x) => x.crop && (x.crop.y = v))} />
            <NumberField label="Breite" value={u.crop.width} unit="px" min={10} max={u.pixelWidth} digits={0} onChange={(v) => set((x) => x.crop && (x.crop.width = v))} />
            <NumberField label="Höhe" value={u.crop.height} unit="px" min={10} max={u.pixelHeight} digits={0} onChange={(v) => set((x) => x.crop && (x.crop.height = v))} />
          </div>
        )}
        <button className="danger-link" onClick={() => void removeUnderlay()}>
          Plan-Hintergrund entfernen
        </button>
      </Section>

      <Section title="Kalibrierung kontrollieren">
        <p className="muted small">Mit dem Messwerkzeug (M) bekannte Strecken im Plan messen und hier die Soll-Länge eintragen.</p>
        {measurements.length === 0 && (
          <button className="block" onClick={() => setTool('measure')}>
            Messwerkzeug starten
          </button>
        )}
        <ul className="check-list">
          {measurements.map((m, i) => {
            const measured = dist(m.a, m.b);
            const known = parseFloat((checks[m.id] ?? '').replace(',', '.')) / 100;
            const dev = known > 0 ? (measured - known) / known : null;
            return (
              <li key={m.id}>
                <span>
                  #{i + 1}: {formatLength(measured)}
                </span>
                <input placeholder="Soll (cm)" value={checks[m.id] ?? ''} onChange={(e) => setChecks({ ...checks, [m.id]: e.target.value })} inputMode="decimal" />
                {dev !== null && (
                  <Badge kind={Math.abs(dev) <= 0.01 ? 'ok' : Math.abs(dev) <= 0.03 ? 'warn' : 'error'}>
                    {dev >= 0 ? '+' : ''}
                    {(dev * 100).toFixed(1)} %
                  </Badge>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Automatische Erkennung (Beta)">
        <p className="muted small">
          Versucht Wände {analysis?.kind === 'vector' || analysis?.kind === 'mixed' ? 'aus den Vektordaten des PDFs' : 'aus dem Bild (dunkle, dicke Linien)'} sowie Öffnungen zu erkennen – auch schräge
          Wände – und schlägt für geschlossene Wandzüge Räume vor. Das Ergebnis ist ein Vorschlag und muss geprüft werden. Funktioniert am besten bei sauberen
          Plänen.
        </p>
        <button className="block" disabled={!u.calibrated || !!progress} onClick={() => void runRecognition()} title={u.calibrated ? '' : 'Erst den Maßstab kalibrieren'}>
          Erkennung starten
        </button>
        {!u.calibrated && <p className="muted small">Erst nach der Kalibrierung verfügbar – ohne Maßstab sind Wanddicken nicht bestimmbar.</p>}
      </Section>
    </>
  );
}

const STATUS_LABEL: Record<DraftStatus, string> = { confirmed: 'bestätigt', estimated: 'geschätzt', uncertain: 'unsicher' };
const STATUS_KIND: Record<DraftStatus, 'ok' | 'warn' | 'error'> = { confirmed: 'ok', estimated: 'warn', uncertain: 'error' };

const FIXTURE_LABELS: Record<string, string> = { 'generic-bathtub': 'Badewanne', 'generic-washbasin': 'Waschbecken', 'generic-toilet': 'WC' };

function DraftReview() {
  const draft = useImportStore((s) => s.draft)!;
  const selected = useImportStore((s) => s.selected);
  const st = useImportStore.getState;
  const conflicts = findDraftConflicts(draft);
  const accepted = {
    walls: draft.walls.filter((w) => w.accepted).length,
    openings: draft.openings.filter((o) => o.accepted).length,
    rooms: draft.rooms.filter((r) => r.accepted).length,
    fixtures: (draft.fixtures ?? []).filter((x) => x.accepted).length,
    installations: (draft.installations ?? []).filter((x) => x.accepted).length,
  };
  const sel = selected;
  const selWall = sel?.type === 'wall' ? draft.walls.find((w) => w.id === sel.id) : undefined;
  const selOpening = sel?.type === 'opening' ? draft.openings.find((o) => o.id === sel.id) : undefined;
  const selRoom = sel?.type === 'room' ? draft.rooms.find((r) => r.id === sel.id) : undefined;
  const selFixture = sel?.type === 'fixture' ? draft.fixtures?.find((x) => x.id === sel.id) : undefined;
  const selInstall = sel?.type === 'installation' ? draft.installations?.find((x) => x.id === sel.id) : undefined;

  return (
    <div className="panel-scroll">
      <Section title="Import prüfen" actions={<Badge kind={draft.scaleConfirmed ? 'ok' : 'error'}>{draft.scaleConfirmed ? 'Maßstab bestätigt' : 'Maßstab unbestätigt'}</Badge>}>
        <p className="small">
          Quelle: <strong>{draft.sourceName}</strong> ({draft.source === 'json' ? 'JSON-Datei' : draft.source === 'pdf-vector' ? 'PDF-Vektordaten' : 'Bilderkennung'})
        </p>
        <p className="small">
          Ausgewählt: {accepted.walls}/{draft.walls.length} Wände · {accepted.openings}/{draft.openings.length} Öffnungen · {accepted.rooms}/{draft.rooms.length} Räume{draft.fixtures?.length ? ` · ${accepted.fixtures}/${draft.fixtures.length} Sanitärobjekte` : ''}{draft.installations?.length ? ` · ${accepted.installations}/${draft.installations.length} Anschlüsse` : ''}
        </p>
        <div className="legend small">
          <span className="lg lg-confirmed" /> bestätigt <span className="lg lg-estimated" /> geschätzt <span className="lg lg-uncertain" /> unsicher
        </div>
        <SelectField
          label="Übernahme"
          value={draft.mode}
          options={[
            { value: 'merge', label: 'Zum bestehenden Grundriss hinzufügen' },
            { value: 'replace', label: 'Bestehenden Grundriss ersetzen' },
          ]}
          onChange={(mode) => st().patchDraft({ mode })}
        />
        <CheckField label="Maßstab ist korrekt (bestätigt)" checked={draft.scaleConfirmed} onChange={(v) => st().patchDraft({ scaleConfirmed: v })} />
        <div className="btn-row">
          <button onClick={() => st().setAllAccepted(true)}>Alle auswählen</button>
          <button onClick={() => st().setAllAccepted(false)}>Keine</button>
        </div>
        <div className="btn-row">
          <button className="primary" onClick={() => void acceptDraft()} disabled={accepted.walls + accepted.openings + accepted.rooms + accepted.fixtures + accepted.installations === 0}>
            In Plan übernehmen
          </button>
          <button onClick={() => st().setDraft(null)}>Verwerfen</button>
        </div>
      </Section>

      {(conflicts.length > 0 || draft.warnings.length > 0) && (
        <Section title={`Hinweise (${conflicts.length + draft.warnings.length})`}>
          <ul className="issues">
            {draft.warnings.map((w, i) => (
              <li key={`w${i}`}>{w}</li>
            ))}
            {conflicts.map((c, i) => (
              <li key={`c${i}`}>
                <button className="link-btn" onClick={() => st().select({ type: draft.walls.some((w) => w.id === c.ids[0]) ? 'wall' : 'opening', id: c.ids[0] })}>
                  {c.message}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {selWall && (
        <Section title="Ausgewählte Wand" actions={<Badge kind={STATUS_KIND[selWall.status]}>{STATUS_LABEL[selWall.status]}</Badge>}>
          {selWall.confidence !== undefined && <p className="muted small">Erkennungs-Konfidenz: {Math.round(selWall.confidence * 100)} %</p>}
          {selWall.note && <p className="muted small">{selWall.note}</p>}
          <div className="field-grid">
            <NumberField label="Start X" value={selWall.a.x} factor={100} unit="cm" onChange={(v) => st().updateWall(selWall.id, { a: { ...selWall.a, x: v } })} />
            <NumberField label="Start Y" value={selWall.a.y} factor={100} unit="cm" onChange={(v) => st().updateWall(selWall.id, { a: { ...selWall.a, y: v } })} />
            <NumberField label="Ende X" value={selWall.b.x} factor={100} unit="cm" onChange={(v) => st().updateWall(selWall.id, { b: { ...selWall.b, x: v } })} />
            <NumberField label="Ende Y" value={selWall.b.y} factor={100} unit="cm" onChange={(v) => st().updateWall(selWall.id, { b: { ...selWall.b, y: v } })} />
            <NumberField label="Dicke" value={selWall.thickness} factor={100} unit="cm" min={2} max={200} onChange={(v) => st().updateWall(selWall.id, { thickness: v })} />
            <NumberField label="Höhe" value={selWall.height} factor={100} unit="cm" min={50} max={1000} onChange={(v) => st().updateWall(selWall.id, { height: v })} />
          </div>
          <p className="muted small">Länge: {formatLength(dist(selWall.a, selWall.b))}</p>
          <ElementActions
            accepted={selWall.accepted}
            onToggle={() => st().updateWall(selWall.id, { accepted: !selWall.accepted })}
            onConfirm={() => st().updateWall(selWall.id, { status: 'confirmed' })}
            onRemove={() => st().removeElement('wall', selWall.id)}
          />
        </Section>
      )}
      {selOpening && (
        <Section title={selOpening.kind === 'window' ? 'Ausgewähltes Fenster' : 'Ausgewählte Tür/Öffnung'} actions={<Badge kind={STATUS_KIND[selOpening.status]}>{STATUS_LABEL[selOpening.status]}</Badge>}>
          {selOpening.note && <p className="muted small">{selOpening.note}</p>}
          <SelectField
            label="Typ"
            value={selOpening.kind}
            options={[
              { value: 'door', label: 'Tür' },
              { value: 'window', label: 'Fenster' },
              { value: 'passage', label: 'Durchgang' },
            ]}
            onChange={(kind) => st().updateOpening(selOpening.id, { kind, sillHeight: kind === 'window' ? 0.9 : 0, height: kind === 'window' ? 1.4 : 2.1 })}
          />
          <div className="field-grid">
            <NumberField label="Mitte X" value={selOpening.center.x} factor={100} unit="cm" onChange={(v) => st().updateOpening(selOpening.id, { center: { ...selOpening.center, x: v } })} />
            <NumberField label="Mitte Y" value={selOpening.center.y} factor={100} unit="cm" onChange={(v) => st().updateOpening(selOpening.id, { center: { ...selOpening.center, y: v } })} />
            <NumberField label="Breite" value={selOpening.width} factor={100} unit="cm" min={10} max={1000} onChange={(v) => st().updateOpening(selOpening.id, { width: v })} />
            <NumberField label="Höhe" value={selOpening.height} factor={100} unit="cm" min={10} max={1000} onChange={(v) => st().updateOpening(selOpening.id, { height: v })} />
            <NumberField label="Brüstung" value={selOpening.sillHeight} factor={100} unit="cm" min={0} max={500} onChange={(v) => st().updateOpening(selOpening.id, { sillHeight: v })} />
          </div>
          <ElementActions
            accepted={selOpening.accepted}
            onToggle={() => st().updateOpening(selOpening.id, { accepted: !selOpening.accepted })}
            onConfirm={() => st().updateOpening(selOpening.id, { status: 'confirmed' })}
            onRemove={() => st().removeElement('opening', selOpening.id)}
          />
        </Section>
      )}
      {selRoom && (
        <Section title="Ausgewählter Raum" actions={<Badge kind={STATUS_KIND[selRoom.status]}>{STATUS_LABEL[selRoom.status]}</Badge>}>
          <label className="field">
            <span className="field-label">Name</span>
            <span className="field-input">
              <input value={selRoom.name} onChange={(e) => st().updateRoom(selRoom.id, { name: e.target.value })} />
            </span>
          </label>
          {selRoom.area !== undefined && <p className="muted small">Berechnete Fläche (aus den vorgeschlagenen Wänden): {formatArea(selRoom.area)}</p>}
          {selRoom.statedArea !== undefined && <p className="muted small">Angegebene Fläche: {selRoom.statedArea.toFixed(2)} m² (wird nach der Übernahme verglichen)</p>}
          <ElementActions
            accepted={selRoom.accepted}
            onToggle={() => st().updateRoom(selRoom.id, { accepted: !selRoom.accepted })}
            onConfirm={() => st().updateRoom(selRoom.id, { status: 'confirmed' })}
            onRemove={() => st().removeElement('room', selRoom.id)}
          />
        </Section>
      )}

      {selFixture && (
        <Section title="Ausgewähltes Sanitärobjekt" actions={<Badge kind={STATUS_KIND[selFixture.status]}>{STATUS_LABEL[selFixture.status]}</Badge>}>
          {selFixture.note && <p className="muted small">{selFixture.note}</p>}
          <p className="muted small">Wird als Bestand übernommen: steht im Plan, aber nicht in Budget und Einkaufsliste.</p>
          <SelectField
            label="Art"
            value={selFixture.catalogId}
            options={Object.entries(FIXTURE_LABELS).map(([value, label]) => ({ value, label }))}
            onChange={(catalogId) => st().updateFixture(selFixture.id, { catalogId, name: FIXTURE_LABELS[catalogId] })}
          />
          <div className="field-grid">
            <NumberField label="Mitte X" value={selFixture.center.x} factor={100} unit="cm" onChange={(v) => st().updateFixture(selFixture.id, { center: { ...selFixture.center, x: v } })} />
            <NumberField label="Mitte Y" value={selFixture.center.y} factor={100} unit="cm" onChange={(v) => st().updateFixture(selFixture.id, { center: { ...selFixture.center, y: v } })} />
            <NumberField label="Breite" value={selFixture.width} factor={100} unit="cm" min={10} max={300} onChange={(v) => st().updateFixture(selFixture.id, { width: v })} />
            <NumberField label="Tiefe" value={selFixture.depth} factor={100} unit="cm" min={10} max={300} onChange={(v) => st().updateFixture(selFixture.id, { depth: v })} />
            <NumberField label="Drehung" value={Math.round((selFixture.rotation * 180) / Math.PI)} unit="°" min={-360} max={360} onChange={(v) => st().updateFixture(selFixture.id, { rotation: (v * Math.PI) / 180 })} />
          </div>
          <ElementActions
            accepted={selFixture.accepted}
            onToggle={() => st().updateFixture(selFixture.id, { accepted: !selFixture.accepted })}
            onConfirm={() => st().updateFixture(selFixture.id, { status: 'confirmed' })}
            onRemove={() => st().removeElement('fixture', selFixture.id)}
          />
        </Section>
      )}

      {selInstall && (
        <Section title="Ausgewählter Anschluss" actions={<Badge kind={STATUS_KIND[selInstall.status]}>{STATUS_LABEL[selInstall.status]}</Badge>}>
          {selInstall.note && <p className="muted small">{selInstall.note}</p>}
          <p className="muted small">Wird an der nächsten Wand in den Installationsplan übernommen.</p>
          <SelectField
            label="Art"
            value={selInstall.kind}
            options={FIXTURE_KINDS.map((value) => ({ value, label: FIXTURE_LABEL[value] }))}
            onChange={(kind: FixtureKind) => st().updateInstallation(selInstall.id, { kind })}
          />
          <div className="field-grid">
            <NumberField label="Mitte X" value={selInstall.center.x} factor={100} unit="cm" onChange={(v) => st().updateInstallation(selInstall.id, { center: { ...selInstall.center, x: v } })} />
            <NumberField label="Mitte Y" value={selInstall.center.y} factor={100} unit="cm" onChange={(v) => st().updateInstallation(selInstall.id, { center: { ...selInstall.center, y: v } })} />
            <NumberField label="Höhe" value={selInstall.elevation} factor={100} unit="cm" min={0} max={300} onChange={(v) => st().updateInstallation(selInstall.id, { elevation: v })} />
          </div>
          <ElementActions
            accepted={selInstall.accepted}
            onToggle={() => st().updateInstallation(selInstall.id, { accepted: !selInstall.accepted })}
            onConfirm={() => st().updateInstallation(selInstall.id, { status: 'confirmed' })}
            onRemove={() => st().removeElement('installation', selInstall.id)}
          />
        </Section>
      )}

      <Section title="Elemente">
        <ul className="draft-list">
          {draft.walls.map((w, i) => (
            <DraftRow key={w.id} label={`Wand ${i + 1} · ${formatLength(dist(w.a, w.b))} · ${Math.round(w.thickness * 100)} cm`} status={w.status} accepted={w.accepted} active={sel?.id === w.id}
              onSelect={() => st().select({ type: 'wall', id: w.id })} onToggle={() => st().updateWall(w.id, { accepted: !w.accepted })} />
          ))}
          {draft.openings.map((o, i) => (
            <DraftRow key={o.id} label={`${openingLabel(o)} ${i + 1} · ${Math.round(o.width * 100)} cm`} status={o.status} accepted={o.accepted} active={sel?.id === o.id}
              onSelect={() => st().select({ type: 'opening', id: o.id })} onToggle={() => st().updateOpening(o.id, { accepted: !o.accepted })} />
          ))}
          {draft.rooms.map((r) => (
            <DraftRow key={r.id} label={`Raum „${r.name}“${r.area !== undefined ? ` · ${formatArea(r.area)}` : ''}`} status={r.status} accepted={r.accepted} active={sel?.id === r.id}
              onSelect={() => st().select({ type: 'room', id: r.id })} onToggle={() => st().updateRoom(r.id, { accepted: !r.accepted })} />
          ))}
          {(draft.fixtures ?? []).map((x) => (
            <DraftRow key={x.id} label={`${x.name} (Bestand) · ${Math.round(x.width * 100)} × ${Math.round(x.depth * 100)} cm`} status={x.status} accepted={x.accepted} active={sel?.id === x.id}
              onSelect={() => st().select({ type: 'fixture', id: x.id })} onToggle={() => st().updateFixture(x.id, { accepted: !x.accepted })} />
          ))}
          {(draft.installations ?? []).map((x) => (
            <DraftRow key={x.id} label={`${FIXTURE_LABEL[x.kind]}${x.fixtureNote ? ` (${x.fixtureNote})` : ''} · ${Math.round(x.elevation * 100)} cm hoch`} status={x.status} accepted={x.accepted} active={sel?.id === x.id}
              onSelect={() => st().select({ type: 'installation', id: x.id })} onToggle={() => st().updateInstallation(x.id, { accepted: !x.accepted })} />
          ))}
        </ul>
        {draft.source !== 'json' && (
          <button className="block" onClick={() => refreshDraftRooms()} title="Nach dem Entfernen, Abwählen oder Verschieben von Wänden: Räume aus den ausgewählten Wänden neu ermitteln">
            Räume neu vorschlagen
          </button>
        )}
      </Section>
    </div>
  );
}

function DraftRow({ label, status, accepted, active, onSelect, onToggle }: { label: string; status: DraftStatus; accepted: boolean; active: boolean; onSelect: () => void; onToggle: () => void }) {
  return (
    <li className={active ? 'active' : ''}>
      <input type="checkbox" checked={accepted} onChange={onToggle} aria-label="übernehmen" />
      <button className="link-btn" onClick={onSelect}>
        <span className={`lg lg-${status}`} /> {label}
      </button>
    </li>
  );
}

function ElementActions({ accepted, onToggle, onConfirm, onRemove }: { accepted: boolean; onToggle: () => void; onConfirm: () => void; onRemove: () => void }) {
  return (
    <div className="btn-row">
      <button onClick={onToggle}>{accepted ? 'Nicht übernehmen' : 'Übernehmen'}</button>
      <button onClick={onConfirm}>Als bestätigt markieren</button>
      <button className="danger" onClick={onRemove}>
        Entfernen
      </button>
    </div>
  );
}
