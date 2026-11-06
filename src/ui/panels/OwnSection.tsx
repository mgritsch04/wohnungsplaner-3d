import { useMemo } from 'react';
import { useCatalogStore } from '../../catalog/catalogStore';
import { confirmDialog, useDialogStore } from '../dialogStore';
import { Badge } from '../fields';
import { CatalogRow } from './CatalogRow';
import s from './IkeaSection.module.css';

/** Catalog › Eigene (#493): own objects that are not from IKEA or Möbelix – bike, desk of another maker, posters, designer chairs. */
export function OwnSection() {
  const all = useCatalogStore((st) => st.items);
  const items = useMemo(() => all.filter((i) => i.source === 'own'), [all]);
  const open = (data?: { itemId?: string; shape?: string }) => useDialogStore.getState().openModal('own', data ?? null);
  return (
    <>
      <p className={s.empty}>
        Hier legst du Dinge an, die es nicht bei IKEA oder Möbelix gibt: dein Fahrrad, einen Schreibtisch oder Stuhl eines anderen Herstellers, ein Poster. Sie lassen sich platzieren wie jedes Möbel; der Einrichtungsvorschlag plant darum herum.
      </p>
      <div className="catalog-footer">
        <button className="block primary" onClick={() => open()} data-testid="own-new">
          + Neues eigenes Objekt anlegen …
        </button>
        <div className="chips" aria-label="Schnellstart mit typischen Maßen">
          {['bike', 'desk', 'office-chair', 'picture'].map((shape) => {
            return (
              <button key={shape} className="chip" onClick={() => open({ shape })} title="Mit typischen Maßen beginnen – die Maße bitte am echten Stück nachmessen">
                {shape === 'bike' ? 'Fahrrad' : shape === 'desk' ? 'Schreibtisch' : shape === 'office-chair' ? 'Bürostuhl' : 'Poster'}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="catalog-list" data-testid="own-list">
        {items.map((i) => (
          <li key={i.id} className="own-row">
            <CatalogRow item={i} />
            <div className="own-row-actions">
              {i.fixed && <Badge kind="info" title="Der Einrichtungsvorschlag plant darum herum und verschiebt es nicht">feste Vorgabe</Badge>}
              {i.owned && <Badge kind="muted" title="Zählt nicht zum Budget">habe ich</Badge>}
              <button className="link-btn" onClick={() => open({ itemId: i.id })}>
                Bearbeiten
              </button>
              <button
                className="link-btn danger"
                onClick={async () => {
                  if (await confirmDialog(`„${i.name}“ aus den eigenen Objekten entfernen? Bereits platzierte Stücke im Plan bleiben.`, { confirmLabel: 'Entfernen', danger: true })) await useCatalogStore.getState().removeItem(i.id);
                }}
              >
                Entfernen
              </button>
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="empty">Noch keine eigenen Objekte.</li>}
      </ul>
    </>
  );
}
