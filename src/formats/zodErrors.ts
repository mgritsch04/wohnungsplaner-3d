import type { z } from 'zod';

/** Human-readable German error list from a Zod error (max. n entries). */
export function formatZodError(err: z.ZodError, max = 8): string[] {
  const lines = err.issues.slice(0, max).map((i) => {
    const path = i.path.length ? i.path.join('.') : '(Wurzel)';
    return `${path}: ${i.message}`;
  });
  if (err.issues.length > max) lines.push(`… und ${err.issues.length - max} weitere Fehler`);
  return lines;
}

export class FileFormatError extends Error {
  details: string[];
  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = 'FileFormatError';
    this.details = details;
  }
}
