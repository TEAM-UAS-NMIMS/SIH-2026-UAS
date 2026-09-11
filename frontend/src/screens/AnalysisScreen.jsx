/**
 * AnalysisScreen — post-mission analysis, rebuilt.
 *
 * The map is gone from this screen: it duplicated the planner and the live
 * screen without adding anything, and it crowded out the analysis itself. What
 * replaced it is a stack of expanding panels, one per analysis product, so the
 * operator opens the one they need and reads it at full width.
 *
 *   Coverage        the area actually swept, as a function of time, with the
 *                   sweep algorithm's progress
 *   Flight replay   scrub the recorded track; shows position and elapsed time
 *   Detections      every casualty tracked, with review actions
 *   Hazards         the event log filtered to what went wrong
 *   Export          real JSON/CSV of the mission record
 *   Thermal map     NOT BUILT — a worked example of what it would show
 *   3D recon        NOT BUILT — a worked example of what it would show
 *
 * The two unbuilt products are labelled as future work and rendered as clearly
 * marked illustrations. They are never presented as this mission's data.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useTelemetry } from "../context/TelemetryContext";
import { api } from "../config";
import Icon from "../components/Icon";
import StatusPill from "../components/StatusPill";
import StatsStrip from "../components/analysis/StatsStrip";
import TargetDetailPanel from "../components/analysis/TargetDetailPanel";
import CoveragePanel from "../components/analysis/CoveragePanel";
import ReplayPanel from "../components/analysis/ReplayPanel";
import ThermalPanel from "../components/analysis/ThermalPanel";
import ReconPanel from "../components/analysis/ReconPanel";
import DetectionsReviewPanel from "../components/analysis/DetectionsReviewPanel";
import HazardPanel from "../components/analysis/HazardPanel";
import ExportPanel from "../components/analysis/ExportPanel";

/** One expanding analysis product. */
function Accordion({ id, title, subtitle, icon, badge, open, onToggle, children }) {
  return (
    <section className="panel overflow-hidden shrink-0">
      <button
        onClick={() => onToggle(open ? null : id)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
        style={{ borderBottom: open ? "1px solid var(--rule)" : "none" }}
      >
        <Icon name={icon} size={15} style={{ color: "var(--ink-2)" }} />
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold">{title}</span>
          {subtitle && (
            <span className="text-[10.5px] truncate" style={{ color: "var(--ink-3)" }}>
              {subtitle}
            </span>
          )}
        </span>
        {badge}
        <span
          className="shrink-0 transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none", color: "var(--ink-3)" }}
        >
          <Icon name="play" size={11} />
        </span>
      </button>

      {/* Height-animated reveal. Kept to a transform/opacity + max-height pair so
          it stays cheap and respects prefers-reduced-motion via index.css. */}
      <div
        style={{
          maxHeight: open ? 3000 : 0,
          opacity: open ? 1 : 0,
          overflow: "hidden",
          transition: "max-height .32s ease, opacity .22s ease",
        }}
      >
        {open && <div className="p-3">{children}</div>}
      </div>
    </section>
  );
}

export default function AnalysisScreen() {
  const { telemetry, detections, events, mission } = useTelemetry();
  const [open, setOpen] = useState("coverage");
  const [selectedDet, setSelectedDet] = useState(null);

  // ── Real flown path, from the backend ───────────────────────────────────
  // Previously rebuilt from whatever telemetry arrived while this screen was
  // mounted, which meant it was empty on arrival — the operator flies the
  // mission on the Live screen, not this one.
  const [flightPath, setFlightPath] = useState([]);
  const [pathError, setPathError] = useState(null);

  const loadPath = useCallback(async () => {
    try {
      const res = await fetch(api("/api/flight_path"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      setFlightPath(j.path ?? []);
      setPathError(null);
    } catch (err) {
      setPathError(err.message ?? "Could not load the flight path");
    }
  }, []);

  useEffect(() => {
    loadPath();
    const id = setInterval(loadPath, 5000);
    return () => clearInterval(id);
  }, [loadPath]);

  // Local detection copy so a review feels instant; the backend is authoritative.
  const [localDetections, setLocalDetections] = useState(detections);
  useEffect(() => setLocalDetections(detections), [detections]);

  function handleReview(updated) {
    setLocalDetections((prev) =>
      prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
    setSelectedDet((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
  }

  const confirmed = localDetections.filter((d) => d.status === "confirmed").length;
  const hazardEvents = events.filter((e) => e.severity !== "info");

  return (
    <main className="h-full flex flex-col gap-2 p-2 overflow-hidden">
      <StatsStrip phase={telemetry.phase} />

      <div className="flex-1 min-h-0 overflow-y-auto scroll-thin flex flex-col gap-2 pr-1">
        <Accordion
          id="coverage" open={open === "coverage"} onToggle={setOpen}
          icon="grid" title="Coverage"
          subtitle="Area actually swept over time, from the recorded track"
          badge={<StatusPill tone="nominal" label={`${flightPath.length} pts`} />}
        >
          <CoveragePanel
            flightPath={flightPath}
            searchPolygon={mission.searchPolygon ?? []}
            altitude={telemetry.altitude}
            error={pathError}
          />
        </Accordion>

        <Accordion
          id="replay" open={open === "replay"} onToggle={setOpen}
          icon="play" title="Flight Replay"
          subtitle="Scrub the recorded track"
          badge={<StatusPill tone={flightPath.length ? "nominal" : "absent"}
                             label={flightPath.length ? "Ready" : "No track"} />}
        >
          <ReplayPanel flightPath={flightPath} detections={localDetections} />
        </Accordion>

        <Accordion
          id="detections" open={open === "detections"} onToggle={setOpen}
          icon="user" title="Casualties Tracked"
          subtitle="Every distinct target found, with review actions"
          badge={
            <StatusPill
              tone={localDetections.length ? "nominal" : "absent"}
              label={`${localDetections.length} found · ${confirmed} confirmed`}
            />
          }
        >
          <DetectionsReviewPanel
            detections={localDetections}
            onSelect={setSelectedDet}
            selectedId={selectedDet?.id}
          />
        </Accordion>

        <Accordion
          id="hazards" open={open === "hazards"} onToggle={setOpen}
          icon="alert-triangle" title="Hazards & Degradations"
          subtitle="Events that affected the mission"
          badge={
            <StatusPill
              tone={hazardEvents.length ? "caution" : "nominal"}
              label={hazardEvents.length ? `${hazardEvents.length} events` : "None"}
            />
          }
        >
          <HazardPanel events={events} />
        </Accordion>

        <Accordion
          id="export" open={open === "export"} onToggle={setOpen}
          icon="download" title="Export Mission Record"
          subtitle="JSON and CSV of detections, track and events"
        >
          <ExportPanel
            detections={localDetections}
            flightPath={flightPath}
            events={events}
            mission={mission}
          />
        </Accordion>

        <Accordion
          id="thermal" open={open === "thermal"} onToggle={setOpen}
          icon="thermometer" title="Thermal Map"
          subtitle="Not built — worked example of the intended product"
          badge={<StatusPill tone="caution" label="Future work" />}
        >
          <ThermalPanel />
        </Accordion>

        <Accordion
          id="recon" open={open === "recon"} onToggle={setOpen}
          icon="box" title="3D Reconstruction"
          subtitle="Not built — worked example of the intended product"
          badge={<StatusPill tone="caution" label="Future work" />}
        >
          <ReconPanel />
        </Accordion>
      </div>

      {selectedDet && (
        <div className="absolute inset-0 z-[500] flex items-start justify-end p-4"
             style={{ background: "rgba(17,17,17,.28)" }}
             onClick={(e) => { if (e.target === e.currentTarget) setSelectedDet(null); }}>
          <div className="w-[23rem] max-h-full overflow-hidden">
            <TargetDetailPanel
              det={selectedDet}
              onClose={() => setSelectedDet(null)}
              onReview={handleReview}
            />
          </div>
        </div>
      )}
    </main>
  );
}
