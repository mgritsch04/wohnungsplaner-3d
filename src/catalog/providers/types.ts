/**
 * Normalized product model shared by all retailer/product providers.
 * Providers live outside the geometry core; they only produce catalog entries.
 */
export type FieldStatus =
  /** taken directly from the retailer's structured data or page text */
  | 'source'
  /** entered or corrected by the user */
  | 'user'
  /** not available – must not be guessed */
  | 'missing';

export interface ProductDimensions {
  /** centimetres */
  width: number | null;
  depth: number | null;
  height: number | null;
  status: { width: FieldStatus; depth: FieldStatus; height: FieldStatus };
  /** original text the values were parsed from, for transparency */
  sourceText?: string;
}

export interface NormalizedProduct {
  provider: string;
  /** retailer-specific identifier (e.g. SKU from structured data) */
  sourceId: string | null;
  articleNumber: string | null;
  name: string | null;
  brand: string | null;
  dimensions: ProductDimensions;
  price: { amount: number; currency: string; status: FieldStatus } | null;
  productUrl: string | null;
  imageUrl: string | null;
  /** only set when a model URL is explicitly provided and licensed for use */
  modelUrl: string | null;
  variant: string | null;
  /** availability exactly as stated by the source (schema.org value), never inferred */
  availability: string | null;
  /** ISO timestamp of when the data was retrieved/pasted */
  retrievedAt: string;
  /** overall quality: verified only when all dimensions + price come from the source */
  quality: 'complete-from-source' | 'partial' | 'insufficient';
  licenseNote: string;
  warnings: string[];
}

export interface ProductProviderInfo {
  id: string;
  label: string;
  /** Hostnames this provider recognises. */
  hosts: string[];
  /** Live lookup over the network is only possible via an authorized API. */
  liveLookup: 'available' | 'unavailable';
  liveLookupNote: string;
  /** Extract the article number from a product URL, if the URL format allows it. */
  articleNumberFromUrl?: (url: URL) => string | null;
  licenseNote: string;
}
