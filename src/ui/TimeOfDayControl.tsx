import { useRef } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { TIME_PRESETS } from '../view3d/lighting';
import { useGraphicsTier, useGraphicsTierStore, type GraphicsTierPref } from '../view3d/graphicsTier';

const fmt = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

function setTimeOfDay(h: number) {
  const v = Math.max(0, Math.min(24, h));
  if (v !== useProjectStore.getState().project.settings.timeOfDay) {
    useProjectStore.getState().apply((d) => void (d.settings.timeOfDay = v));
  }
}

/** Preset times (morning, noon, night …); in the toolbar they sit in the "Mehr" menu (#100). */
export function TimePresetSelect() {
  return (
    <select
      value=""
      aria-label="Tageszeit-Voreinstellung"
      onChange={(e) => {
        if (e.target.value) setTimeOfDay(Number(e.target.value));
      }}
    >
      <option value="">Zeit…</option>
      {TIME_PRESETS.map((p) => (
        <option key={p.label} value={p.hour}>
          {p.label} ({fmt(p.hour)})
        </option>
      ))}
    </select>
  );
}

/** Lamps automatic / on / off; in the toolbar they sit in the "Mehr" menu (#100). */
export function LampsSelect() {
  const lamps = useProjectStore((s) => s.project.settings.lamps);
  return (
    <select
      value={lamps}
      aria-label="Lampen"
      title="Lampen (Stehlampen, Tischlampen, platzierte Lichtquellen, Raumlicht): automatisch ab der Dämmerung, immer an oder aus"
      onChange={(e) => {
        const v = e.target.value as typeof lamps;
        useProjectStore.getState().apply((d) => void (d.settings.lamps = v));
      }}
    >
      <option value="auto">💡 Lampen: automatisch</option>
      <option value="on">💡 Lampen: an</option>
      <option value="off">💡 Lampen: aus</option>
    </select>
  );
}

/** Graphics level of realism mode on this device (#192); "automatisch" shows what it picked. */
export function GraphicsTierSelect() {
  const pref = useGraphicsTierStore((s) => s.pref);
  const tier = useGraphicsTier();
  return (
    <select
      value={pref}
      aria-label="Grafikqualität"
      title="Grafikqualität auf diesem Gerät: „Hoch“ zeigt feinere Spiegelungen und Schatten, braucht aber eine starke Grafikkarte (PC). Automatisch wählt „Hoch“ nur am PC mit Grafikkarte."
      onChange={(e) => useGraphicsTierStore.getState().setPref(e.target.value as GraphicsTierPref)}
    >
      <option value="auto">🖥️ Grafik: automatisch ({tier === 'high' ? 'hoch' : 'normal'})</option>
      <option value="high">🖥️ Grafik: hoch</option>
      <option value="normal">🖥️ Grafik: normal</option>
    </select>
  );
}

/**
 * Time-of-day slider with presets. While dragging, the value only goes to a light
 * preview channel that the lighting reads every frame (no project clone, no app
 * re-render); on release it is written to the project as one undo step.
 * The compact toolbar variant shows only the slider; presets and lamps are in the
 * toolbar's "Mehr" menu (#100) and in the project panel.
 */
export function TimeOfDayControl({ compact = false }: { compact?: boolean }) {
  const saved = useProjectStore((s) => s.project.settings.timeOfDay);
  const preview = useUiStore((s) => s.timePreview);
  const hour = preview ?? saved;
  const dragging = useRef(false);
  const commit = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const v = useUiStore.getState().timePreview;
    if (v !== null) setTimeOfDay(v);
    useUiStore.getState().setTimePreview(null);
  };
  return (
    <div className={`time-control ${compact ? 'compact' : ''}`} title="Tageszeit für Licht und Schatten (Realismusmodus)">
      <span className="time-label" aria-hidden>
        {hour >= 6 && hour < 20 ? '☀' : '☾'} {fmt(hour)}
      </span>
      <input
        type="range"
        min={0}
        max={24}
        step={0.25}
        value={hour}
        aria-label="Tageszeit"
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={commit}
        onPointerCancel={commit}
        onLostPointerCapture={commit}
        onBlur={commit}
        onChange={(e) => {
          const v = Number(e.target.value);
          // pointer drag: preview only; keyboard: write directly (one step per key press)
          if (dragging.current) useUiStore.getState().setTimePreview(v);
          else setTimeOfDay(v);
        }}
      />
      {!compact && (
        <>
          <TimePresetSelect />
          <LampsSelect />
        </>
      )}
    </div>
  );
}
