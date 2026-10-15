import type { Project } from '../../model/schema';
import { FileFormatError } from '../zodErrors';
import { parseProject, type ParsedProject } from './projectFile';

/**
 * Portable project package (*.wohnplan.json)
 * ------------------------------------------
 * A single JSON file containing the project plus every referenced binary asset
 * (floor-plan underlay image, original PDF, GLB models) as base64. This keeps
 * exported projects self-contained without a ZIP dependency.
 */
export const PACKAGE_FORMAT = 'wohnungsplaner-package';
export const PACKAGE_VERSION = 1;

export interface PackageAsset {
  mimeType: string;
  /** base64 encoded bytes */
  data: string;
}

export interface ProjectPackage {
  format: typeof PACKAGE_FORMAT;
  packageVersion: number;
  exportedAt: string;
  project: Project;
  assets: Record<string, PackageAsset>;
}

/** All asset ids referenced by a project. */
export function referencedAssetIds(p: Project): string[] {
  const ids = new Set<string>();
  if (p.underlay) {
    ids.add(p.underlay.imageAssetId);
    if (p.underlay.sourceAssetId) ids.add(p.underlay.sourceAssetId);
  }
  for (const f of p.furniture) if (f.model.type === 'gltf' && f.model.assetId) ids.add(f.model.assetId);
  return [...ids];
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

export function base64ToBlob(b64: string, mimeType: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function buildPackage(p: Project, getAsset: (id: string) => Promise<Blob | undefined>): Promise<{ pkg: ProjectPackage; missing: string[] }> {
  const assets: Record<string, PackageAsset> = {};
  const missing: string[] = [];
  for (const id of referencedAssetIds(p)) {
    const blob = await getAsset(id);
    if (!blob) {
      missing.push(id);
      continue;
    }
    assets[id] = { mimeType: blob.type || 'application/octet-stream', data: await blobToBase64(blob) };
  }
  return { pkg: { format: PACKAGE_FORMAT, packageVersion: PACKAGE_VERSION, exportedAt: new Date().toISOString(), project: p, assets }, missing };
}

export interface ParsedPackage extends ParsedProject {
  assets: Record<string, Blob>;
}

/** Accepts a package file OR a bare project file. */
export function parsePackageOrProject(text: string): ParsedPackage {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new FileFormatError('Die Datei ist kein gültiges JSON.', [e instanceof Error ? e.message : String(e)]);
  }
  if (raw && typeof raw === 'object' && (raw as { format?: unknown }).format === PACKAGE_FORMAT) {
    const pkg = raw as Partial<ProjectPackage>;
    if (typeof pkg.packageVersion !== 'number' || pkg.packageVersion > PACKAGE_VERSION) {
      throw new FileFormatError('Nicht unterstützte Paketversion.');
    }
    const parsed = parseProject(pkg.project);
    const assets: Record<string, Blob> = {};
    const warnings = [...parsed.warnings];
    for (const [id, a] of Object.entries(pkg.assets ?? {})) {
      try {
        assets[id] = base64ToBlob(a.data, a.mimeType);
      } catch {
        warnings.push(`Asset ${id} konnte nicht gelesen werden.`);
      }
    }
    for (const id of referencedAssetIds(parsed.project)) if (!assets[id]) warnings.push(`Asset ${id} fehlt im Paket (z. B. Grundriss-Bild).`);
    return { ...parsed, warnings, assets };
  }
  return { ...parseProject(raw), assets: {} };
}
