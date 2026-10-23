import { compassName, compassOf } from '../model/daylight';

/** Little compass: the N arrow shows where north lies in the plan (plan up = `north` degrees; #380). */
export function CompassRose({ north, size = 56, testId }: { north: number; size?: number; testId?: string }) {
  const label = `Norden liegt im Plan ${northSideLabel(north)}`;
  return (
    <svg className="compass-rose" width={size} height={size} viewBox="-30 -30 60 60" role="img" aria-label={label} data-testid={testId}>
      <title>{label}</title>
      <circle r="27" fill="var(--panel-bg, #fff)" fillOpacity="0.85" stroke="currentColor" strokeOpacity="0.4" />
      <g transform={`rotate(${-north})`}>
        <polygon points="0,-22 6,2 0,-3 -6,2" fill="#d33" />
        <polygon points="0,22 5,0 0,3 -5,0" fill="currentColor" fillOpacity="0.35" />
        <text y="-24.5" fontSize="10" fontWeight="700" textAnchor="middle" fill="currentColor" transform="translate(0,0)">N</text>
      </g>
    </svg>
  );
}

/** Where north lies relative to the plan: "oben", "rechts oben", "links" … */
export function northSideLabel(north: number): string {
  const b = (((-north) % 360) + 360) % 360; // screen angle of north, clockwise from up
  const names = ['oben', 'rechts oben', 'rechts', 'rechts unten', 'unten', 'links unten', 'links', 'links oben'];
  return names[Math.round(b / 45) % 8];
}

export { compassName, compassOf };
