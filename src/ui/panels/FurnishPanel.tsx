import { useMemo, useState } from 'react';
import { derivePlan } from '../../model/derived';
import type { Room } from '../../model/schema';
import { formatEuro } from '../../model/units';
import { useProjectStore } from '../../store/projectStore';
import { useUiStore } from '../../store/uiStore';
import {
  applyFurnishing,
  guessRoomType,
  roomIdAt,
  ROOM_TYPES,
  suggestFurnishing,
  suggestionTotal,
  WISH_CATALOG,
  wishesForRoom,
  type RoomType,
  type WishItem,
} from '../../suggest/furnishing';
import { useFurnishStore } from '../../suggest/furnishStore';
import { AssistantPanel } from '../../assistant/AssistantPanel';
import { useAssistantStore } from '../../assistant/assistantStore';
import { useCatalogStore } from '../../catalog/catalogStore';
import type { CatalogItem } from '../../catalog/types';
import { Badge, Section, SelectField } from '../fields';

const ALL = '__all';

/** „2× Nachttisch, Doppelbett 160×200“ */
function countNames(names: string[]): string {
  const m = new Map<string, number>();
  for (const n of names) m.set(n, (m.get(n) ?? 0) + 1);
  return [...m].map(([n, k]) => (k > 1 ? `${k}× ${n}` : n)).join(', ');
}

/**
 * Furnishing suggestion (#137): room type + wish list per room, for one room or the whole
 * apartment. „Vorschlag erstellen“ shows a preview in 2D and 3D; „Übernehmen“ adds the items
 * as normal furniture in one undo step, „Verwerfen“ drops the preview.
 */
export function FurnishPanel() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const selection = useUiStore((s) => s.selection);
  const derived = useMemo(() => derivePlan(project), [project]);
  const { roomTypes, wishes, preview, setRoomType, setWishes, setPreview } = useFurnishStore();
  const extraCatalog = useCatalogStore((s) => s.items);
  const [choice, setChoice] = useState<string | null>(null);
  // a preview built from a Claude suggestion (#151) is shown and taken over in the Claude panel
  const fromAssistant = useAssistantStore((s) => s.preview) === preview && preview !== null;
  // generic catalogue plus the user's own imported products (built-in kitchen modules → kitchen planner)
  const offer = useMemo(() => [...WISH_CATALOG, ...extraCatalog.filter((c) => !c.kitchen)], [extraCatalog]);

  const selectedRoom = useMemo(() => {
    if (selection?.type === 'room') return selection.id;
    const f = selection?.type === 'furniture' ? project.furniture.find((x) => x.id === selection.id) : undefined;
    return f ? roomIdAt(project, derived, f) : null;
  }, [selection, project, derived]);
  const rooms = project.rooms;
  const scope = choice && (choice === ALL || rooms.some((r) => r.id === choice)) ? choice : (selectedRoom ?? rooms[0]?.id ?? ALL);
  const targets = scope === ALL ? rooms : rooms.filter((r) => r.id === scope);

  const typeOf = (r: Room): RoomType => roomTypes[r.id] ?? guessRoomType(r.name);
  const wishesOf = (r: Room): WishItem[] => wishes[r.id] ?? wishesForRoom(project, derived, r.id, typeOf(r));
  const wanted = targets.reduce((n, r) => n + wishesOf(r).reduce((k, w) => k + w.quantity, 0), 0);

  const create = () => {
    const s = suggestFurnishing(
      project,
      targets.map((r) => ({ roomId: r.id, type: typeOf(r), wishes: wishesOf(r).filter((w) => w.quantity > 0) })),
      extraCatalog,
    );
    setPreview(s);
    if (!s.items.length) useUiStore.getState().toast('Für die Wunschliste wurde kein freier Platz gefunden.', 'info');
  };

  const take = () => {
    if (!preview) return;
    let ids: string[] = [];
    apply((d) => {
      ids = applyFurnishing(d, preview);
    });
    useUiStore.getState().selectFurniture(ids);
    useUiStore.getState().toast(`${ids.length} Möbel aus dem Vorschlag übernommen – mit Strg+Z in einem Schritt rückgängig.`, 'success');
  };

  return (
    <div className="panel-scroll furnish-panel">
      <AssistantPanel />
      <Section title="Einrichtungsvorschlag">
        <p className="muted small">
          Raumtyp und Wunschliste wählen, dann „Vorschlag erstellen“. Der Vorschlag stellt die Möbel regelbasiert ohne Kollisionen auf (z. B. Bett an die längste freie Wand, Stühle um den Tisch) und
          hält Türen und Fenster frei. Vorhandene Möbel bleiben stehen. Es ist ein Vorschlag, keine fertige Planung.
        </p>
        {rooms.length === 0 ? (
          <p className="warning small">Bitte zuerst Räume anlegen (Werkzeuge › Raum).</p>
        ) : (
          <>
            <SelectField
              label="Umfang"
              value={scope}
              options={[...rooms.map((r) => ({ value: r.id, label: r.name || 'Raum ohne Namen' })), { value: ALL, label: 'Ganze Wohnung (alle Räume)' }]}
              onChange={(v) => setChoice(v)}
            />
            {targets.map((r) => (
              <RoomWishes key={r.id} room={r} offer={offer} type={typeOf(r)} wishes={wishesOf(r)} onType={(t) => setRoomType(r.id, t)} onWishes={(w) => setWishes(r.id, w)} />
            ))}
            <button className="primary block" disabled={wanted === 0} onClick={create}>
              {preview ? 'Vorschlag neu erstellen' : 'Vorschlag erstellen'}
            </button>
          </>
        )}
      </Section>
      {preview && !fromAssistant && (
        <Section title="Vorschlag" actions={<Badge kind="info">noch nicht übernommen</Badge>}>
          <div className="furnish-result" data-testid="furnish-result">
            {preview.rooms.map((r) => (
              <div key={r.roomId} className="furnish-result-room">
                <strong>{r.roomName || 'Raum'}</strong>
                <p className="small">{r.placed.length ? countNames(r.placed.map((f) => f.name)) : 'Nichts platziert.'}</p>
                {r.missing.length > 0 && <p className="warning small">Kein freier Platz für: {countNames(r.missing)}</p>}
              </div>
            ))}
            <p className="small">
              {preview.items.length} Möbel · Richtwert ca. <strong>{formatEuro(suggestionTotal(preview))}</strong> (Schätzpreise des allgemeinen Katalogs)
            </p>
          </div>
          <div className="btn-row">
            <button className="primary" disabled={!preview.items.length} onClick={take}>
              Übernehmen
            </button>
            <button onClick={() => setPreview(null)}>Verwerfen</button>
          </div>
        </Section>
      )}
    </div>
  );
}

function RoomWishes({ room, offer, type, wishes, onType, onWishes }: { room: Room; offer: CatalogItem[]; type: RoomType; wishes: WishItem[]; onType: (t: RoomType) => void; onWishes: (w: WishItem[] | null) => void }) {
  const setQty = (i: number, q: number) => onWishes(wishes.map((w, k) => (k === i ? { ...w, quantity: Math.max(0, Math.min(12, Math.round(q) || 0)) } : w)));
  return (
    <div className="furnish-room" data-testid="furnish-room" data-room={room.name}>
      <h4>{room.name || 'Raum ohne Namen'}</h4>
      <SelectField label="Raumtyp" value={type} options={ROOM_TYPES.map((t) => ({ value: t.id, label: t.label }))} onChange={onType} />
      {wishes.length === 0 && <p className="muted small">Keine Möbel gewünscht – unten hinzufügen.</p>}
      <ul className="wish-list">
        {wishes.map((w, i) => {
          const item = offer.find((c) => c.id === w.catalogId);
          return (
            <li key={`${w.catalogId}-${i}`} className={w.quantity ? '' : 'muted'}>
              <input className="w-num" type="number" min={0} max={12} value={w.quantity} onChange={(e) => setQty(i, Number(e.target.value))} aria-label={`Anzahl ${item?.name ?? w.catalogId}`} />
              <span>{item?.name ?? w.catalogId}</span>
              <button aria-label={`${item?.name ?? w.catalogId} entfernen`} onClick={() => onWishes(wishes.filter((_, k) => k !== i))}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <div className="field-row">
        <label className="field">
          <span className="field-label">Möbel hinzufügen</span>
          <span className="field-input">
            <select
              value=""
              aria-label="Möbel hinzufügen"
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return;
                const i = wishes.findIndex((w) => w.catalogId === id);
                onWishes(i >= 0 ? wishes.map((w, k) => (k === i ? { ...w, quantity: w.quantity + 1 } : w)) : [...wishes, { catalogId: id, quantity: 1 }]);
              }}
            >
              <option value="">Auswählen…</option>
              {offer.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </span>
        </label>
      </div>
      <button className="small" onClick={() => onWishes(null)} title="Wunschliste auf die typische Einrichtung des Raumtyps zurücksetzen">
        Standardliste
      </button>
    </div>
  );
}
