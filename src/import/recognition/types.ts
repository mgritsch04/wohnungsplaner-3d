import type { RasterOutput } from './raster';

/**
 * Adapter interface for floor-plan recognizers. Local recognizers run in the
 * browser; a future remote/AI recognizer must implement the same interface,
 * run behind a server-side proxy (no API keys in the client) and must only be
 * invoked after explicit user consent to upload the plan.
 */
export interface RecognitionInput {
  /** Image to analyze (rendered underlay). */
  image: Blob;
  pixelWidth: number;
  pixelHeight: number;
  metersPerPixel: number;
  /** Vector segments from a PDF, in underlay pixel coordinates (if available). */
  vectorSegments?: { x1: number; y1: number; x2: number; y2: number; areaFill?: boolean; darkFill?: boolean }[];
}

export interface FloorPlanRecognizer {
  id: string;
  label: string;
  /** true = runs locally, nothing leaves the device. */
  local: boolean;
  canHandle: (input: RecognitionInput) => boolean;
  recognize: (input: RecognitionInput, onProgress: (p: number) => void) => Promise<RasterOutput>;
}
