/**
 * IKEA 3D model variants as declared on IKEA product pages (schema.org 3DModel,
 * verified 2026-10-16 on IKEA Austria). Asset URLs look like
 *   https://web-api.ikea.com/dimma/assets/1.2/{itemNo}/{set}/{quality}/{format}/{hash}-….glb
 * with quality iqp1–3 / rqp1–3 (and "simple" for an alternative source) and format
 * glb, glb_draco or gltf. Observed sizes (KALLAX 104.099.32, Draco): iqp3 2.8 MB,
 * iqp2 1.9 MB, iqp1 0.6 MB, rqp3 0.34 MB, rqp1 0.12 MB. Not every product has iqp
 * variants (ENHET 106.230.36: rqp only). The meaning of the quality codes is not
 * documented by IKEA; "higher number = more detail" is inferred from file sizes.
 */
export interface IkeaModelVariant {
  url: string;
  itemNo: string | null;
  quality: string | null;
  format: string | null;
}

const RE = /\/dimma\/assets\/[^/]+\/(\d{8})\/[^/]+\/([a-z]+\d?)\/(glb_draco|glb|gltf)\//i;

export function describeIkeaModelUrl(url: string): IkeaModelVariant {
  const m = url.match(RE);
  return { url, itemNo: m?.[1] ?? null, quality: m?.[2]?.toLowerCase() ?? null, format: m?.[3]?.toLowerCase() ?? null };
}

/** Preferred quality levels: detailed but not the heaviest variant first. */
const QUALITY_ORDER = ['iqp2', 'iqp3', 'iqp1', 'rqp3', 'rqp2', 'rqp1', 'simple'];
/** Single-file formats only; Draco (smaller) first – the app ships its own decoder. */
const FORMAT_ORDER = ['glb_draco', 'glb'];

/** Choose the variant the planner should use; null if none is a single-file GLB. */
export function pickIkeaModel(candidates: string[]): string | null {
  const scored = candidates
    .map(describeIkeaModelUrl)
    .filter((v) => v.format && FORMAT_ORDER.includes(v.format))
    .map((v) => {
      const q = QUALITY_ORDER.indexOf(v.quality ?? '');
      return { v, score: (q < 0 ? QUALITY_ORDER.length : q) * 10 + FORMAT_ORDER.indexOf(v.format!) };
    })
    .sort((a, b) => a.score - b.score);
  return scored[0]?.v.url ?? null;
}
