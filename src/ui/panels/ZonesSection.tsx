import { useMemo } from "react";
import { derivePlan } from "../../model/derived";
import { zoneArea, zoneColor, zoneRoomId } from "../../model/zones";
import { useProjectStore } from "../../store/projectStore";
import { useUiStore } from "../../store/uiStore";
import { PanelGroup } from "../fields";

/**
 * Marked areas (#416): draw an area in the plan and write what it is for; the Claude furnishing
 * proposal plans it in (furniture of the area only inside it, everything else stays out).
 */
export function ZonesSection() {
  const project = useProjectStore((s) => s.project);
  const apply = useProjectStore((s) => s.apply);
  const tool = useUiStore((s) => s.tool);
  const setTool = useUiStore((s) => s.setTool);
  const derived = useMemo(() => derivePlan(project), [project]);
  const roomName = (id: string | null) =>
    id
      ? project.rooms.find((r) => r.id === id)?.name || "Raum"
      : "außerhalb der Räume";

  return (
    <PanelGroup groupKey="tools.zones" title="Bereiche für Claude" defaultOpen={false}>
      <p className="muted small">
        Bereich im Plan aufziehen und dazuschreiben, wofür er ist
        („Arbeitsecke“, „Essbereich“, „frei lassen“). Der Einrichtungsvorschlag
        mit Claude hält sich daran.
      </p>
      <div className="button-row">
        <button
          className={tool === "zone" ? "primary" : ""}
          onClick={() => setTool("zone")}
          data-testid="zone-tool"
        >
          Bereich markieren
        </button>
      </div>
      {project.zones.length === 0 && (
        <p className="muted small">Noch keine Bereiche.</p>
      )}
      {project.zones.map((z, i) => {
        const label = `Bereich ${i + 1}`;
        return (
          <div key={z.id} className="zone-row" data-testid="zone-row">
            <span
              className="zone-swatch"
              style={{ background: zoneColor(i) }}
              aria-hidden
            />
            <strong className="small">{i + 1}</strong>
            <input
              type="text"
              value={z.purpose}
              maxLength={200}
              placeholder="Wofür?"
              aria-label={`Zweck von ${label}`}
              title={`${roomName(zoneRoomId(project, derived, z))}, ${zoneArea(z).toFixed(1).replace(".", ",")} m²`}
              onChange={(e) =>
                apply((d) => {
                  const t = d.zones.find((x) => x.id === z.id);
                  if (t) t.purpose = e.target.value;
                })
              }
            />
            <button
              className="small danger"
              aria-label={`${label} löschen`}
              onClick={() =>
                apply(
                  (d) => void (d.zones = d.zones.filter((x) => x.id !== z.id)),
                )
              }
            >
              ×
            </button>
          </div>
        );
      })}
    </PanelGroup>
  );
}
