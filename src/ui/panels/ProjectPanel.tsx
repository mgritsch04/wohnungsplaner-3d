import { useMemo } from 'react';
import { validateModel } from '../../model/validation';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { CheckField, NumberField, Section, Badge } from '../fields';
import { WalkFovControl } from '../WalkFovControl';
import { BODY_HEIGHT_MAX, BODY_HEIGHT_MIN, eyeFromBody, seatedEyeFromBody } from '../../model/body';
import { windowFov } from '../../view3d/walkZoom';
import { usePerformanceStore } from '../../view3d/performanceStore';
import type { Material } from '../../model/schema';
import { newId } from '../../model/ids';
import { TimeOfDayControl } from '../TimeOfDayControl';
import { MouseSensitivityControl } from '../MouseSensitivityControl';
import { ThemeControl } from '../ThemeControl';
import { DaylightSection } from './DaylightSection';
import { LuxSection } from './LuxSection';
import { HeatingSection } from './HeatingSection';
import { CircuitsSection } from '../../installation/CircuitsSection';
import { MovePlanSection } from '../../planning/MovePlanSection';
import { MoveChecklistSection } from '../../planning/TaskSections';
import { MotionControl } from '../MotionControl';
import { HintsControl } from '../HintsControl';
import { AimHintControl } from '../AimHintControl';
import { InfoHint } from '../InfoHint';
import { LevelsSection } from '../LevelBar';
import { useSightStore } from '../../editor2d/sightStore';
import { exportPlanPng } from '../../export/exportPng';
import { openPrintView } from '../../export/PrintView';

export function ProjectPanel() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const issues = useMemo(() => validateModel(project), [project]);
  const fps = useUiStore((s) => s.fps);
  const walkSit = useUiStore((s) => s.walkSit);
  const dprCap = usePerformanceStore((s) => s.dprCap);
  const s = project.settings;

  return (
    <div className="panel-scroll">
      <Section title="Oberfläche">
        <ThemeControl />
        <MotionControl />
        <HintsControl />
      </Section>

      <LevelsSection />

      <Section title="Licht & Darstellung (3D)">
        <div className="field">
          <span className="field-label">
            Tageszeit (wirkt im Realismusmodus) <InfoHint id="timeOfDay" />
          </span>
          <TimeOfDayControl />
        </div>
        <label className="field">
          <span className="field-label">
            Belichtung {s.exposure.toFixed(2)} <InfoHint id="exposure" />
          </span>
          <input
            type="range"
            min={0.3}
            max={2.5}
            step={0.05}
            value={s.exposure}
            onChange={(e) =>
              apply((d) => {
                d.settings.exposure = Number(e.target.value);
              })
            }
          />
        </label>
        <CheckField
          label="Decken anzeigen"
          checked={s.showCeilings}
          onChange={(v) =>
            apply((d) => {
              d.settings.showCeilings = v;
            })
          }
          title="Decken sind nur von unten sichtbar (z. B. beim Begehen)"
        />
      </Section>

      <DaylightSection />
      <LuxSection />
      <HeatingSection />

      <CircuitsSection />
      <MoveChecklistSection project={project} />
      <MovePlanSection project={project} />

      <SightlineSection />

      <Section title="Steuerung (3D)">
        <MouseSensitivityControl />
        <NumberField
          label="Körpergröße"
          value={s.bodyHeight}
          factor={100}
          digits={0}
          unit="cm"
          min={110}
          max={230}
          step={1}
          title="Deine Körpergröße: daraus ergibt sich die Augenhöhe beim Begehen (11 cm darunter) und im Sitzen (Standard 163 cm)"
          onChange={(v) => apply((d) => void (d.settings.bodyHeight = Math.max(BODY_HEIGHT_MIN, Math.min(BODY_HEIGHT_MAX, v))))}
        />
        <p className="muted small" data-testid="eye-heights">
          Augenhöhe beim Begehen {Math.round(eyeFromBody(s.bodyHeight) * 100)} cm, im Sitzen {Math.round(seatedEyeFromBody(s.bodyHeight) * 100)} cm
        </p>
        <WalkFovControl />
        <CheckField
          label="Gefühlt echt beim Begehen"
          checked={s.walkTrueScale}
          onChange={(v) => apply((d) => void (d.settings.walkTrueScale = v))}
          title="Natürliches Sichtfeld (62°) mit Maßstabshinweisen: Entfernung und Höhe am Fadenkreuz, Durchgangshöhe an Türen. Aus: Sichtfeld vom Regler"
        />
        <AimHintControl />
        <NumberField
          label="Bildschirmdiagonale"
          value={s.screenDiagonal}
          digits={1}
          unit="Zoll"
          min={10}
          max={100}
          step={0.5}
          title="Diagonale deines Bildschirms (Standard 27 Zoll) – für den Hinweis, wie eng das Bild in Echtgröße wäre"
          onChange={(v) => apply((d) => void (d.settings.screenDiagonal = Math.max(10, Math.min(100, v))))}
        />
        <NumberField
          label="Sitzabstand zum Bildschirm"
          value={s.viewingDistance}
          factor={100}
          digits={0}
          unit="cm"
          min={30}
          max={300}
          step={5}
          title="Abstand deiner Augen zum Bildschirm (Standard 60 cm) – für den Hinweis, wie eng das Bild in Echtgröße wäre"
          onChange={(v) => apply((d) => void (d.settings.viewingDistance = Math.max(0.3, Math.min(3, v))))}
        />
        <p className="muted small" data-testid="window-fov">
          In Echtgröße zeigt dein Bildschirm nur {Math.round(windowFov(s.screenDiagonal, s.viewingDistance, window.screen?.width || 16, window.screen?.height || 9))}° (bildschirmhoch) – wie durch ein Fenster. Deshalb nutzt „Gefühlt echt“ ein weiteres Sichtfeld und zeigt Maße an.
        </p>
        <CheckField
          label="Kopfwippen beim Gehen"
          checked={s.walkHeadBob}
          onChange={(v) => apply((d) => void (d.settings.walkHeadBob = v))}
          title="Die Augen senken sich bei jedem Schritt ein wenig – hilft dem Tiefengefühl"
        />
        <CheckField
          label="Referenzfigur in deiner Größe (Taste P)"
          checked={s.showRefFigure}
          onChange={(v) => apply((d) => void (d.settings.showRefFigure = v))}
          title="Eine Figur in deiner Körpergröße als Maßstab; beim Begehen stellt Taste P sie dorthin, wo das Fadenkreuz den Boden trifft"
        />
        <CheckField label="Beim Begehen sitzen (Taste X)" checked={walkSit} onChange={(v) => useUiStore.getState().setWalkSit(v)} title="Umschalten zwischen Stehen und Sitzen – wirkt sofort beim Begehen" />
      </Section>

      <Section title="Leistung">
        <p className="small">
          Modus: <strong>{s.quality === 'planning' ? 'Planung' : 'Realismus'}</strong> <InfoHint id="realism" />
          {fps !== null && (
            <>
              {' '}
              · <Badge kind={fps >= 45 ? 'ok' : fps >= 25 ? 'warn' : 'error'}>{fps} FPS</Badge>
            </>
          )}
        </p>
        <p className="muted small">Pixel-Verhältnis-Obergrenze: {dprCap.toFixed(2)} (wird bei anhaltend niedriger Bildrate automatisch reduziert).</p>
        <p className="muted small">Planung: keine Schatten, einfache Materialien. Realismus: Texturen, weiche Schatten, Umgebungslicht.</p>
      </Section>

      <Section title="Materialien">
        <ul className="material-list">
          {project.materials.map((m) => (
            <MaterialRow key={m.id} m={m} />
          ))}
        </ul>
        <button
          className="block"
          onClick={() =>
            apply((d) => {
              d.materials.push({ id: newId('mat'), name: 'Eigene Wandfarbe', kind: 'paint', color: '#c9b8a6', roughness: 0.9, metalness: 0, textureScale: 1 });
            })
          }
        >
          + Eigene Farbe
        </button>
      </Section>

      <Section title={`Modellprüfung (${issues.length})`}>
        {issues.length === 0 ? (
          <p className="small">
            <Badge kind="ok">OK</Badge> Keine Probleme gefunden.
          </p>
        ) : (
          <ul className="issues">
            {issues.map((i, k) => (
              <li key={k}>
                <Badge kind={i.severity === 'error' ? 'error' : 'warn'}>{i.severity === 'error' ? 'Fehler' : 'Hinweis'}</Badge> {i.message}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Plan exportieren">
        <p className="muted small">Grundriss mit Maßen, Titel, Datum und Maßstabsbalken – ohne Raster und Auswahl.</p>
        <div className="button-row">
          <button onClick={() => void exportPlanPng()}>Plan als PNG</button>
          <button onClick={openPrintView}>Druckansicht / PDF</button>
        </div>
      </Section>
      <Section title="Projekt">
        <p className="muted small">
          ID: {project.id}
          <br />
          Erstellt: {new Date(project.createdAt).toLocaleString('de-AT')}
          <br />
          Geändert: {new Date(project.updatedAt).toLocaleString('de-AT')}
          <br />
          Schema-Version: {project.schemaVersion}
        </p>
        <NumberField label="Wandhöhe Standard" value={s.defaultWallHeight} factor={100} unit="cm" min={50} max={1000} onChange={(v) => apply((d) => void (d.settings.defaultWallHeight = v))} />
      </Section>
    </div>
  );
}

function MaterialRow({ m }: { m: Material }) {
  const apply = useProjectStore((s) => s.apply);
  const upd = (fn: (x: Material) => void) =>
    apply((d) => {
      const x = d.materials.find((q) => q.id === m.id);
      if (x) fn(x);
    });
  return (
    <li>
      <input type="color" value={m.color} onChange={(e) => upd((x) => (x.color = e.target.value))} aria-label={`Farbe ${m.name}`} />
      <input className="material-name" value={m.name} onChange={(e) => upd((x) => (x.name = e.target.value.slice(0, 100)))} aria-label="Materialname" />
      <span className="muted small">{m.kind}</span>
    </li>
  );
}

/** Sight lines (#89): switch, visible share, back to the entrance. */
function SightlineSection() {
  const { show, point, share, setShow, setPoint } = useSightStore();
  return (
    <Section title="Sichtlinien (2D)">
      <CheckField label="Sichtlinien anzeigen" checked={show} onChange={setShow} title="Zeigt im 2D-Plan, was man vom Blickpunkt aus sieht" />
      <p className="muted small">
        Grün: von dort sichtbar, grau: verdeckt. Wände verdecken, offene Türen und Durchgänge nicht, Möbel werden nicht berücksichtigt. Den Blickpunkt im Plan ziehen; Start ist der Eingang.
      </p>
      {show && share !== null && (
        <p className="small" data-testid="sight-share-panel">
          Sichtbar: <strong>{Math.round(share * 100)} %</strong> der Wohnfläche
        </p>
      )}
      {show && point && (
        <button className="link-btn" onClick={() => setPoint(null)}>
          Blickpunkt auf den Eingang zurücksetzen
        </button>
      )}
    </Section>
  );
}
