import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { DerivedPlan } from '../model/derived';
import type { Project } from '../model/schema';
import { useAssetUrl } from '../persistence/useAssetUrl';
import { photoPlacement } from './photos';

function usePhotoTexture(assetId: string): THREE.Texture | null {
  const { url } = useAssetUrl(assetId);
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    let loaded: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      loaded = t;
      if (alive) setTex(t);
      else t.dispose();
    });
    return () => {
      alive = false;
      loaded?.dispose();
      setTex(null);
    };
  }, [url]);
  return url ? tex : null;
}

function PhotoPlane({ project, derived, id }: { project: Project; derived: DerivedPlan; id: string }) {
  const photo = project.photos.find((p) => p.id === id)!;
  const tex = usePhotoTexture(photo.assetId);
  const pl = photoPlacement(photo, derived);
  if (!pl || !tex) return null;
  return (
    <mesh
      position={[pl.x, pl.y, pl.z]}
      rotation={[0, pl.rotY, 0]}
      // photos are overlays: clicks go through to the wall behind
      raycast={() => null}
      renderOrder={2}
      userData={{ photoId: id }}
    >
      <planeGeometry args={[pl.width, pl.height]} />
      <meshBasicMaterial map={tex} transparent opacity={photo.opacity} toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-2} />
    </mesh>
  );
}

/** Reference photos hung on walls (#86), semi-transparent over the wall surface. */
export function Photos3D({ project, derived }: { project: Project; derived: DerivedPlan }) {
  return (
    <group name="wall-photos">
      {project.photos
        .filter((p) => p.visible)
        .map((p) => (
          <PhotoPlane key={`${p.id}:${p.assetId}`} project={project} derived={derived} id={p.id} />
        ))}
    </group>
  );
}
