import * as THREE from 'three';
import type { Material, QualityMode } from '../model/schema';
import { forgetMetals, METAL_THRESHOLD, registerMetal } from './metalRegistry';

/**
 * Shared Three.js materials. Materials are cached by their definition and quality
 * mode so that walls/floors/furniture reuse GPU resources instead of creating
 * new materials on every render.
 */
const cache = new Map<string, THREE.Material>();
const textureCache = new Map<string, { map: THREE.Texture; bump: THREE.Texture }>();

export type DetailKind = 'planks' | 'tile' | 'stone' | 'concrete' | 'carpet' | 'plaster' | 'fabric' | 'woodgrain' | 'leather';

const SURFACE_DETAIL: Partial<Record<Material['kind'], DetailKind>> = {
  wood: 'planks',
  tile: 'tile',
  stone: 'stone',
  concrete: 'concrete',
  carpet: 'carpet',
  paint: 'plaster',
  fabric: 'fabric',
};

/** Relief strength per detail kind (bump scale). */
const BUMP: Record<DetailKind, number> = { planks: 0.6, tile: 1.2, stone: 0.8, concrete: 0.5, carpet: 1.0, plaster: 0.25, fabric: 0.8, woodgrain: 0.3, leather: 0.5 };

/**
 * Colour-neutral detail textures (light grey values, multiplied with the
 * material colour) generated on a canvas. The same image doubles as bump map.
 * Deterministic, so every session looks the same.
 */
export function detailTexture(kind: DetailKind): { map: THREE.Texture; bump: THREE.Texture } | null {
  if (typeof document === 'undefined') return null;
  const hit = textureCache.get(kind);
  if (hit) return hit;
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  let seed = 1234;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const grey = (v: number) => {
    const c = Math.round(Math.max(0, Math.min(1, v)) * 255);
    return `rgb(${c},${c},${c})`;
  };
  const noise = (amp: number, blur = 0) => {
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const f = 1 + (rnd() - 0.5) * amp;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, img.data[i] * f);
    }
    ctx.putImageData(img, 0, 0);
    if (blur) {
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(canvas, 0, 0);
      ctx.filter = 'none';
    }
  };
  ctx.fillStyle = grey(0.95);
  ctx.fillRect(0, 0, size, size);
  if (kind === 'planks' || kind === 'woodgrain') {
    const planks = kind === 'planks' ? 5 : 1;
    const ph = size / planks;
    for (let i = 0; i < planks; i++) {
      ctx.fillStyle = grey(0.82 + rnd() * 0.16);
      ctx.fillRect(0, i * ph, size, ph);
      for (let k = 0; k < 40; k++) {
        ctx.strokeStyle = grey(0.62 + rnd() * 0.2);
        ctx.globalAlpha = 0.25 + rnd() * 0.25;
        ctx.lineWidth = 0.6 + rnd() * 1.6;
        ctx.beginPath();
        const y = i * ph + rnd() * ph;
        const wobble = ph * 0.08;
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(size * 0.33, y + (rnd() - 0.5) * wobble, size * 0.66, y + (rnd() - 0.5) * wobble, size, y);
        ctx.stroke();
      }
      // a few knots
      for (let k = 0; k < (kind === 'planks' ? 1 : 2); k++) {
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = grey(0.55);
        ctx.beginPath();
        ctx.ellipse(rnd() * size, i * ph + ph * (0.3 + rnd() * 0.4), 6 + rnd() * 8, 2 + rnd() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (kind === 'planks') {
        ctx.fillStyle = grey(0.35);
        ctx.fillRect(0, i * ph, size, 2);
        const joint = ((i * 0.37 + 0.11) % 1) * size;
        ctx.fillRect(joint, i * ph, 2, ph);
      }
    }
    noise(0.06);
  } else if (kind === 'tile') {
    const n = 2;
    const t = size / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        ctx.fillStyle = grey(0.9 + rnd() * 0.08);
        ctx.fillRect(i * t, j * t, t, t);
      }
    noise(0.05, 1);
    ctx.fillStyle = grey(0.55);
    for (let i = 0; i <= n; i++) {
      ctx.fillRect(i * t - 3, 0, 6, size);
      ctx.fillRect(0, i * t - 3, size, 6);
    }
  } else if (kind === 'fabric') {
    // woven pattern
    for (let y = 0; y < size; y += 4)
      for (let x = 0; x < size; x += 4) {
        ctx.fillStyle = grey(((x + y) / 4) % 2 ? 0.86 : 0.97);
        ctx.fillRect(x, y, 4, 4);
      }
    noise(0.18, 0.6);
  } else if (kind === 'leather') {
    // fine pebbled grain
    noise(0.22, 1.2);
    noise(0.06);
  } else if (kind === 'carpet') {
    noise(0.35, 0.8);
  } else if (kind === 'plaster') {
    noise(0.12, 2);
  } else {
    // stone / concrete: mottled
    for (let k = 0; k < 400; k++) {
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = grey(0.7 + rnd() * 0.3);
      ctx.beginPath();
      ctx.arc(rnd() * size, rnd() * size, 4 + rnd() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    noise(kind === 'stone' ? 0.12 : 0.18, 0.7);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  const bump = map.clone();
  bump.colorSpace = THREE.NoColorSpace;
  bump.needsUpdate = true;
  const entry = { map, bump };
  textureCache.set(kind, entry);
  return entry;
}

function withRepeat(t: THREE.Texture, repeat: number): THREE.Texture {
  const c = t.clone();
  c.repeat.set(repeat, repeat);
  c.needsUpdate = true;
  return c;
}

export function getSurfaceMaterial(m: Material, quality: QualityMode): THREE.Material {
  const key = `${m.id}|${m.color}|${m.roughness}|${m.metalness}|${m.textureScale}|${m.kind}|${quality}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let mat: THREE.Material;
  if (quality === 'planning') {
    mat = new THREE.MeshLambertMaterial({ color: m.color });
  } else {
    const kind = SURFACE_DETAIL[m.kind];
    const tex = kind ? detailTexture(kind) : null;
    // UVs are in meters: one texture repeat covers `textureScale` meters (plaster uses a fixed fine scale)
    const repeat = kind === 'plaster' ? 1 / 0.8 : 1 / m.textureScale;
    mat = new THREE.MeshStandardMaterial({
      color: m.color,
      map: tex ? withRepeat(tex.map, repeat) : null,
      bumpMap: tex ? withRepeat(tex.bump, repeat) : null,
      bumpScale: kind ? BUMP[kind] : 1,
      roughness: m.roughness,
      metalness: m.metalness,
    });
  }
  cache.set(key, mat);
  return mat;
}

export function getColorMaterial(
  color: string,
  quality: QualityMode,
  opts: { roughness?: number; metalness?: number; emissive?: string; opacity?: number; doubleSide?: boolean; detail?: DetailKind; detailRepeat?: number } = {},
): THREE.Material {
  const key = `c|${color}|${quality}|${opts.roughness ?? 0.7}|${opts.metalness ?? 0}|${opts.emissive ?? ''}|${opts.opacity ?? 1}|${opts.doubleSide ? 2 : 1}|${opts.detail ?? ''}|${opts.detailRepeat ?? 1}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const transparent = (opts.opacity ?? 1) < 1;
  const tex = quality === 'realism' && opts.detail ? detailTexture(opts.detail) : null;
  const rep = opts.detailRepeat ?? 1;
  const mat =
    quality === 'planning'
      ? new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? '#000000', transparent, opacity: opts.opacity ?? 1, depthWrite: !transparent, side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide })
      : new THREE.MeshStandardMaterial({
          color,
          map: tex ? withRepeat(tex.map, rep) : null,
          bumpMap: tex ? withRepeat(tex.bump, rep) : null,
          bumpScale: opts.detail ? BUMP[opts.detail] : 1,
          roughness: opts.roughness ?? 0.7,
          metalness: opts.metalness ?? 0,
          emissive: opts.emissive ?? '#000000',
          emissiveIntensity: opts.emissive ? 1 : 0,
          transparent,
          opacity: opts.opacity ?? 1,
          depthWrite: !transparent,
          side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
  if (mat instanceof THREE.MeshStandardMaterial && mat.metalness >= METAL_THRESHOLD) registerMetal(mat);
  cache.set(key, mat);
  return mat;
}

/** Free all cached GPU materials and textures (e.g. when switching quality mode a lot). */
export function disposeMaterialCache() {
  for (const m of cache.values()) m.dispose();
  for (const t of textureCache.values()) {
    t.map.dispose();
    t.bump.dispose();
  }
  cache.clear();
  textureCache.clear();
  forgetMetals();
}
