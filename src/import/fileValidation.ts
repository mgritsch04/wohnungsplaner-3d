export type PlanFileKind = 'pdf' | 'png' | 'jpeg';

export const MAX_PLAN_FILE_BYTES = 60 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 50_000_000;

export class PlanFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanFileError';
  }
}

/** Detect the real file type from its magic bytes (never trust the extension alone). */
export async function sniffPlanFile(file: Blob): Promise<PlanFileKind | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'; // %PDF
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  return null;
}

export async function validatePlanFile(file: File): Promise<PlanFileKind> {
  if (file.size === 0) throw new PlanFileError('Die Datei ist leer.');
  if (file.size > MAX_PLAN_FILE_BYTES) throw new PlanFileError(`Die Datei ist zu groß (${(file.size / 1048576).toFixed(1)} MB, max. ${MAX_PLAN_FILE_BYTES / 1048576} MB).`);
  const kind = await sniffPlanFile(file);
  if (!kind) throw new PlanFileError('Nicht unterstütztes Dateiformat. Erlaubt sind PDF, PNG und JPG.');
  return kind;
}
