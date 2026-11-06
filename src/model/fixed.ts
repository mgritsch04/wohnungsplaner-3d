import type { Furniture } from './schema';

/**
 * A piece the furnishing suggestion must plan around and never move (#493): fitted pieces
 * (`existing`, e.g. bath, kitchen) and pieces the user marked as a fixed given (own bike, desk of
 * another maker, a poster on a chosen wall). Both count as obstacles, relation targets and
 * "already there" for the room's must-haves.
 */
export const isFixedPiece = (f: Pick<Furniture, 'existing' | 'fixed'>): boolean => f.existing || f.fixed === true;
