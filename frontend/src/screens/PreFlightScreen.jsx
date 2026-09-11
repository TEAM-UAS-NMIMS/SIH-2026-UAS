/**
 * PreFlightScreen — plan the sortie, connect the aircraft, work the checklist.
 *
 * Four columns:
 *   Mission setup    metadata for the tasking
 *   Flight controller  connect a real Pixhawk; arm / mode / upload the route
 *   Mission map      draw the search area, geofence and route
 *   Checklist        the crew checklist that gates launch
 *
 * Geometry edits are persisted to the backend (PUT /api/mission/geometry) so
 * the plan survives navigation and the aircraft can be given what was drawn.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import MissionSetupPanel from "../components/preflight/MissionSetupPanel";
import MissionMapEditor  from "../components/preflight/MissionMapEditor";
import ChecklistPanel    from "../components/preflight/ChecklistPanel";
import LinkPanel         from "../components/preflight/LinkPanel";
import { buildChecklist } from "../lib/preflightChecklist";
import { api } from "../config";

export default function PreFlightScreen() {
  const {
    telemetry, mission, videoSignal, cameraOn,
    preflightAcks, wsConnected,
  } = useTelemetry();
  const navigate = useNavigate();
  const [launchError, setLaunchError] = useState(null);
  const [saveState, setSaveState] = useState(null);   // "saving" | "saved" | error text

  // Geometry is edited locally for responsiveness, then persisted. Server state
  // seeds it and wins whenever the operator is not mid-edit.
  const [waypoints, setWaypoints] = useState(() => mission.waypoints ?? []);
  const [polygon,   setPolygon]   = useState(() => mission.searchPolygon ?? []);
  const [geofence,  setGeofence]  = useState(() => mission.geofence ?? mission.searchPolygon ?? []);
  const dirty = useRef(false);

  useEffect(() => {
    if (dirty.current) return;
    setWaypoints(mission.waypoints ?? []);
    setPolygon(mission.searchPolygon ?? []);
    setGeofence(mission.geofence ?? mission.searchPolygon ?? []);
  }, [mission.waypoints, mission.searchPolygon, mission.geofence]);

  // Debounced persistence — an operator dragging a vertex should not fire a
  // request per mouse-move, but the plan must never be left only in the browser.
  const saveTimer = useRef(null);
  const persist = useCallback((payload) => {
    dirty.current = true;
    clearTimeout(saveTimer.current);
    setSaveState("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(api("/api/mission/geometry"), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.detail ?? `HTTP ${res.status}`);
        }
        setSaveState("saved");
        dirty.current = false;
        setTimeout(() => setSaveState(null), 2500);
      } catch (err) {
        setSaveState(err.message ?? "Could not save plan");
      }
    }, 700);
  }, []);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  function onWaypointsChange(next) {
    setWaypoints(next);
    persist({ waypoints: next });
  }
  function onPolygonChange(next) {
    setPolygon(next);
    persist({ searchPolygon: next });
  }
  function onGeofenceChange(next) {
    setGeofence(next);
    persist({ geofence: next });
  }

  const checklist = buildChecklist(telemetry, {
    videoSignal,
    cameraOn,
    linkConnected: (telemetry.mode ?? "UNKNOWN") !== "UNKNOWN" || telemetry.armed === true,
    acks: preflightAcks,
    missionStats: mission.stats ?? {},
    waypointCount: waypoints.length,
  });

  const mapData = {
    launchPoint:   mission.launchPoint ?? [21.34860, 74.87980],
    waypoints,
    searchPolygon: polygon,
    geofence,
    hazardZone:    mission.hazardZone ?? [],
    stats:         mission.stats ?? {},
  };

  async function handleLaunch() {
    setLaunchError(null);
    try {
      const res = await fetch(api("/api/mission/phase"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "LIVE_RESCUE" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail ?? `Backend returned HTTP ${res.status}`);
      }
      navigate("/live");
    } catch (err) {
      setLaunchError(err.message ?? "Unknown error — check the backend is running");
    }
  }

  return (
    <main className="h-full flex gap-2 p-2 overflow-hidden">
      <aside className="w-[13rem] shrink-0 flex flex-col gap-2 overflow-hidden">
        <div style={{ flex: "1 1 0", minHeight: 0 }} className="overflow-hidden">
          <MissionSetupPanel mission={{ ...mission, stats: mission.stats ?? {} }} />
        </div>
      </aside>

      <aside className="w-[15rem] shrink-0 overflow-hidden flex flex-col">
        <LinkPanel waypointCount={waypoints.length} />
      </aside>

      <section className="flex-1 min-w-0 overflow-hidden flex flex-col gap-1">
        <MissionMapEditor
          mapData={mapData}
          onWaypointsChange={onWaypointsChange}
          onPolygonChange={onPolygonChange}
          onGeofenceChange={onGeofenceChange}
          saveState={saveState}
          wsConnected={wsConnected}
        />
      </section>

      <aside className="w-[19rem] shrink-0 overflow-hidden flex flex-col">
        <ChecklistPanel
          checklist={checklist}
          onLaunch={handleLaunch}
          launchError={launchError}
        />
      </aside>
    </main>
  );
}
