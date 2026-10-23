import { useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES } from '../catalog/types';
import { derivePlan } from '../model/derived';
import { conflictSummary, placementIssues } from '../model/placement';
import { packsNeeded } from '../catalog/packSize';
import { formatEuro } from '../model/units';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';

const DELAY_MS = 450;
const cm = (m: number) => String(Math.round(m * 1000) / 10).replace('.', ',');

/**
 * Compact info card for the furniture under the mouse (2D and 3D): name, category,
 * price, dimensions, brand/retailer and the stored product image. Shows only data the
 * item actually has. A marked item (collision/conflict) also says why (#16). Appears after a short delay, never while a mouse button is held
 * (dragging) and not for touch input – there the properties panel shows the same data.
 */
export function FurnitureHoverCard() {
  const hover = useUiStore((s) => s.hover);
  const id = hover?.type === 'furniture' ? hover.id : null;
  const item = useProjectStore((s) => (id ? s.project.furniture.find((f) => f.id === id) : undefined));
  const project = useProjectStore((s) => s.project);
  // why the item is marked red/orange – only computed while a furniture item is hovered
  const summary = useMemo(() => (item ? conflictSummary(placementIssues(project, derivePlan(project), item)) : null), [project, item]);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [pressed, setPressed] = useState(false);
  const [ready, setReady] = useState(false);
  const [imageOk, setImageOk] = useState(true);
  const active = useRef(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    active.current = !!id;
  }, [id]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') {
        lastPos.current = null;
        return setPos(null);
      }
      setPressed(e.buttons !== 0);
      lastPos.current = { x: e.clientX, y: e.clientY };
      // only re-render while something is hovered (the hover itself is set after this event)
      if (active.current) setPos(lastPos.current);
    };
    const down = () => setPressed(true);
    const up = () => setPressed(false);
    window.addEventListener('pointermove', move, { capture: true, passive: true });
    window.addEventListener('pointerdown', down, { capture: true, passive: true });
    window.addEventListener('pointerup', up, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointermove', move, { capture: true });
      window.removeEventListener('pointerdown', down, { capture: true });
      window.removeEventListener('pointerup', up, { capture: true });
    };
  }, []);

  useEffect(() => {
    setReady(false);
    setImageOk(true);
    setPos(lastPos.current);
    if (!id) return;
    const t = window.setTimeout(() => setReady(true), DELAY_MS);
    return () => window.clearTimeout(t);
  }, [id]);

  if (!item || !ready || !pos || pressed) return null;
  const category = CATEGORIES.find((c) => c.id === item.category)?.label;
  const seller = [item.brand, item.retailer].filter(Boolean).join(' · ');
  const image = item.imageUrl && /^https:\/\//i.test(item.imageUrl) && imageOk ? item.imageUrl : null;
  const W = 260;
  const left = Math.min(pos.x + 14, window.innerWidth - W - 8);
  const top = Math.min(pos.y + 18, window.innerHeight - (image ? 230 : 130) - (summary ? 50 : 0));
  return (
    <div className="hover-card" role="tooltip" data-testid="furniture-hover" style={{ left, top, width: W }}>
      {image && <img src={image} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setImageOk(false)} />}
      <strong>{item.name}</strong>
      {category && <span className="muted">{category}</span>}
      <span>
        {cm(item.width)} × {cm(item.depth)} × {cm(item.height)} cm <span className="muted">(B × T × H)</span>
      </span>
      {item.price && (
        <span>
          {formatEuro(item.price.amount * packsNeeded(item.quantity ?? 1, item.price.packSize))}
          {(item.price.packSize ?? 1) > 1 ? (
            <span className="muted">
              {' '}
              ({packsNeeded(item.quantity ?? 1, item.price.packSize)} × Packung à {item.price.packSize} Stk., {formatEuro(item.price.amount / (item.price.packSize ?? 1))} pro Stück)
            </span>
          ) : (
            item.quantity > 1 && <span className="muted"> ({item.quantity} Stk.)</span>
          )}
          {item.price.status === 'estimate' && <span className="muted"> · Schätzung</span>}
        </span>
      )}
      {seller && <span className="muted">{seller}</span>}
      {summary && (
        <span className={`hover-card-conflict ${summary.level}`} data-testid="hover-conflict" data-level={summary.level}>
          <strong>{summary.label}:</strong> {summary.reasons.join(' · ')}
        </span>
      )}
    </div>
  );
}
