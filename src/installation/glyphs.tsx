import type { FixtureKind } from '../model/schema';

/** Colour per kind of installation point (#64, #81): electrics warm, heating red, water blue. */
export const FIXTURE_COLOR: Record<FixtureKind, string> = {
  socket: '#ea580c',
  switch: '#7c3aed',
  radiator: '#dc2626',
  water: '#0284c7',
  drain: '#57534e',
};

/** Symbol of an installation point in a 24×24 box (stroke only). */
export function FixtureGlyph({ kind }: { kind: FixtureKind }) {
  switch (kind) {
    case 'socket':
      return (
        <>
          <circle cx={12} cy={12} r={8} />
          <circle cx={8.5} cy={12} r={1.2} fill="currentColor" />
          <circle cx={15.5} cy={12} r={1.2} fill="currentColor" />
        </>
      );
    case 'switch':
      return (
        <>
          <circle cx={9} cy={15} r={3} />
          <path d="M11 13 L18 6" />
        </>
      );
    case 'radiator':
      return <path d="M5 6v12M9.5 6v12M14.5 6v12M19 6v12M4 9h16M4 15h16" />;
    case 'water':
      return <path d="M12 4c3 4 6 7.5 6 10.5a6 6 0 0 1-12 0C6 11.5 9 8 12 4z" />;
    case 'drain':
      return (
        <>
          <circle cx={12} cy={12} r={8} />
          <path d="M12 7v9M8.5 12.5 12 16l3.5-3.5" />
        </>
      );
  }
}
