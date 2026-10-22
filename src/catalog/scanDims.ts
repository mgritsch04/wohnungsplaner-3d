export interface Dims {
  w: number;
  d: number;
  h: number;
}

export const SCAN_NOTE = 'Scan-Maße sind Schätzungen – bitte mit dem Maßband nachmessen und hier korrigieren.';

/** Set one dimension (meters); with `proportional` the other two follow the same factor. */
export function setDim(dims: Dims, axis: keyof Dims, value: number, proportional: boolean): Dims {
  if (!Number.isFinite(value) || value <= 0) return dims;
  const v = Math.min(value, 20);
  if (!proportional || dims[axis] <= 0) return { ...dims, [axis]: v };
  const k = v / dims[axis];
  return { w: dims.w * k, d: dims.d * k, h: dims.h * k, [axis]: v };
}
