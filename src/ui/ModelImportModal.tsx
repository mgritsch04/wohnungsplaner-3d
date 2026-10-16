import { useState } from 'react';
import { inspectModel, ModelFileError, sniffModelFile, suggestUnit, type ModelInfo } from '../import/gltf';
import { db } from '../persistence/db';
import { newId } from '../model/ids';
import { useCatalogStore } from '../catalog/catalogStore';
import { CATEGORIES, type CatalogItem } from '../catalog/types';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { addCatalogItem } from './actions';
import { useDialogStore } from './dialogStore';
import { Badge } from './fields';

type Unit = 1 | 0.01 | 0.001;

/** Import a GLB/glTF model: validate, measure, store locally, add to catalog or attach to an item. */
export function ModelImportModal() {
  const close = useDialogStore((s) => s.closeModal);
  const target = useDialogStore((s) => s.modalData) as { furnitureId?: string } | null;
  const targetItem = useProjectStore((s) => (target?.furnitureId ? s.project.furniture.find((f) => f.id === target.furnitureId) : undefined));
  const [file, setFile] = useState<File | null>(null);
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unit, setUnit] = useState<Unit>(1);
  const [unitNote, setUnitNote] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState(targetItem?.category ?? 'decor');

  const choose = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await sniffModelFile(f);
      const i = await inspectModel(await f.arrayBuffer());
      const s = suggestUnit(i.size);
      setFile(f);
      setInfo(i);
      setUnit(s.factor as Unit);
      setUnitNote(s.note);
      setName(f.name.replace(/\.(glb|gltf)$/i, ''));
    } catch (e) {
      setError(e instanceof ModelFileError ? e.message : `Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const dims = info ? { w: info.size.x * unit, h: info.size.y * unit, d: info.size.z * unit } : null;

  const store = async () => {
    const assetId = newId('asset');
    await db.putAsset(assetId, file!);
    return assetId;
  };

  const addToCatalog = async () => {
    if (!file || !dims) return;
    const assetId = await store();
    const item: CatalogItem = {
      id: `model-${assetId}`,
      name: name.trim() || 'Eigenes Modell',
      category,
      width: dims.w,
      depth: dims.d,
      height: dims.h,
      color: '#b8b0a4',
      model: { type: 'gltf', assetId, fallbackShape: 'box' },
      approximate: false,
      solid: !['textile', 'lighting'].includes(category),
      tags: ['glb'],
      source: 'imported',
      sourceName: 'Eigene 3D-Modelle',
      description: `Aus ${file.name}, Maße aus dem Modell${unit !== 1 ? ` (Einheit ${unit === 0.01 ? 'cm' : 'mm'})` : ''}.`,
    };
    await useCatalogStore.getState().addItems([item]);
    close();
    addCatalogItem(item);
  };

  const attach = async (keepDims: boolean) => {
    if (!file || !dims || !targetItem) return;
    const assetId = await store();
    useProjectStore.getState().apply((d) => {
      const f = d.furniture.find((x) => x.id === targetItem.id);
      if (!f) return;
      const shape = f.model.type === 'procedural' ? f.model.shape : f.model.fallbackShape;
      f.model = { type: 'gltf', assetId, fallbackShape: shape };
      f.approximate = false;
      if (!keepDims) {
        f.width = dims.w;
        f.depth = dims.d;
        f.height = dims.h;
      }
    });
    close();
    useUiStore.getState().toast('3D-Modell hinterlegt.', 'success');
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="3D-Modell importieren" onMouseDown={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>{targetItem ? `3D-Modell für „${targetItem.name}“` : '3D-Modell importieren (GLB/glTF)'}</h2>
          <button onClick={close} aria-label="Schließen">
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="small">
            Unterstützt: <strong>.glb</strong> und eigenständige <strong>.gltf</strong> (glTF 2.0, auch Draco-komprimiert), max. 50 MB. Die Datei bleibt lokal im Browser
            und wird beim Projektexport mitgespeichert. Nur Modelle verwenden, die du nutzen darfst.
          </p>
          <label className="field">
            <span className="field-label">Modelldatei</span>
            <input type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" aria-label="Modelldatei" onChange={(e) => void choose(e.target.files?.[0])} />
          </label>
          {busy && <p className="small">Modell wird geprüft…</p>}
          {error && <p className="warning small">{error}</p>}
          {info && dims && (
            <>
              <p className="small">
                <Badge kind="ok">gültig</Badge> {info.meshes} Mesh(es), {info.triangles.toLocaleString('de-AT')} Dreiecke, {info.textures} Textur(en)
                {info.triangles > 300_000 && <span className="warn-text"> – sehr detailreich, kann die 3D-Ansicht verlangsamen</span>}
              </p>
              <label className="field">
                <span className="field-label">Einheit der Modelldatei</span>
                <span className="field-input">
                  <select value={unit} onChange={(e) => setUnit(Number(e.target.value) as Unit)} aria-label="Einheit">
                    <option value={1}>Meter (glTF-Standard)</option>
                    <option value={0.01}>Zentimeter</option>
                    <option value={0.001}>Millimeter</option>
                  </select>
                </span>
              </label>
              {unitNote && <p className="warn-text small">{unitNote}</p>}
              <p className="small">
                Maße aus dem Modell: <strong>{Math.round(dims.w * 1000) / 10}</strong> × <strong>{Math.round(dims.d * 1000) / 10}</strong> ×{' '}
                <strong>{Math.round(dims.h * 1000) / 10}</strong> cm (B × T × H)
              </p>
              {!targetItem && (
                <div className="field-grid">
                  <label className="field">
                    <span className="field-label">Name</span>
                    <span className="field-input">
                      <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
                    </span>
                  </label>
                  <label className="field">
                    <span className="field-label">Kategorie</span>
                    <span className="field-input">
                      <select value={category} onChange={(e) => setCategory(e.target.value)}>
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                </div>
              )}
              <p className="muted small">Ausrichtung: glTF-Standard (Y oben, Vorderseite +Z). Danach im Plan drehen, falls nötig.</p>
              <div className="btn-row end">
                {targetItem ? (
                  <>
                    <button onClick={() => void attach(true)}>Auf bisherige Maße skalieren</button>
                    <button className="primary" onClick={() => void attach(false)}>
                      Modellmaße übernehmen
                    </button>
                  </>
                ) : (
                  <button className="primary" onClick={() => void addToCatalog()}>
                    Zum Katalog hinzufügen und platzieren
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
