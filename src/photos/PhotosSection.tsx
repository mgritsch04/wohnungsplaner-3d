import { useState } from 'react';
import { derivePlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useAssetUrl } from '../persistence/useAssetUrl';
import { reportError } from '../ui/actions';
import { pickFile } from '../ui/fileUtils';
import { CheckField, NumberField, Section, SelectField } from '../ui/fields';
import { addPhotoToWall, deletePhoto, PHOTO_ACCEPT, photoHeight, photosOfWall, setWallPhotosVisible, sideRoomName, updatePhoto } from './photos';

function Thumb({ assetId }: { assetId: string }) {
  const { url, missing } = useAssetUrl(assetId);
  if (missing) return <span className="muted small">Bild fehlt</span>;
  return url ? <img src={url} alt="" style={{ maxWidth: 72, maxHeight: 54, borderRadius: 4, objectFit: 'cover' }} /> : null;
}

/** Reference photos of the selected wall (#86), under „Eigenschaften“. Images stay local. */
export function PhotosSection({ project, wallId, length }: { project: Project; wallId: string; length: number }) {
  const photos = photosOfWall(project, wallId);
  const [busy, setBusy] = useState(false);
  const derived = derivePlan(project);
  const sideLabel = (side: 'left' | 'right') => {
    const room = sideRoomName(project, derived, wallId, side);
    const base = side === 'left' ? 'Linke Seite' : 'Rechte Seite';
    return room ? `${base} (${room})` : base;
  };
  const add = async () => {
    const file = await pickFile(PHOTO_ACCEPT);
    if (!file) return;
    setBusy(true);
    try {
      await addPhotoToWall(wallId, file);
    } catch (e) {
      reportError(e, 'Foto hinzufügen');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Fotos"
      actions={
        <button type="button" disabled={busy} onClick={() => void add()}>
          + Foto
        </button>
      }
    >
      {photos.length === 0 && (
        <p className="muted small">Kein Foto. „+ Foto“ hängt ein Bild an diese Wand, z. B. zum Vergleich mit dem Plan. Das Bild bleibt nur in diesem Browser gespeichert.</p>
      )}
      {photos.length > 1 && (
        <div className="field-row">
          <button type="button" onClick={() => setWallPhotosVisible(wallId, true)}>
            Alle einblenden
          </button>
          <button type="button" onClick={() => setWallPhotosVisible(wallId, false)}>
            Alle ausblenden
          </button>
        </div>
      )}
      <ul className="plain-list">
        {photos.map((ph) => (
          <li key={ph.id} data-testid="photo-row" style={{ marginBottom: 12 }}>
            <div className="field-row">
              <Thumb assetId={ph.assetId} />
              <CheckField label="Sichtbar" checked={ph.visible} onChange={(v) => updatePhoto(ph.id, (x) => (x.visible = v))} />
              <button type="button" className="danger" onClick={() => deletePhoto(ph.id)} title="Foto von der Wand nehmen">
                Entfernen
              </button>
            </div>
            <SelectField
              label="Wandseite"
              value={ph.side}
              options={[
                { value: 'left', label: sideLabel('left') },
                { value: 'right', label: sideLabel('right') },
              ]}
              onChange={(v) => updatePhoto(ph.id, (x) => (x.side = v))}
            />
            <label className="field">
              <span>Deckkraft: {Math.round(ph.opacity * 100)} %</span>
              <input
                type="range"
                aria-label="Deckkraft des Fotos"
                min={5}
                max={100}
                step={5}
                value={Math.round(ph.opacity * 100)}
                onChange={(e) => updatePhoto(ph.id, (x) => (x.opacity = Number(e.target.value) / 100))}
              />
            </label>
            <div className="field-row">
              <NumberField
                label="Breite"
                value={ph.width}
                factor={100}
                unit="cm"
                min={5}
                max={Math.max(5, Math.round(length * 100))}
                onChange={(v) => updatePhoto(ph.id, (x) => (x.width = v))}
                title={`Höhe ergibt sich aus dem Seitenverhältnis (${Math.round(photoHeight(ph) * 100)} cm)`}
              />
              <NumberField label="Von Wandanfang" value={ph.along} factor={100} unit="cm" min={-500} max={Math.round(length * 100)} onChange={(v) => updatePhoto(ph.id, (x) => (x.along = v))} />
              <NumberField label="Unterkante" value={ph.bottom} factor={100} unit="cm" min={-100} max={1000} onChange={(v) => updatePhoto(ph.id, (x) => (x.bottom = v))} />
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
