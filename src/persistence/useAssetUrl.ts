import { useEffect, useState } from 'react';
import { db } from './db';

/** Object URL for a locally stored asset; revoked automatically on change/unmount. */
export function useAssetUrl(assetId: string | undefined | null): { url: string | null; missing: boolean } {
  const [state, setState] = useState<{ id: string | null; url: string | null; missing: boolean }>({ id: null, url: null, missing: false });
  useEffect(() => {
    if (!assetId) return;
    let url: string | null = null;
    let cancelled = false;
    db.getAsset(assetId)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setState({ id: assetId, url: null, missing: true });
          return;
        }
        url = URL.createObjectURL(blob);
        setState({ id: assetId, url, missing: false });
      })
      .catch(() => !cancelled && setState({ id: assetId, url: null, missing: true }));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [assetId]);
  if (!assetId || state.id !== assetId) return { url: null, missing: false };
  return { url: state.url, missing: state.missing };
}
