import { useMemo } from 'react';
import { derivePlan } from '../../model/derived';
import { MARK_KINDS, markLabels, marksByRoom, markKindInfo } from '../../model/marks';
import type { Mark } from '../../model/schema';
import { openHandoverView } from '../../export/HandoverView';
import { useAssetUrl } from '../../persistence/useAssetUrl';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import { Section } from '../fields';
import { pickMarkPhoto } from '../markPhoto';

/** Mieter-Paket (#362): Markierungen für Übergabeprotokoll und Bohrloch-Plan. */
export function MarksSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const markKind = useUiStore((s) => s.markKind);
  const setMarkKind = useUiStore((s) => s.setMarkKind);
  const derived = useMemo(() => derivePlan(project), [project]);
  const labels = markLabels(project.marks);
  const groups = useMemo(() => marksByRoom(project, derived), [project, derived]);

  const update = (id: string, fn: (m: Mark) => void) =>
    apply((d) => {
      const m = d.marks.find((x) => x.id === id);
      if (m) fn(m);
    });

  return (
    <Section title="Mieter-Paket">
      <p className="muted small">Zustand beim Einzug, Bohrlöcher und Klebestellen im Plan markieren – mit Notiz und lokalem Foto. Daraus entsteht das Übergabeprotokoll (PDF).</p>
      <div className="segmented" role="group" aria-label="Art der Markierung" data-testid="mark-kind">
        {MARK_KINDS.map((k) => (
          <button key={k.id} className={markKind === k.id ? 'active' : ''} aria-pressed={markKind === k.id} onClick={() => setMarkKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="button-row">
        <button className={tool === 'mark' ? 'primary' : ''} onClick={() => setTool('mark')} data-testid="mark-tool">
          Markierung setzen
        </button>
        <button onClick={openHandoverView} data-testid="open-handover">
          Übergabeprotokoll…
        </button>
      </div>
      {project.marks.length === 0 && <p className="muted small">Noch keine Markierungen.</p>}
      {groups.map((g) => (
        <div key={g.room} className="mark-room" data-testid="mark-room">
          <div className="menu-heading">{g.room}</div>
          {g.marks.map((m) => (
            <MarkRow key={m.id} mark={m} label={labels.get(m.id)!} update={update} remove={() => apply((d) => void (d.marks = d.marks.filter((x) => x.id !== m.id)))} />
          ))}
        </div>
      ))}
    </Section>
  );
}

function MarkRow({ mark, label, update, remove }: { mark: Mark; label: string; update: (id: string, fn: (m: Mark) => void) => void; remove: () => void }) {
  const { url } = useAssetUrl(mark.photoAssetId);
  const info = markKindInfo(mark.kind);
  return (
    <div className="mark-row" data-testid="mark-row">
      <div className="field-row">
        <strong style={{ color: info.color }}>{label}</strong>
        <select aria-label="Art" value={mark.kind} onChange={(e) => update(mark.id, (m) => void (m.kind = e.target.value as Mark['kind']))}>
          {MARK_KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label}
            </option>
          ))}
        </select>
        <button onClick={remove} aria-label={`${label} entfernen`} title="Markierung entfernen">
          ✕
        </button>
      </div>
      <textarea
        aria-label={`Notiz ${label}`}
        rows={2}
        maxLength={500}
        placeholder={mark.kind === 'condition' ? 'Zustand, z. B. Kratzer im Parkett' : 'z. B. 6 mm Bohrloch, Dübel entfernt'}
        value={mark.note}
        onChange={(e) => update(mark.id, (m) => void (m.note = e.target.value))}
      />
      <div className="button-row">
        <button
          onClick={async () => {
            const id = await pickMarkPhoto();
            if (id) update(mark.id, (m) => void (m.photoAssetId = id));
          }}
        >
          {mark.photoAssetId ? 'Foto ersetzen' : 'Foto anhängen'}
        </button>
        {mark.photoAssetId && <button onClick={() => update(mark.id, (m) => void (m.photoAssetId = undefined))}>Foto entfernen</button>}
      </div>
      {url && <img src={url} alt={`Foto ${label}`} style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 4 }} />}
    </div>
  );
}
