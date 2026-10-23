import type { Opening, Shading } from './schema';

/** Window covering helpers (#413): roller shutter, venetian blind, pleated blind, curtains. */

export const SHADING_LABEL: Record<Shading['type'], string> = { roller: 'Rollladen', venetian: 'Raffstore / Jalousie', pleated: 'Plissee' };

export const SHADING_TYPES = Object.keys(SHADING_LABEL) as Shading['type'][];

/** Window or glass door – the openings that can carry a covering. */
export const canHaveShading = (o: Pick<Opening, 'kind'>): boolean => o.kind === 'window';

/** Words for a closing degree: offen / halb / zu. */
export function closedLabel(closed: number): string {
  if (closed < 0.05) return 'offen';
  if (closed > 0.95) return 'zu';
  return `${Math.round(closed * 100)} % zu`;
}

/** Click cycle: offen → halb → zu → offen. */
export function nextClosed(closed: number): number {
  if (closed < 0.25) return 0.5;
  if (closed < 0.75) return 1;
  return 0;
}

/** Share of the daylight a covering lets through (guide value). */
export function transmission(shading: Pick<Shading, 'type' | 'closed'> | undefined): number {
  if (!shading) return 1;
  const tight = shading.type === 'roller' ? 0.02 : shading.type === 'venetian' ? 0.12 : 0.2;
  return 1 - shading.closed * (1 - tight);
}

/** Displayed width of a curtain: drawn open it is gathered at one side. */
export const curtainShownWidth = (width: number, closed: number | undefined): number => width * (0.25 + 0.75 * (closed ?? 0));
