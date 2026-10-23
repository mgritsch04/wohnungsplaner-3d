import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useProjectStore } from '../store/projectStore';
import { buildingSpans, fitCheck, formatCm, formatMeters, type FitResult, type FreeSpan } from './shopMode';
import { loadChecked, progress, saveChecked, shoppingGroups } from './shopList';
import './shop.css';

type Tab = 'spans' | 'fit' | 'list';
const TABS: [Tab, string][] = [
  ['spans', 'Maße'],
  ['fit', 'Passt es?'],
  ['list', 'Liste'],
];

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}

/**
 * Laden-Modus (#361): kompakte Vollbild-Ansicht für unterwegs im Möbelhaus – freie Wandlängen und
 * Nischen je Raum, „passt B × T × H hier hin?“ und die Einkaufsliste mit Haken. Keine Tastatur,
 * kein Plan, nur Maße.
 */
export function ShopMode({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('spans');
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  return (
    <div className="shop-mode" role="dialog" aria-modal="true" aria-label="Laden-Modus" data-testid="shop-mode">
      <header className="shop-head">
        <h2>Laden-Modus</h2>
        {!online && <span className="shop-offline">Offline</span>}
        <button type="button" className="shop-close" onClick={onClose}>
          Zum Plan
        </button>
      </header>
      <nav className="shop-tabs" aria-label="Laden-Modus">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="shop-body">
        {tab === 'spans' && <SpansTab />}
        {tab === 'fit' && <FitTab />}
        {tab === 'list' && <ListTab />}
      </div>
    </div>
  );
}

function boundText(s: FreeSpan): string {
  return s.start === 'Ecke' && s.end === 'Ecke' ? 'Ecke bis Ecke' : `${s.start} bis ${s.end}`;
}

function SpansTab() {
  const project = useProjectStore((s) => s.project);
  const rooms = useMemo(() => buildingSpans(project), [project]);
  if (rooms.length === 0) return <p className="shop-empty">Noch keine Räume im Plan.</p>;
  return (
    <>
      {rooms.map((room) => (
        <section key={room.roomId} className="shop-room" aria-label={room.name}>
          <h3>
            {room.name}
            <small>
              {room.area.toFixed(1).replace('.', ',')} m² · Höhe {formatMeters(room.height)}
            </small>
          </h3>
          {room.spans.length === 0 ? (
            <p className="shop-empty">Keine freie Wandstrecke.</p>
          ) : (
            <ul className="shop-spans">
              {room.spans.map((s, i) => (
                <li key={i} data-niche={s.niche}>
                  <strong className="shop-len">{formatMeters(s.length)}</strong>
                  <span className="shop-what">
                    {s.niche ? 'Nische' : 'Wand frei'} · {boundText(s)}
                  </span>
                  <span className="shop-depth">Tiefe bis {s.depth >= 3 ? 'über 3 m' : formatMeters(s.depth)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
      <p className="shop-note">Türflügel, Steckdosen und Heizkörper sind nicht eingerechnet – vor dem Kauf kurz nachmessen.</p>
    </>
  );
}

const parseCm = (v: string): number | null => {
  const n = Number(v.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n / 100 : null;
};

function fitText(r: FitResult): string {
  const along = r.orientation === 'width' ? 'Breite an der Wand' : 'Tiefe an der Wand';
  return `${along} · ${formatCm(r.slackAlong)} cm Luft in der Länge, ${formatCm(r.slackDepth)} cm in der Tiefe`;
}

function FitTab() {
  const project = useProjectStore((s) => s.project);
  const [w, setW] = useState('');
  const [d, setD] = useState('');
  const [h, setH] = useState('');
  const dims = { w: parseCm(w), d: parseCm(d), h: parseCm(h) };
  const ready = dims.w !== null && dims.d !== null && dims.h !== null;
  const answer = useMemo(() => {
    if (dims.w === null || dims.d === null || dims.h === null) return null;
    return fitCheck(buildingSpans(project, dims.h), dims.w, dims.d, dims.h);
  }, [project, dims.w, dims.d, dims.h]);
  const field = (label: string, value: string, set: (v: string) => void, id: string) => (
    <label className="shop-field">
      <span>{label}</span>
      <input id={id} data-testid={id} inputMode="decimal" autoComplete="off" placeholder="cm" value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );
  return (
    <>
      <div className="shop-dims">
        {field('Breite', w, setW, 'shop-w')}
        {field('Tiefe', d, setD, 'shop-d')}
        {field('Höhe', h, setH, 'shop-h')}
      </div>
      {!ready && <p className="shop-empty">Maße in cm eingeben (B × T × H), z. B. 80 × 30 × 180.</p>}
      {answer && (
        <div className="shop-answer" aria-live="polite" data-testid="shop-answer">
          {answer.fits.length > 0 ? (
            <>
              <p className="shop-yes">
                Passt an {answer.fits.length} {answer.fits.length === 1 ? 'Stelle' : 'Stellen'}.
              </p>
              <ul className="shop-spans">
                {answer.fits.map((f, i) => (
                  <li key={i}>
                    <strong className="shop-len">{f.span.roomName}</strong>
                    <span className="shop-what">
                      {f.span.niche ? 'Nische' : 'Wand'} · {boundText(f.span)} ({formatMeters(f.span.length)} frei, Tiefe {f.span.depth >= 3 ? 'über 3 m' : formatMeters(f.span.depth)})
                    </span>
                    <span className="shop-depth">{fitText(f)}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : answer.tooHigh ? (
            <p className="shop-no">Passt nirgends: höher als die Raumdecke.</p>
          ) : (
            <p className="shop-no">
              Passt nirgends.
              {answer.nearest && ` Am nächsten: ${answer.nearest.span.roomName}, ${boundText(answer.nearest.span)} – es fehlen ${formatCm(answer.nearest.missBy)} cm.`}
            </p>
          )}
        </div>
      )}
    </>
  );
}

function ListTab() {
  const project = useProjectStore((s) => s.project);
  const groups = useMemo(() => shoppingGroups(project), [project]);
  const [checked, setChecked] = useState(() => loadChecked(project.id));
  useEffect(() => setChecked(loadChecked(project.id)), [project.id]);
  const toggle = (id: string) => {
    const next = new Set(checked);
    if (!next.delete(id)) next.add(id);
    setChecked(next);
    saveChecked(project.id, next);
  };
  const { done, total } = progress(groups, checked);
  if (total === 0) return <p className="shop-empty">Die Einkaufsliste ist leer – im Plan Möbel hinzufügen.</p>;
  return (
    <>
      <p className="shop-progress" aria-live="polite">
        {done} von {total} abgehakt
      </p>
      {groups.map((g) => (
        <section key={g.label} className="shop-room" aria-label={g.label}>
          <h3>{g.label}</h3>
          <ul className="shop-items">
            {g.items.map((i) => (
              <li key={i.id}>
                <label>
                  <input type="checkbox" checked={checked.has(i.id)} onChange={() => toggle(i.id)} />
                  <span className="shop-item-text">
                    <strong>
                      {i.quantity > 1 ? `${i.quantity}× ` : ''}
                      {i.name}
                    </strong>
                    {(i.size || i.retailer) && <small>{[i.size && `${i.size} cm`, i.retailer].filter(Boolean).join(' · ')}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
