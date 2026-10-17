import type { SmartDeviceKind } from '../model/schema';

/** Colour per device kind (2D, 3D, panel). */
export const KIND_COLOR: Record<SmartDeviceKind, string> = { motion: '#7c3aed', presence: '#9333ea', contact: '#0891b2', light: '#ca8a04', plug: '#475569' };

/** Symbol of a device kind in a 24×24 box, drawn with `currentColor` strokes (#233). */
export function GlyphPaths({ kind }: { kind: SmartDeviceKind }) {
  switch (kind) {
    case 'motion':
      return (
        <>
          <circle cx={12} cy={17} r={2.2} />
          <path d="M7.5 12.5a6.4 6.4 0 0 1 9 0M4.5 9.2a10.6 10.6 0 0 1 15 0" />
        </>
      );
    case 'presence':
      return (
        <>
          <circle cx={12} cy={7.5} r={3.2} />
          <path d="M5.5 20c0-4 3-6.2 6.5-6.2s6.5 2.2 6.5 6.2" />
        </>
      );
    case 'contact':
      return (
        <>
          <rect x={4.5} y={4} width={6} height={16} rx={1} />
          <rect x={13.5} y={4} width={6} height={16} rx={1} />
        </>
      );
    case 'light':
      return (
        <>
          <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.7.5 1.2 1.3 1.2 2.1V16h4v-.4c0-.8.5-1.6 1.2-2.1A5.5 5.5 0 0 0 12 3.5Z" />
          <path d="M10 19h4M10.6 21.5h2.8" />
        </>
      );
    case 'plug':
      return (
        <>
          <rect x={4.5} y={4.5} width={15} height={15} rx={4} />
          <path d="M9.5 10.5v3M14.5 10.5v3" />
        </>
      );
  }
}

/** Device symbol as an inline icon for buttons and lists. */
export function DeviceGlyph({ kind, size = 20 }: { kind: SmartDeviceKind; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <GlyphPaths kind={kind} />
    </svg>
  );
}
