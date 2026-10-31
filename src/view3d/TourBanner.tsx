import { useTourStore } from '../store/tourStore';

/** Shows which room the tour is in, plus an end button and a note about skipped rooms. */
export function TourBanner() {
  const plan = useTourStore((s) => s.plan);
  const playing = useTourStore((s) => s.playing);
  const stop = useTourStore((s) => s.stop);
  const error = useTourStore((s) => s.error);
  const end = useTourStore((s) => s.end);
  if (error && !playing) return <div className="tour-banner" data-testid="tour-banner" role="status">{error}</div>;
  if (!playing || !plan) return null;
  const s = plan.stops[stop];
  return (
    <div className="tour-banner" data-testid="tour-banner" role="status">
      <span>
        Rundgang: <strong data-testid="tour-room">{s?.name}</strong> ({stop + 1}/{plan.stops.length})
        {plan.skipped.length > 0 && ` · nicht erreichbar: ${plan.skipped.join(', ')}`}
      </span>
      <button type="button" onClick={end}>Beenden</button>
    </div>
  );
}
