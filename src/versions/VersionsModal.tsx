import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatArea, formatEuro } from '../model/units';
import type { Project } from '../model/schema';
import { listVersions, loadVersion, type VersionMeta } from '../persistence/versions';
import { useProjectStore } from '../store/projectStore';
import { confirmDialog, useDialogStore } from '../ui/dialogStore';
import { pairRooms, summarizeVariant, type VariantSummary } from './compare';
import { openVersion, removeVersion, saveCurrentVersion } from './versionActions';
import { VERSION_LIMIT, VERSION_NAME_MAX, defaultVersionName } from './versions';
import './versions.css';

const CURRENT = 'current';
const fmtDate = (iso: string) => new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** „Versionen“: save, list, open, delete and compare saved project states (#66, #58). */
export function VersionsModal() {
  const close = useDialogStore((s) => s.closeModal);
  const projectId = useProjectStore((s) => s.project.id);
  const [items, setItems] = useState<VersionMeta[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    listVersions(projectId)
      .then(setItems)
      .catch((e) => {
        console.error('Stände konnten nicht gelesen werden', e);
        setItems([]);
      });
  }, [projectId]);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !useDialogStore.getState().confirmRequest && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const full = (items?.length ?? 0) >= VERSION_LIMIT;

  const save = async () => {
    setBusy(true);
    const meta = await saveCurrentVersion(name || defaultVersionName());
    setBusy(false);
    if (meta) setName('');
    refresh();
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide versions-modal" role="dialog" aria-modal="true" aria-label="Versionen" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>Versionen – gespeicherte Stände</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="muted small">
            Ein Stand hält das ganze Projekt (Grundriss, Möbel, Licht, Materialien) fest. Stände gehören zu diesem Projekt, werden im Browser gespeichert und sind im Projektpaket-Export
            enthalten. Beim Öffnen wird der aktuelle Stand vorher automatisch gesichert.
          </p>
          <form
            className="versions-save"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && !full) void save();
            }}
          >
            <input
              aria-label="Name des Stands"
              placeholder={defaultVersionName()}
              value={name}
              maxLength={VERSION_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="submit" className="primary" disabled={busy || full || items === null}>
              Aktuellen Stand speichern
            </button>
          </form>
          <p className={full ? 'warning small' : 'muted small'} data-testid="versions-count">
            {full
              ? `Obergrenze erreicht: ${VERSION_LIMIT} von ${VERSION_LIMIT} Ständen gespeichert. Bitte ältere Stände löschen, um neue zu speichern oder einen Stand zu öffnen (dabei wird der aktuelle Stand automatisch gesichert).`
              : `${items?.length ?? 0} von höchstens ${VERSION_LIMIT} Ständen gespeichert.`}
          </p>

          {items === null && <p>Lade…</p>}
          {items?.length === 0 && <p className="muted">Noch keine Stände gespeichert.</p>}
          {!!items?.length && (
            <ul className="project-list versions-list">
              {items.map((m) => (
                <li key={m.id} data-testid="version-item">
                  <div>
                    <strong>
                      {m.name} {m.auto && <span className="version-badge">automatisch</span>}
                    </strong>
                    <span className="muted small">
                      {fmtDate(m.createdAt)} · {m.items} Objekte
                    </span>
                  </div>
                  <div className="btn-row">
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        const res = await openVersion(m);
                        setBusy(false);
                        if (res) close();
                        else refresh();
                      }}
                    >
                      Öffnen
                    </button>
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={async () => {
                        if (await confirmDialog(`Stand „${m.name}“ endgültig löschen?`, { title: 'Stand löschen', confirmLabel: 'Löschen', danger: true })) {
                          await removeVersion(m);
                          refresh();
                        }
                      }}
                    >
                      Löschen
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {!!items?.length && <CompareSection items={items} />}
        </div>
      </div>
    </div>
  );
}

function useVariant(id: string, current: Project): { summary: VariantSummary | null; error: string | null } {
  const [loaded, setLoaded] = useState<{ id: string; summary: VariantSummary | null; error: string | null }>({ id: '', summary: null, error: null });
  const currentSummary = useMemo(() => (id === CURRENT ? summarizeVariant(current) : null), [id, current]);
  useEffect(() => {
    if (id === CURRENT) return;
    let cancelled = false;
    loadVersion(id)
      .then((p) => !cancelled && setLoaded({ id, summary: p ? summarizeVariant(p) : null, error: p ? null : 'Stand nicht gefunden' }))
      .catch((e) => !cancelled && setLoaded({ id, summary: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (id === CURRENT) return { summary: currentSummary, error: null };
  return loaded.id === id ? loaded : { summary: null, error: null };
}

function CompareSection({ items }: { items: VersionMeta[] }) {
  const current = useProjectStore((s) => s.txBase ?? s.project);
  const [aId, setA] = useState<string>(items[0]?.id ?? CURRENT);
  const [bId, setB] = useState<string>(CURRENT);
  const validA = aId === CURRENT || items.some((m) => m.id === aId) ? aId : CURRENT;
  const validB = bId === CURRENT || items.some((m) => m.id === bId) ? bId : CURRENT;
  const a = useVariant(validA, current);
  const b = useVariant(validB, current);
  const label = (id: string) => (id === CURRENT ? 'Aktueller Stand' : (items.find((m) => m.id === id)?.name ?? '?'));

  const options = (
    <>
      <option value={CURRENT}>Aktueller Stand</option>
      {items.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} ({fmtDate(m.createdAt)})
        </option>
      ))}
    </>
  );

  return (
    <section className="versions-compare" aria-label="Stände vergleichen">
      <h3>Zwei Stände vergleichen</h3>
      <div className="versions-pick">
        <label>
          Stand A
          <select aria-label="Stand A" value={validA} onChange={(e) => setA(e.target.value)}>
            {options}
          </select>
        </label>
        <label>
          Stand B
          <select aria-label="Stand B" value={validB} onChange={(e) => setB(e.target.value)}>
            {options}
          </select>
        </label>
      </div>
      {(a.error || b.error) && <p className="warning small">Stand konnte nicht gelesen werden: {a.error ?? b.error}</p>}
      {a.summary && b.summary ? (
        <CompareTable a={a.summary} b={b.summary} labelA={label(validA)} labelB={label(validB)} />
      ) : (
        !(a.error || b.error) && <p className="muted small">Berechne…</p>
      )}
      <p className="muted small">
        Preise: Summe der bekannten Preise wie in der Budgetliste. Belegt: Grundfläche der am Boden stehenden Möbel (ohne Teppiche), Überlappungen einfach gezählt; frei = Bodenfläche − belegt.
      </p>
    </section>
  );
}

type Fmt = (n: number) => string;
const fmtCount: Fmt = (n) => n.toLocaleString('de-AT');
const signed = (fmt: Fmt, d: number) => (Math.abs(d) < 0.005 ? '±0' : `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))}`);

function Row({ label, a, b, fmt, sub }: { label: string; a: number | null; b: number | null; fmt: Fmt; sub?: boolean }) {
  return (
    <tr className={sub ? 'sub' : undefined}>
      <th scope="row">{label}</th>
      <td>{a === null ? '–' : fmt(a)}</td>
      <td>{b === null ? '–' : fmt(b)}</td>
      <td className="diff">{a === null || b === null ? '–' : signed(fmt, b - a)}</td>
    </tr>
  );
}

function CompareTable({ a, b, labelA, labelB }: { a: VariantSummary; b: VariantSummary; labelA: string; labelB: string }) {
  const rooms = pairRooms(a, b);
  return (
    <table className="versions-table" data-testid="versions-compare-table">
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">A: {labelA}</th>
          <th scope="col">B: {labelB}</th>
          <th scope="col">B − A</th>
        </tr>
      </thead>
      <tbody>
        <Row label="Gesamtpreis (bekannte Preise)" a={a.totalPrice} b={b.totalPrice} fmt={formatEuro} />
        {(a.missingPrices > 0 || b.missingPrices > 0) && <Row label="Positionen ohne Preis" a={a.missingPrices} b={b.missingPrices} fmt={fmtCount} sub />}
        <Row label="Anzahl Möbel (Stück)" a={a.pieces} b={b.pieces} fmt={fmtCount} />
        <Row label="Bodenfläche gesamt" a={a.area} b={b.area} fmt={formatArea} />
        <Row label="belegt" a={a.occupied} b={b.occupied} fmt={formatArea} sub />
        <Row label="frei" a={a.free} b={b.free} fmt={formatArea} sub />
        {rooms.map((r, i) => (
          <RoomRows key={`${r.name}-${i}`} name={r.name} a={r.a} b={r.b} />
        ))}
      </tbody>
    </table>
  );
}

function RoomRows({ name, a, b }: { name: string; a: VariantSummary['rooms'][number] | null; b: VariantSummary['rooms'][number] | null }) {
  return (
    <>
      <tr className="room-head">
        <th scope="row" colSpan={4}>
          {name || 'Raum ohne Namen'}
          {a && b ? '' : a ? ' (nur in A)' : ' (nur in B)'}
        </th>
      </tr>
      <Row label="belegt" a={a?.occupied ?? null} b={b?.occupied ?? null} fmt={formatArea} sub />
      <Row label="frei" a={a?.free ?? null} b={b?.free ?? null} fmt={formatArea} sub />
    </>
  );
}
