import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useCatalogStore } from '../catalog/catalogStore';
import { formFromOwnItem, formFromTemplate, formWithShape, emptyForm, OWN_SHAPES, OWN_TEMPLATES, ownItemFromForm, ownShapeOf, validateOwnForm, type OwnForm } from '../catalog/own';
import { imageToPictureTexture } from '../catalog/ownImage';
import { CATEGORIES } from '../catalog/types';
import type { TableBase } from '../model/schema';
import { addCatalogItem } from './actions';
import { useDialogStore } from './dialogStore';

const OwnPreview3D = lazy(() => import('./OwnPreview3D'));

const BASES: { value: TableBase | ''; label: string }[] = [
  { value: '', label: 'Standard (vier Beine bzw. Platten)' },
  { value: 'legs4', label: 'Vier Beine' },
  { value: 'sled', label: 'Kufen / Bügel' },
  { value: 'x', label: 'X-Gestell' },
  { value: 'pedestal', label: 'Mittelfuß' },
  { value: 'panel', label: 'Seitenplatten' },
];

/** Length input in cm that accepts a decimal comma and updates while typing. */
function Cm({ label, value, onChange, max = 2000 }: { label: string; value: number; onChange: (v: number) => void; max?: number }) {
  const [text, setText] = useState(String(value).replace('.', ','));
  useEffect(() => {
    const parsed = parseFloat(text.replace(',', '.'));
    if (parsed !== value) setText(String(value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value.replace(',', '.'));
            if (Number.isFinite(n) && n >= 0 && n <= max) onChange(n);
          }}
        />
        <span className="field-unit">cm</span>
      </span>
    </label>
  );
}

/**
 * Create or edit an own object (#493): a piece that is not from IKEA or Möbelix – the bike, a desk
 * of another maker, a metal poster, a designer chair. Name, size, colour, form; link, photo and price are optional.
 */
export function OwnItemModal() {
  const close = useDialogStore((s) => s.closeModal);
  const data = useDialogStore((s) => s.modalData) as { itemId?: string; shape?: string } | null;
  const items = useCatalogStore((s) => s.items);
  const editing = data?.itemId ? items.find((i) => i.id === data.itemId) : undefined;
  const [form, setForm] = useState<OwnForm>(() => (editing ? formFromOwnItem(editing) : emptyForm(data?.shape ?? 'desk')));
  const [error, setError] = useState<string[]>([]);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const shape = ownShapeOf(form.shape);
  const has = (o: NonNullable<typeof shape.options>[number]) => shape.options?.includes(o) ?? false;
  const set = (patch: Partial<OwnForm>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const draft = useMemo(() => ownItemFromForm({ ...form, name: form.name.trim() || 'Eigenes Objekt' }, editing?.id ?? 'preview'), [form, editing?.id]);

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      const url = await imageToPictureTexture(file, form.width, form.height);
      set({ texture: url });
      setPhotoNote(`„${file.name}“ auf das Seitenverhältnis ${Math.round(form.width)}:${Math.round(form.height)} zugeschnitten.`);
    } catch (e) {
      setPhotoNote(e instanceof Error ? e.message : 'Das Bild konnte nicht gelesen werden.');
    }
  };

  const save = async (place: boolean) => {
    const problems = validateOwnForm(form);
    setError(problems);
    if (problems.length) return;
    const item = ownItemFromForm(form, editing?.id);
    await useCatalogStore.getState().addItems([item]);
    close();
    if (place) addCatalogItem(item);
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal wide" role="dialog" aria-modal="true" aria-label={editing ? 'Eigenes Objekt bearbeiten' : 'Eigenes Objekt anlegen'} onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{editing ? 'Eigenes Objekt bearbeiten' : 'Eigenes Objekt anlegen'}</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body own-item">
          <p className="small muted">
            Für alles, was nicht von IKEA oder Möbelix kommt: Fahrrad, Schreibtisch eines anderen Herstellers, Poster, Designer-Stuhl. Die Maße trägst du selbst ein; im Plan steht ein Platzhalter in dieser Form.
          </p>
          <div className="own-item-grid">
            <div className="own-item-form">
              {!editing && (
                <label className="field">
                  <span className="field-label">Typische Maße als Start</span>
                  <span className="field-input">
                    <select
                      aria-label="Vorlage mit typischen Maßen"
                      value=""
                      onChange={(e) => {
                        const t = OWN_TEMPLATES.find((x) => x.id === e.target.value);
                        if (t) setForm((f) => ({ ...formFromTemplate(t), brand: f.brand, productUrl: f.productUrl, imageUrl: f.imageUrl, priceEur: f.priceEur, fixed: f.fixed, owned: f.owned }));
                      }}
                    >
                      <option value="">– keine Vorlage –</option>
                      {OWN_TEMPLATES.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
              <label className="field">
                <span className="field-label">Name</span>
                <span className="field-input">
                  <input type="text" aria-label="Name des Objekts" value={form.name} placeholder="z. B. Rennrad, Schreibtisch Eiche, Bürostuhl" onChange={(e) => set({ name: e.target.value })} />
                </span>
              </label>
              <div className="field-grid">
                <label className="field">
                  <span className="field-label">Form</span>
                  <span className="field-input">
                    <select aria-label="Form im Plan" value={OWN_SHAPES.some((s) => s.shape === form.shape) ? form.shape : 'box'} onChange={(e) => setForm((f) => formWithShape(f, e.target.value))}>
                      {OWN_SHAPES.map((s) => (
                        <option key={s.shape} value={s.shape}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label className="field">
                  <span className="field-label">Kategorie</span>
                  <span className="field-input">
                    <select aria-label="Kategorie" value={form.category} onChange={(e) => set({ category: e.target.value })}>
                      {CATEGORIES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
              <div className="field-grid three">
                <Cm label="Breite" value={form.width} onChange={(v) => set({ width: v })} />
                <Cm label="Tiefe" value={form.depth} onChange={(v) => set({ depth: v })} />
                <Cm label="Höhe" value={form.height} onChange={(v) => set({ height: v })} />
              </div>
              <Cm label="Montagehöhe über dem Boden (Wandobjekt)" value={form.elevation} onChange={(v) => set({ elevation: v })} max={1000} />
              <div className="field-grid">
                <label className="field">
                  <span className="field-label">Farbe</span>
                  <span className="field-input">
                    <input type="color" aria-label="Hauptfarbe" value={form.color} onChange={(e) => set({ color: e.target.value })} />
                  </span>
                </label>
                {has('secondary') && (
                  <label className="field">
                    <span className="field-label">Gestell-/Rahmenfarbe</span>
                    <span className="field-input">
                      <input type="color" aria-label="Gestellfarbe" value={form.secondaryColor || '#333538'} onChange={(e) => set({ secondaryColor: e.target.value })} />
                      {form.secondaryColor && (
                        <button className="link-btn" onClick={() => set({ secondaryColor: '' })}>
                          zurücksetzen
                        </button>
                      )}
                    </span>
                  </label>
                )}
              </div>
              {has('base') && (
                <label className="field">
                  <span className="field-label">Untergestell</span>
                  <span className="field-input">
                    <select aria-label="Untergestell" value={form.base} onChange={(e) => set({ base: e.target.value as TableBase | '' })}>
                      {BASES.map((b) => (
                        <option key={b.value} value={b.value}>
                          {b.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
              {has('photo') && (
                <div className="field">
                  <span className="field-label">Motiv (Foto)</span>
                  <span className="field-input own-photo">
                    <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Foto des Posters wählen" onChange={(e) => void pickPhoto(e.target.files?.[0])} />
                    {form.texture && (
                      <button className="link-btn" onClick={() => set({ texture: '' })}>
                        Foto entfernen
                      </button>
                    )}
                  </span>
                  {photoNote && <p className="small muted">{photoNote}</p>}
                  <p className="small muted">Das Foto bleibt auf diesem Computer (im Projekt) und wird auf die Proportionen des Bildes zugeschnitten. Beim Ändern der Maße das Foto neu wählen.</p>
                </div>
              )}
              {has('frameless') && <CheckBox label="Ohne Rahmen (z. B. Metall-Poster)" checked={form.frameless} onChange={(v) => set({ frameless: v })} />}
              <details>
                <summary className="small">Marke, Link, Preis (optional)</summary>
                <div className="own-item-more">
                  <label className="field">
                    <span className="field-label">Marke / Hersteller</span>
                    <span className="field-input">
                      <input type="text" aria-label="Marke" value={form.brand} onChange={(e) => set({ brand: e.target.value })} />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Link zum Produkt</span>
                    <span className="field-input">
                      <input type="url" aria-label="Link zum Produkt" value={form.productUrl} placeholder="https://…" onChange={(e) => set({ productUrl: e.target.value })} />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Bildadresse</span>
                    <span className="field-input">
                      <input type="url" aria-label="Bildadresse" value={form.imageUrl} placeholder="https://… (für die Anzeige im Hover)" onChange={(e) => set({ imageUrl: e.target.value })} />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Preis</span>
                    <span className="field-input">
                      <input type="text" inputMode="decimal" aria-label="Preis" value={form.priceEur} onChange={(e) => set({ priceEur: e.target.value })} />
                      <span className="field-unit">€</span>
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Notiz</span>
                    <span className="field-input">
                      <input type="text" aria-label="Notiz" value={form.note} onChange={(e) => set({ note: e.target.value })} />
                    </span>
                  </label>
                </div>
              </details>
              <CheckBox label="Feste Vorgabe: der Einrichtungsvorschlag plant darum herum und verschiebt es nicht" checked={form.fixed} onChange={(v) => set({ fixed: v })} />
              <CheckBox label="Habe ich schon (zählt nicht zum Budget und zur Einkaufsliste)" checked={form.owned} onChange={(v) => set({ owned: v })} />
            </div>
            <div className="own-item-preview">
              <Suspense fallback={<p className="muted small">Vorschau lädt …</p>}>
                {typeof WebGLRenderingContext !== 'undefined' ? (
                  <OwnPreview3D
                    shape={form.shape}
                    width={Math.max(0.05, draft.width)}
                    depth={Math.max(0.01, draft.depth)}
                    height={Math.max(0.01, draft.height)}
                    color={draft.color}
                    model={draft.model}
                  />
                ) : (
                  <p className="muted small">Keine 3D-Vorschau in dieser Umgebung.</p>
                )}
              </Suspense>
              <p className="small muted">Vorschau, drehbar. Der Platzhalter hat deine Maße, aber nicht jedes Detail des echten Stücks.</p>
            </div>
          </div>
          {error.length > 0 && (
            <ul className="warning small" role="alert">
              {error.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <div className="btn-row end">
            <button onClick={close}>Abbrechen</button>
            <button onClick={() => void save(false)} data-testid="own-save">
              Speichern
            </button>
            <button className="primary" onClick={() => void save(true)} data-testid="own-save-place">
              Speichern und platzieren
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckBox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
