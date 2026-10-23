import { compassName, compassOf } from '../model/daylight';

// Static rose (north arrow pointing up) as an <img>, so it is not picked up as a plan <svg>; rotated by CSS.
const ROSE_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='-30 -30 60 60'><circle r='27' fill='white' fill-opacity='.9' stroke='#888'/>" +
  "<polygon points='0,-14 6,10 0,5 -6,10' fill='#d33'/><text y='-16' font-size='11' font-weight='bold' text-anchor='middle' font-family='sans-serif' fill='#333'>N</text></svg>";
const ROSE_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(ROSE_SVG)}`;

/** Little compass: the red arrow shows where north lies in the plan (plan up = `north` degrees; #380). */
export function CompassRose({ north, size = 56, testId }: { north: number; size?: number; testId?: string }) {
  const label = `Norden liegt im Plan ${northSideLabel(north)}`;
  return (
    <span className="compass-rose" style={{ width: size, height: size }} data-testid={testId} role="img" aria-label={label} title={label}>
      <img src={ROSE_SRC} alt="" width={size} height={size} style={{ transform: `rotate(${-north}deg)` }} draggable={false} />
    </span>
  );
}

/** Where north lies relative to the plan: "oben", "rechts oben", "links" … */
export function northSideLabel(north: number): string {
  const b = (((-north) % 360) + 360) % 360; // screen angle of north, clockwise from up
  const names = ['oben', 'rechts oben', 'rechts', 'rechts unten', 'unten', 'links unten', 'links', 'links oben'];
  return names[Math.round(b / 45) % 8];
}

export { compassName, compassOf };
