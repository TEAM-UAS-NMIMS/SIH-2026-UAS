/**
 * AnalysisScreen — rendered at /analysis.
 *
 * Layout:
 *   Top row  : StatsStrip (full width — GET /api/mission/stats)
 *   Body row : AnalysisMap (center, flex-1) | AnalysisToolsList (right, w-72)
 *
 * TargetDetailPanel slides in over the map when a detection marker is clicked.
 *
 * Data sources:
 *   telemetry       — from TelemetryContext (phase badge, position history)
 *   detections      — from TelemetryContext (live-updated via WS)
 *   events          — from TelemetryContext
 *   mission         — from TelemetryContext (searchPolygon, waypoints)
 *   flightPath      — built here from TelemetryContext._position_history;
 *                     since the frontend doesn't have direct access to the
 *                     backend's _position_history list, we reconstruct it
 *                     by accumulating [lat,lon] samples from telemetry
 *                     updates in a local ref.
 *
 * Do NOT touch PreFlightScreen or LiveRescueScreen.
 */
import { useState, useRef, useEffect } from "react";
import { useTelemetry } from "../context/TelemetryContext";

import StatsStrip         from "../components/analysis/StatsStrip";
import AnalysisMap        from "../components/analysis/AnalysisMap";
import TargetDetailPanel  from "../components/analysis/TargetDetailPanel";
import AnalysisToolsList  from "../components/analysis/AnalysisToolsList";

export default function AnalysisScreen() {
  const { telemetry, detections, events, mission } = useTelemetry();

  // ── Local detection state (so review actions update the panel without
  //    waiting for the next WS broadcast which may not arrive in ANALYSIS).
  const [localDetections, setLocalDetections] = useState(detections);

  // Keep localDetections in sync with WS updates but don't clobber pending
  // review changes (merge by id, WS wins for non-reviewed fields).
  useEffect(() => {
    setLocalDetections((prev) => {
      const prevMap = Object.fromEntries(prev.map((d) => [d.id, d]));
      return detections.map((d) => ({ ...d, ...(prevMap[d.id] ?? {}) }));
    });
  }, [detections]);

  // ── Flight path accumulation ─────────────────────────────────────────────
  // Collect [lat, lon] from every telemetry tick where a valid fix exists.
  // We deduplicate consecutive identical points to keep the list compact.
  const pathRef = useRef([]);
  const [flightPath, setFlightPath] = useState([]);
  const lastPtRef = useRef(null);

  useEffect(() => {
    const { lat, lon } = telemetry;
    if (!lat || !lon || (lat === 0 && lon === 0)) return;
    const key = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    if (key === lastPtRef.current) return;
    lastPtRef.current = key;
    pathRef.current = [...pathRef.current, [lat, lon]];
    setFlightPath(pathRef.current);
  }, [telemetry.lat, telemetry.lon]);

  // ── Selected detection for detail panel ──────────────────────────────────
  const [selectedDet, setSelectedDet] = useState(null);

  function handleSelectDet(det) {
    setSelectedDet(det);
  }

  function handleClose() {
    setSelectedDet(null);
  }

  function handleReview(updatedDet) {
    setLocalDetections((prev) =>
      prev.map((d) => (d.id === updatedDet.id ? { ...d, ...updatedDet } : d))
    );
    // Keep selected detection in sync with the reviewed state.
    setSelectedDet((prev) =>
      prev?.id === updatedDet.id ? { ...prev, ...updatedDet } : prev
    );
  }

  const searchPolygon = mission?.searchPolygon ?? [];

  return (
    <main className="h-full flex flex-col gap-3 p-3 overflow-hidden">
      {/* ── Top: mission stats strip ── */}
      <StatsStrip />

      {/* ── Body: map + tools ── */}
      <div className="flex-1 flex gap-3 min-h-0 overflow-hidden">
        {/* Center: map (relative so TargetDetailPanel can abs-position over it) */}
        <div className="flex-1 min-w-0 relative flex flex-col overflow-hidden">
          <AnalysisMap
            detections={localDetections}
            flightPath={flightPath}
            searchPolygon={searchPolygon}
            onSelectDet={handleSelectDet}
          />

          {/* Slide-in detail panel — positioned absolute inside the map column */}
          <TargetDetailPanel
            detection={selectedDet}
            onClose={handleClose}
            onReview={handleReview}
          />
        </div>

        {/* Right: analysis tools */}
        <aside className="w-72 shrink-0 overflow-hidden flex flex-col">
          <AnalysisToolsList
            detections={localDetections}
            flightPath={flightPath}
            events={events}
            searchPolygon={searchPolygon}
          />
        </aside>
      </div>
    </main>
  );
}
