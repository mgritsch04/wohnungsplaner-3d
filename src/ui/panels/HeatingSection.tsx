import { useMemo } from 'react';
import { derivePlan } from '../../model/derived';
import { HEATING_SOURCES, INSULATION, estimateHeating, type HeatingSource, type Insulation } from '../../model/heating';
import { useProjectStore } from '../../store/projectStore';
import { SelectField, Section } from '../fields';

const fmt = (n: number, digits = 0) => n.toLocaleString('de-AT', { maximumFractionDigits: digits });

/** Rough heating-cost estimate from floor area, insulation standard and window share (#90). */
export function HeatingSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const est = useMemo(() => estimateHeating(project, derivePlan(project)), [project]);
  const { insulation, heatingSource } = project.settings;
  const src = HEATING_SOURCES.find((x) => x.id === heatingSource)!;

  return (
    <Section title="Heizkosten (grobe Schätzung)">
      <SelectField
        label="Dämmstandard"
        value={insulation}
        options={INSULATION.map((x) => ({ value: x.id as string, label: `${x.label} (ca. ${x.kwh} kWh/m²a)` }))}
        onChange={(v) => apply((d) => void (d.settings.insulation = v as Insulation))}
      />
      <SelectField
        label="Heizung"
        value={heatingSource}
        options={HEATING_SOURCES.map((x) => ({ value: x.id as string, label: x.label }))}
        onChange={(v) => apply((d) => void (d.settings.heatingSource = v as HeatingSource))}
      />
      {est.area <= 0 ? (
        <p className="muted small">Noch keine beheizten Räume.</p>
      ) : (
        <>
          <p className="small" data-testid="heating-estimate">
            Etwa <strong>{fmt(Math.round(est.eurPerYear / 10) * 10)} € pro Jahr</strong> (Richtwert, kein Angebot)
          </p>
          <p className="muted small">
            Annahmen: {fmt(est.area, 1)} m² beheizte Fläche (ohne Balkon/Terrasse) · Fenster {fmt(est.windowArea, 1)} m² in Außenwänden = {fmt(est.windowShare * 100)} % der Fläche (Faktor {fmt(est.windowFactor, 2)}) · ca. {fmt(est.kwhPerM2)} kWh/m² und Jahr, zusammen {fmt(est.kwhPerYear)} kWh · {src.label} mit {fmt(src.price * 100)} ct/kWh Wärme.
          </p>
        </>
      )}
      <p className="muted small">Grobe Orientierung mit typischen Werten, keine Energieberatung und keine Normrechnung. Tatsächliche Kosten hängen von Wohnverhalten, Lage, Klima und Energiepreisen ab.</p>
    </Section>
  );
}
