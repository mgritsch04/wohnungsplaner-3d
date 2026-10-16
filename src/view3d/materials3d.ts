import * as THREE from 'three';
import type { Material, QualityMode } from '../model/schema';

/**
 * Shared Three.js materials. Materials are cached by their definition and quality
 * mode so that walls/floors/furniture reuse GPU resources instead of creating
 * new materials on every render.
 */
const cache = new Map<string, THREE.Material>();
const textureCache = new Map<string, THREE.Texture>();

function patternTexture(kind: Material['kind'], color: string): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  if (!['wood', 'tile', 'stone', 'concrete', 'carpet'].includes(kind)) return null;
  const key = `${kind}|${color}`;
  const hit = textureCache.get(key);
  if (hit) return hit;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const base = new THREE.Color(color);
  const shade = (f: number) => {
    const c = base.clone().multiplyScalar(f);
    return `rgb(${Math.min(255, c.r * 255)},${Math.min(255, c.g * 255)},${Math.min(255, c.b * 255)})`;
  };
  // deterministic pseudo random
  let seed = 1234;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  ctx.fillStyle = shade(1);
  ctx.fillRect(0, 0, size, size);
  if (kind === 'wood') {
    // planks: 1 repeat = textureScale meters, 5 planks across
    const planks = 5;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = shade(0.88 + rnd() * 0.2);
      ctx.fillRect(0, i * ph, size, ph);
      for (let k = 0; k < 14; k++) {
        ctx.strokeStyle = shade(0.8 + rnd() * 0.15);
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        const y = i * ph + rnd() * ph;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(size * 0.3, y + rnd() * 4 - 2, size * 0.6, y + rnd() * 4 - 2, size, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = shade(0.6);
      ctx.fillRect(0, i * ph, size, 1.5);
      const joint = ((i * 0.37) % 1) * size;
      ctx.fillRect(joint, i * ph, 1.5, ph);
    }
  } else if (kind === 'tile') {
    const n = 2;
    const s = size / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = shade(0.95 + rnd() * 0.08);
        ctx.fillRect(i * s, j * s, s, s);
      }
    ctx.strokeStyle = shade(0.7);
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s, 0);
      ctx.lineTo(i * s, size);
      ctx.moveTo(0, i * s);
      ctx.lineTo(size, i * s);
      ctx.stroke();
    }
  } else {
    const img = ctx.getImageData(0, 0, size, size);
    const amp = kind === 'carpet' ? 0.12 : kind === 'concrete' ? 0.1 : 0.16;
    for (let i = 0; i < img.data.length; i += 4) {
      const f = 1 + (rnd() - 0.5) * amp;
      img.data[i] = Math.min(255, img.data[i] * f);
      img.data[i + 1] = Math.min(255, img.data[i + 1] * f);
      img.data[i + 2] = Math.min(255, img.data[i + 2] * f);
    }
    ctx.putImageData(img, 0, 0);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textureCache.set(key, tex);
  return tex;
}

export function getSurfaceMaterial(m: Material, quality: QualityMode): THREE.Material {
  const key = `${m.id}|${m.color}|${m.roughness}|${m.metalness}|${m.textureScale}|${m.kind}|${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let mat: THREE.Material;
  if (quality === 'planning') {
    mat = new THREE.MeshLambertMaterial({ color: m.color });
  } else {
    const tex = patternTexture(m.kind, m.color);
    let map: THREE.Texture | null = null;
    if (tex) {
      map = tex.clone();
      map.needsUpdate = true;
      map.repeat.set(1 / m.textureScale, 1 / m.textureScale);
    }
    mat = new THREE.MeshStandardMaterial({ color: map ? '#ffffff' : m.color, map, roughness: m.roughness, metalness: m.metalness });
  }
  cache.set(key, mat);
  return mat;
}

export function getColorMaterial(
  color: string,
  quality: QualityMode,
  opts: { roughness?: number; metalness?: number; emissive?: string; opacity?: number; doubleSide?: boolean } = {},
): THREE.Material {
  const key = `c|${color}|${quality}|${opts.roughness ?? 0.7}|${opts.metalness ?? 0}|${opts.emissive ?? ''}|${opts.opacity ?? 1}|${opts.doubleSide ? 2 : 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const transparent = (opts.opacity ?? 1) < 1;
  const mat =
    quality === 'planning'
      ? new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? '#000000', transparent, opacity: opts.opacity ?? 1, depthWrite: !transparent, side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide })
      : new THREE.MeshStandardMaterial({
          color,
          roughness: opts.roughness ?? 0.7,
          metalness: opts.metalness ?? 0,
          emissive: opts.emissive ?? '#000000',
          emissiveIntensity: opts.emissive ? 1 : 0,
          transparent,
          opacity: opts.opacity ?? 1,
          depthWrite: !transparent,
          side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
  cache.set(key, mat);
  return mat;
}

/** Free all cached GPU materials and textures (e.g. when switching quality mode a lot). */
export function disposeMaterialCache() {
  for (const m of cache.values()) m.dispose();
  for (const t of textureCache.values()) t.dispose();
  cache.clear();
  textureCache.clear();
}
