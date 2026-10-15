import { memo, useMemo } from 'react';
import * as THREE from 'three';
import type { QualityMode } from '../model/schema';
import { getColorMaterial } from './materials3d';

/**
 * Procedural, primitive-based furniture models. All models are built in a local
 * frame with the origin at the footprint center on the floor, local X = width,
 * local Z = depth (+Z is the FRONT), Y = up. They are honest approximations.
 */
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const SPHERE = new THREE.SphereGeometry(0.5, 20, 14);
const CONE = new THREE.CylinderGeometry(0.25, 0.5, 1, 24, 1, true);
/** Cylinder whose axis is Z (for round fronts). */
const CYL_Z = new THREE.CylinderGeometry(0.5, 0.5, 1, 24).rotateX(Math.PI / 2);

type V3 = [number, number, number];
interface Part {
  geo: THREE.BufferGeometry;
  /** Center position. */
  p: V3;
  /** Scale (size for unit primitives). */
  s: V3;
  color: string;
  rough?: number;
  metal?: number;
  emissive?: string;
  opacity?: number;
}

function darker(hex: string, f: number): string {
  const c = new THREE.Color(hex).multiplyScalar(f);
  return `#${c.getHexString()}`;
}

/** Box from min corner (x0,y0,z0) to max corner. */
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string, extra: Partial<Part> = {}): Part => ({
  geo: BOX,
  p: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
  s: [Math.max(1e-3, x1 - x0), Math.max(1e-3, y1 - y0), Math.max(1e-3, z1 - z0)],
  color,
  ...extra,
});
const cyl = (x: number, y0: number, z: number, r: number, y1: number, color: string, extra: Partial<Part> = {}): Part => ({
  geo: CYL,
  p: [x, (y0 + y1) / 2, z],
  s: [r * 2, Math.max(1e-3, y1 - y0), r * 2],
  color,
  ...extra,
});

export function buildParts(shape: string, w: number, d: number, h: number, color: string, accent?: string): Part[] {
  const W = w / 2;
  const D = d / 2;
  const dark = darker(color, 0.75);
  const metal = '#9aa0a6';
  const front = accent ?? color;
  const legs = (top: number, inset = 0.04, t = 0.045, c = dark) =>
    [
      [-W + inset, -D + inset],
      [W - inset - t, -D + inset],
      [-W + inset, D - inset - t],
      [W - inset - t, D - inset - t],
    ].map(([x, z]) => box(x, 0, z, x + t, top, z + t, c));

  switch (shape) {
    case 'sofa':
    case 'armchair': {
      const seatH = Math.min(0.45, h * 0.55);
      const arm = Math.min(0.2, w * 0.12);
      return [
        box(-W, 0.06, -D, W, seatH - 0.12, D, dark),
        box(-W + arm, seatH - 0.12, -D + d * 0.25, W - arm, seatH, D - 0.02, color, { rough: 0.95 }),
        box(-W, 0.06, -D, W, h, -D + d * 0.25, color, { rough: 0.95 }),
        box(-W, 0.06, -D, -W + arm, seatH + 0.15, D, color, { rough: 0.95 }),
        box(W - arm, 0.06, -D, W, seatH + 0.15, D, color, { rough: 0.95 }),
        ...legs(0.06, 0.05, 0.04, '#3a3a3a'),
      ];
    }
    case 'sofa-corner': {
      const seatH = 0.45;
      const back = Math.min(0.25, d * 0.18);
      const chaise = Math.min(0.95, w * 0.4);
      return [
        box(-W, 0.06, -D, W, seatH, -D + 0.95, color, { rough: 0.95 }),
        box(W - chaise, 0.06, -D, W, seatH, D, color, { rough: 0.95 }),
        box(-W, 0.06, -D, W, h, -D + back, color, { rough: 0.95 }),
        box(W - back, 0.06, -D, W, h, D, color, { rough: 0.95 }),
        box(-W, 0.06, -D, -W + 0.18, seatH + 0.15, -D + 0.95, color, { rough: 0.95 }),
      ];
    }
    case 'bed': {
      const frameH = 0.3;
      return [
        box(-W, 0.05, -D, W, frameH, D, dark),
        box(-W + 0.03, frameH, -D + 0.08, W - 0.03, frameH + 0.2, D - 0.03, '#f4f2ee', { rough: 1 }),
        box(-W, 0.05, -D, W, h, -D + 0.07, dark),
        box(-W + 0.08, frameH + 0.2, -D + 0.12, -0.04, frameH + 0.32, -D + 0.5, '#ffffff', { rough: 1 }),
        box(0.04, frameH + 0.2, -D + 0.12, W - 0.08, frameH + 0.32, -D + 0.5, '#ffffff', { rough: 1 }),
        box(-W + 0.02, frameH + 0.2, -D + 0.6, W - 0.02, frameH + 0.25, D - 0.01, color, { rough: 1 }),
      ];
    }
    case 'table':
    case 'desk':
      return [box(-W, h - 0.04, -D, W, h, D, color, { rough: 0.5 }), ...legs(h - 0.04, 0.03, 0.05)];
    case 'table-round':
      return [
        cyl(0, h - 0.04, 0, Math.min(w, d) / 2, h, color, { rough: 0.5 }),
        cyl(0, 0, 0, 0.05, h - 0.04, dark),
        cyl(0, 0, 0, Math.min(w, d) * 0.22, 0.03, dark),
      ];
    case 'chair':
      return [
        box(-W, 0.43, -D, W, 0.47, D, color),
        box(-W, 0.47, -D, W, h, -D + 0.04, color),
        ...legs(0.43, 0.02, 0.035),
      ];
    case 'office-chair':
      return [
        box(-W * 0.75, 0.45, -D * 0.75, W * 0.75, 0.52, D * 0.75, color),
        box(-W * 0.7, 0.55, -D * 0.75, W * 0.7, h, -D * 0.6, color),
        cyl(0, 0.08, 0, 0.03, 0.45, metal, { metal: 0.8, rough: 0.3 }),
        cyl(0, 0.03, 0, W * 0.9, 0.08, '#222222'),
      ];
    case 'stool':
      return [cyl(0, h - 0.05, 0, Math.min(w, d) / 2, h, color), cyl(0, 0, 0, 0.03, h - 0.05, metal, { metal: 0.8, rough: 0.3 }), cyl(0, 0, 0, Math.min(w, d) * 0.4, 0.02, metal, { metal: 0.8 })];
    case 'wardrobe':
    case 'k-tall': {
      const doors = Math.max(1, Math.round(w / 0.5));
      const parts: Part[] = [box(-W, 0, -D, W, h, D - 0.02, color)];
      for (let i = 0; i < doors; i++) {
        const x0 = -W + (i * w) / doors + 0.003;
        const x1 = -W + ((i + 1) * w) / doors - 0.003;
        parts.push(box(x0, 0.01, D - 0.02, x1, h - 0.01, D, front));
        const hx = i % 2 === 0 ? x1 - 0.05 : x0 + 0.04;
        parts.push(box(hx, h * 0.45, D, hx + 0.012, h * 0.45 + 0.25, D + 0.025, metal, { metal: 0.8, rough: 0.3 }));
      }
      return parts;
    }
    case 'shelf': {
      const t = 0.02;
      const n = Math.max(2, Math.round(h / 0.36));
      const parts: Part[] = [box(-W, 0, -D, -W + t, h, D, color), box(W - t, 0, -D, W, h, D, color), box(-W, 0, -D, W, h, -D + 0.008, darker(color, 0.92))];
      for (let i = 0; i <= n; i++) {
        const y = Math.min(h - t, (i * (h - t)) / n);
        parts.push(box(-W + t, y, -D, W - t, y + t, D, color));
      }
      return parts;
    }
    case 'cabinet':
    case 'dresser':
    case 'k-base':
    case 'k-wall':
    case 'k-sink':
    case 'k-dishwasher': {
      const isKitchenFloor = shape === 'k-base' || shape === 'k-sink' || shape === 'k-dishwasher';
      const plinth = isKitchenFloor ? 0.1 : shape === 'k-wall' ? 0 : 0.04;
      const parts: Part[] = [box(-W, plinth, -D, W, h, D - 0.02, color)];
      if (plinth > 0) parts.push(box(-W + 0.01, 0, -D, W - 0.01, plinth, D - 0.06, '#333333'));
      const drawers = shape === 'dresser' ? 4 : 0;
      if (drawers > 0) {
        for (let i = 0; i < drawers; i++) {
          const y0 = plinth + ((h - plinth) * i) / drawers + 0.003;
          const y1 = plinth + ((h - plinth) * (i + 1)) / drawers - 0.003;
          parts.push(box(-W + 0.003, y0, D - 0.02, W - 0.003, y1, D, front));
          parts.push(box(-0.08, (y0 + y1) / 2 - 0.006, D, 0.08, (y0 + y1) / 2 + 0.006, D + 0.02, metal, { metal: 0.8, rough: 0.3 }));
        }
      } else {
        const doors = Math.max(1, Math.round(w / 0.6));
        for (let i = 0; i < doors; i++) {
          const x0 = -W + (i * w) / doors + 0.003;
          const x1 = -W + ((i + 1) * w) / doors - 0.003;
          parts.push(box(x0, plinth + 0.003, D - 0.02, x1, h - 0.003, D, front));
          const hy = shape === 'k-wall' ? plinth + 0.06 : h - 0.08;
          parts.push(box((x0 + x1) / 2 - 0.08, hy, D, (x0 + x1) / 2 + 0.08, hy + 0.012, D + 0.02, metal, { metal: 0.8, rough: 0.3 }));
        }
      }
      return parts;
    }
    case 'k-oven':
      return [
        box(-W, 0.1, -D, W, h, D - 0.02, color),
        box(-W + 0.01, 0, -D, W - 0.01, 0.1, D - 0.06, '#333333'),
        box(-W + 0.01, 0.12, D - 0.02, W - 0.01, h - 0.2, D, '#1a1a1a', { rough: 0.15, metal: 0.3 }),
        box(-W + 0.01, h - 0.19, D - 0.02, W - 0.01, h - 0.01, D, '#2e2e30'),
        box(-W + 0.08, h - 0.26, D, W - 0.08, h - 0.245, D + 0.03, metal, { metal: 0.9, rough: 0.2 }),
      ];
    case 'k-cooktop':
      return [
        box(-W, 0, -D, W, Math.max(0.006, Math.min(h, 0.01)), D, '#111111', { rough: 0.1 }),
        ...[[-0.25, -0.22], [0.25, -0.22], [-0.25, 0.22], [0.25, 0.22]].map(([x, z]) => cyl(x * w, 0.0, z * d, Math.min(w, d) * 0.15, 0.012, '#3a3a3a')),
      ];
    case 'k-fridge':
      return [
        box(-W, 0, -D, W, h, D - 0.02, color, { rough: 0.3, metal: 0.2 }),
        box(-W + 0.003, h * 0.62, D - 0.02, W - 0.003, h - 0.003, D, color, { rough: 0.3 }),
        box(-W + 0.003, 0.01, D - 0.02, W - 0.003, h * 0.62 - 0.006, D, color, { rough: 0.3 }),
        box(W - 0.06, h * 0.68, D, W - 0.045, h * 0.9, D + 0.03, metal, { metal: 0.9 }),
        box(W - 0.06, h * 0.4, D, W - 0.045, h * 0.58, D + 0.03, metal, { metal: 0.9 }),
      ];
    case 'k-hood':
      return [box(-W, 0, -D, W, 0.08, D, color, { metal: 0.7, rough: 0.3 }), box(-0.14, 0.08, -D, 0.14, h, -D + 0.25, color, { metal: 0.7, rough: 0.3 })];
    case 'countertop':
      return [box(-W, 0, -D, W, h, D, color, { rough: 0.35 })];
    case 'washer':
      return [
        box(-W, 0, -D, W, h, D, color),
        { geo: CYL_Z, p: [0, h * 0.45, D + 0.01], s: [0.36, 0.36, 0.02], color: '#a0a8b0', rough: 0.2, metal: 0.4 },
        box(-W + 0.02, h - 0.1, D, W - 0.02, h - 0.02, D + 0.005, '#d0d4d8'),
      ];
    case 'floor-lamp':
      return [
        cyl(0, 0, 0, Math.min(w, d) * 0.4, 0.03, '#222222'),
        cyl(0, 0.03, 0, 0.012, h - 0.25, '#222222', { metal: 0.6 }),
        { geo: CONE, p: [0, h - 0.15, 0], s: [Math.min(w, d), 0.3, Math.min(w, d)], color: '#f3ead8', emissive: '#ffdca8' },
      ];
    case 'table-lamp':
      return [cyl(0, 0, 0, Math.min(w, d) * 0.3, h * 0.55, color), { geo: CONE, p: [0, h * 0.75, 0], s: [Math.min(w, d), h * 0.45, Math.min(w, d)], color: '#f3ead8', emissive: '#ffdca8' }];
    case 'pendant':
      return [cyl(0, h * 0.4, 0, 0.004, h, '#111111'), { geo: CONE, p: [0, h * 0.2, 0], s: [Math.min(w, d), h * 0.4, Math.min(w, d)], color, emissive: '#ffdca8' }];
    case 'rug':
      return [box(-W, 0, -D, W, Math.max(0.005, h), D, color, { rough: 1 })];
    case 'curtain': {
      const folds = Math.max(3, Math.round(w / 0.12));
      const parts: Part[] = [];
      for (let i = 0; i < folds; i++) {
        const x0 = -W + (i * w) / folds;
        const z = i % 2 === 0 ? -D : -D + d * 0.5;
        parts.push(box(x0, 0.02, z, x0 + w / folds + 0.01, h, z + d * 0.5, color, { rough: 1 }));
      }
      return parts;
    }
    case 'plant': {
      const r = Math.min(w, d) / 2;
      return [
        cyl(0, 0, 0, r * 0.55, Math.min(0.35, h * 0.3), '#8a6a52'),
        { geo: SPHERE, p: [0, h * 0.62, 0], s: [r * 2, h * 0.75, r * 2], color, rough: 1 },
      ];
    }
    case 'tv':
      return [box(-W, 0, -D, W, h, D, '#0d0d0d', { rough: 0.2, metal: 0.3 }), box(-W + 0.01, 0.01, D, W - 0.01, h - 0.01, D + 0.001, '#1d2633', { rough: 0.05 })];
    case 'panel':
      return [box(-W, 0, -D, W, h, D, color, { rough: 0.05, metal: 0.9 })];
    case 'toilet':
      return [
        { geo: SPHERE, p: [0, 0.38, D * 0.15], s: [w * 0.95, 0.3, d * 0.75], color: '#ffffff', rough: 0.2 },
        box(-W, 0.25, -D, W, 0.4, -D + 0.18, '#ffffff', { rough: 0.2 }),
        box(-W * 0.9, 0.85, -D, W * 0.9, 0.9, -D + 0.02, '#e5e7eb'),
        box(-W, 0.4, -D, W, h, -D + 0.12, '#f3f4f6', { rough: 0.3 }),
      ];
    case 'washbasin':
      return [
        box(-W, 0.35, -D, W, h - 0.15, D - 0.02, '#e9e3da'),
        box(-W, h - 0.15, -D, W, h, D, '#ffffff', { rough: 0.15 }),
        box(-W * 0.6, h - 0.002, -D * 0.4, W * 0.6, h + 0.001, D * 0.6, '#dfe5ea', { rough: 0.1 }),
        cyl(0, h, -D * 0.6, 0.015, h + 0.2, metal, { metal: 0.9, rough: 0.2 }),
      ];
    case 'bathtub':
      return [box(-W, 0, -D, W, h, D, '#ffffff', { rough: 0.15 }), box(-W + 0.07, h - 0.4, -D + 0.07, W - 0.07, h + 0.001, D - 0.07, '#e7eef2', { rough: 0.1 })];
    case 'shower':
      return [
        box(-W, 0, -D, W, 0.05, D, '#ffffff', { rough: 0.2 }),
        box(-W, 0.05, D - 0.01, W, h, D, '#cfe3ea', { opacity: 0.3, rough: 0.05 }),
        box(W - 0.01, 0.05, -D, W, h, D, '#cfe3ea', { opacity: 0.3, rough: 0.05 }),
        cyl(-W + 0.1, h - 0.1, -D + 0.1, 0.1, h - 0.08, metal, { metal: 0.9 }),
      ];
    default:
      return [box(-W, 0, -D, W, h, D, color)];
  }
}

export const ProceduralModel = memo(function ProceduralModel({
  shape,
  width,
  depth,
  height,
  color,
  accent,
  quality,
  castShadow,
}: {
  shape: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  accent?: string;
  quality: QualityMode;
  castShadow: boolean;
}) {
  const parts = useMemo(() => buildParts(shape, width, depth, height, color, accent), [shape, width, depth, height, color, accent]);
  return (
    <group>
      {parts.map((p, i) => (
        <mesh
          key={i}
          geometry={p.geo}
          position={p.p}
          scale={p.s}
          material={getColorMaterial(p.color, quality, { roughness: p.rough, metalness: p.metal, emissive: p.emissive, opacity: p.opacity })}
          castShadow={castShadow && (p.opacity ?? 1) === 1}
          receiveShadow={castShadow}
        />
      ))}
    </group>
  );
});
