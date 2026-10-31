import { useMemo, useState } from 'react';
import { useCatalogStore } from '../../catalog/catalogStore';
import { mergeDuplicateGroup } from '../../catalog/duplicateActions';
import { findDuplicateGroups, previewMerge, REASON_LABEL, type DuplicateGroup } from '../../catalog/duplicates';
import { formatEuro } from '../../model/units';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import s from './IkeaSection.module.css';

/** Katalog › Doppelte: imported products that appear more than once, merged with a preview first. */
export function DuplicatesSection() {
  const items = useCatalogStore((st) => st.items);
  const project = useProjectStore((st) => st.project);
  const groups = useMemo(() => findDuplicateGroups(items, project), [items, project]);
  return (
    <div className={s.section} data-testid="duplicates-section">
      {groups.length === 0 ? (
        <p className={s.empty}>Keine doppelten importierten Möbel gefunden.</p>
      ) : (
        <>
          <p className="muted small">
            {groups.length} Gruppe(n) mit gleichen Produkten. Pro Gruppe das Möbel wählen, das bleibt – die anderen werden entfernt, ihre Platzierungen im Plan wandern zum
            behaltenen. Nichts Verwendetes geht verloren, die Maße, Optik und Preise bereits platzierter Möbel bleiben.
          </p>
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </>
      )}
    </div>
  );
}

function GroupCard({ group }: { group: DuplicateGroup }) {
  const [keepId, setKeepId] = useState(group.keepId);
  const [confirm, setConfirm] = useState(false);
  const project = useProjectStore((st) => st.project);
  const effective = group.members.some((m) => m.item.id === keepId) ? keepId : group.keepId;
  const preview = previewMerge(group, effective, project);

  const run = async () => {
    const moved = await mergeDuplicateGroup(group, effective);
    useUiStore.getState().toast(`„${preview.keep.name}“ behalten, ${preview.remove.length} doppelte(s) entfernt${moved ? `, ${moved} Platzierung(en) umgehängt` : ''}.`, 'success');
  };

  return (
    <div className={s.dupGroup} data-testid="duplicate-group">
      <strong>{group.members[0].item.name}</strong>
      <span className="muted small">{REASON_LABEL[group.reason]}</span>
      {group.members.map((m) => (
        <label key={m.item.id} className={s.dupMember}>
          <input type="radio" name={`keep-${group.id}`} checked={m.item.id === effective} onChange={() => { setKeepId(m.item.id); setConfirm(false); }} aria-label={`Behalten: ${m.item.name}`} />
          <span>
            {m.item.name} · {Math.round(m.item.width * 100)}×{Math.round(m.item.depth * 100)}×{Math.round(m.item.height * 100)} cm
            {m.item.price ? ` · ${formatEuro(m.item.price.amount)}` : ''}
            {m.item.model.type === 'gltf' ? ' · 3D-Modell' : ''}
            {m.item.retailer ? ` · ${m.item.retailer}` : ''}
            {m.used ? ` · ${m.used}× im Plan` : ' · nicht verwendet'}
          </span>
        </label>
      ))}
      {!confirm ? (
        <button onClick={() => setConfirm(true)}>Zusammenführen…</button>
      ) : (
        <>
          <p className={s.dupPreview} data-testid="merge-preview">
            Behalten: <strong>{preview.keep.name}</strong>. Entfernt: {preview.remove.map((r) => r.name).join(', ')}.{' '}
            {preview.rehomed ? `${preview.rehomed} Platzierung(en) im Plan werden zum behaltenen Möbel umgehängt.` : 'Keines davon ist im Plan verwendet.'}
            {preview.filled.length ? ` Übernommen: ${preview.filled.join(', ')}.` : ''}
          </p>
          <div className={s.actions}>
            <button className="primary" onClick={() => void run()}>
              Jetzt zusammenführen
            </button>
            <button onClick={() => setConfirm(false)}>Abbrechen</button>
          </div>
        </>
      )}
    </div>
  );
}
