import * as THREE from 'three';
import type { Material, QualityMode } from '../model/schema';
import { forgetMetals, METAL_THRESHOLD, registerMetal } from './metalRegistry';

/**
 * Shared Three.js materials. Materials are cached by their definition and quality
 * mode so that walls/floors/furniture reuse GPU resources instead of creating
 * new materials on every render.
 */
const cache = new Map<string, THREE.Material>();
/** Colour, surface relief (normal map) and gloss variation (roughness map) of one detail kind. */
export interface DetailTextures {
  map: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  /** Mean of the roughness map: the material roughness is divided by it, so the average gloss stays as set. */
  roughnessMean: number;
}
const textureCache = new Map<string, DetailTextures>();

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

/** Relief strength per detail kind (slope of the normal map per unit of brightness change). */
const RELIEF: Record<DetailKind, number> = { planks: 4, tile: 5, stone: 5, concrete: 4, carpet: 8, plaster: 3, fabric: 5, woodgrain: 2.5, leather: 4 };

/**
 * Gloss variation per detail kind (#192): darker parts of the pattern (joints, grout, grain) are
 * rougher than the surface around them. 0 = uniform gloss.
 */
const ROUGHNESS_VARIATION: Record<DetailKind, number> = { planks: 0.35, tile: 0.5, stone: 0.3, concrete: 0.2, carpet: 0, plaster: 0.1, fabric: 0.15, woodgrain: 0.3, leather: 0.3 };

/**
 * Normal map (RGBA, tangent space) from a height field (0..1, row-major, wrapping at the edges):
 * central differences, tilted by `strength`.
 */
export function heightToNormalPixels(height: Float32Array, size: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const h = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * 0.5 * strength;
      // canvas rows run downwards, texture V upwards
      const dy = (h(x, y - 1) - h(x, y + 1)) * 0.5 * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      out[i] = Math.round((-dx / len) * 127.5 + 127.5);
      out[i + 1] = Math.round((-dy / len) * 127.5 + 127.5);
      out[i + 2] = Math.round((1 / len) * 127.5 + 127.5);
      out[i + 3] = 255;
    }
  return out;
}

/**
 * Roughness map (RGBA; three.js reads the green channel as a factor) from a height field:
 * the darkest parts get factor 1, the brightest 1 − variation. Returns the pixels and their mean factor.
 */
export function roughnessPixels(height: Float32Array, variation: number): { pixels: Uint8ClampedArray; mean: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of height) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo || 1;
  const pixels = new Uint8ClampedArray(height.length * 4);
  let sum = 0;
  height.forEach((v, k) => {
    const f = 1 - variation * ((v - lo) / range);
    sum += f;
    const c = Math.round(f * 255);
    pixels[k * 4] = pixels[k * 4 + 1] = pixels[k * 4 + 2] = c;
    pixels[k * 4 + 3] = 255;
  });
  return { pixels, mean: height.length ? sum / height.length : 1 };
}

/**
 * Colour-neutral detail textures (light grey values, multiplied with the
 * material colour) generated on a canvas. The same image is the height field
 * for the normal and roughness maps. Deterministic, so every session looks the same.
 */
export function detailTexture(kind: DetailKind): DetailTextures | null {
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
  const img = ctx.getImageData(0, 0, size, size);
  const height = new Float32Array(size * size);
  for (let k = 0; k < height.length; k++) height[k] = img.data[k * 4] / 255;
  const fromPixels = (pixels: Uint8ClampedArray) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    c.getContext('2d')?.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, size, size), 0, 0);
    return texture(c, THREE.NoColorSpace);
  };
  const rough = roughnessPixels(height, ROUGHNESS_VARIATION[kind]);
  const entry: DetailTextures = {
    map: texture(canvas, THREE.SRGBColorSpace),
    normal: fromPixels(heightToNormalPixels(height, size, RELIEF[kind])),
    roughness: fromPixels(rough.pixels),
    roughnessMean: rough.mean,
  };
  textureCache.set(kind, entry);
  return entry;
}

function texture(canvas: HTMLCanvasElement, colorSpace: THREE.ColorSpace): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

/** Texture slots of a realism material for a detail kind, each repeated `repeat` times per metre. */
function detailSlots(tex: DetailTextures | null, repeat: number, roughness: number) {
  if (!tex) return { map: null, roughness };
  return {
    map: withRepeat(tex.map, repeat),
    normalMap: withRepeat(tex.normal, repeat),
    roughnessMap: withRepeat(tex.roughness, repeat),
    // the map darkens roughness on average by its mean: compensate so the set value stays the average
    roughness: Math.min(1, roughness / tex.roughnessMean),
  };
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
      ...detailSlots(tex, repeat, m.roughness),
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
      : transparent && (opts.roughness ?? 0.7) <= GLASS_MAX_ROUGHNESS && !opts.emissive
        ? glassMaterial(color, opts.opacity ?? 1, opts.roughness ?? 0.05)
        : new THREE.MeshStandardMaterial({
          color,
          ...detailSlots(tex, rep, opts.roughness ?? 0.7),
          metalness: opts.metalness ?? 0,
          emissive: opts.emissive ?? '#000000',
          emissiveIntensity: opts.emissive ? 1 : 0,
          transparent,
          opacity: opts.opacity ?? 1,
          depthWrite: !transparent,
          side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
  if (mat instanceof THREE.MeshStandardMaterial && (mat.metalness >= METAL_THRESHOLD || mat.userData.glass)) registerMetal(mat);
  cache.set(key, mat);
  return mat;
}

/** Smooth, see-through surfaces up to this roughness are glass (windows, glass doors of furniture). */
const GLASS_MAX_ROUGHNESS = 0.1;

/**
 * Glass in realism mode (#192): the see-through part is attenuated by the opacity, but its
 * reflection is not – like real glass, which mirrors the room and the sky, more so at grazing
 * angles (Fresnel). Implemented with premultiplied alpha: the colour is written already
 * multiplied by the opacity, the specular part added unweakened. Reflection level and environment
 * come from the metal registry (see registerMetal), so they follow the time of day.
 */
export function glassMaterial(color: string, opacity: number, roughness: number): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    roughness,
    metalness: 0,
    ior: 1.5,
    transparent: true,
    opacity,
    depthWrite: false,
    premultipliedAlpha: true,
  });
  mat.userData.glass = true;
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4( totalDiffuse * diffuseColor.a + totalSpecular + totalEmissiveRadiance, diffuseColor.a );')
      .replace('#include <premultiplied_alpha_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'wp-glass';
  return mat;
}

/** Free all cached GPU materials and textures (e.g. when switching quality mode a lot). */
export function disposeMaterialCache() {
  for (const m of cache.values()) m.dispose();
  for (const t of textureCache.values()) {
    t.map.dispose();
    t.normal.dispose();
    t.roughness.dispose();
  }
  cache.clear();
  textureCache.clear();
  forgetMetals();
}
