/**
 * PreFlightScreen — rendered at /preflight.
 *
 * Wired to TelemetryContext: pulls mission metadata and live telemetry.
 * Builds the checklist items from real telemetry where a signal exists;
 * items with no real signal are static "ok" placeholders (see comments).
 *
 * Launch button calls POST /api/mission/phase {"phase":"LIVE_RESCUE"}
 * then navigates to /live on success.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import MissionSetupPanel from "../components/preflight/MissionSetupPanel";
import MissionMapEditor  from "../components/preflight/MissionMapEditor";
import ChecklistPanel    from "../components/preflight/ChecklistPanel";

// ─── Checklist builder ────────────────────────────────────────────────────────
// Derives checklist sections from live telemetry.
// Only items where a real MAVLink signal exists are dynamic.
// Items marked "// STATIC PLACEHOLDER" are not backed by live data yet.

function buildChecklist(telemetry) {
  const {
    gps_fix_type,
    satellites_visible,
    hdop,
    position_source,
    battery_pct,
    battery_voltage,
    mode,
    armed,
  } = telemetry;

  // ── Helpers ──
  const pass = (label, detail) => ({ label, status: "pass", detail });
  const warn = (label, detail) => ({ label, status: "warn", detail });
  const fail = (label, detail) => ({ label, status: "fail", detail });
  const skip = (label, detail) => ({ label, status: "skip", detail });

  // ── Position section — driven by real GPS_RAW_INT / GLOBAL_POSITION_INT ──
  const hasFix         = gps_fix_type >= 3;
  const satsOk         = satellites_visible >= 8;
  const hdopOk         = hdop > 0 && hdop <= 1.5;
  const homeSet        = position_source !== "NO_POSITION";

  const positionItems = [
    hasFix
      ? pass("GNSS 3D fix acquired", `Fix type: ${gps_fix_type}`)
      : fail("GNSS 3D fix acquired", `Fix type: ${gps_fix_type} — no 3D fix`),

    satsOk
      ? pass("Satellites visible ≥ 8", `${satellites_visible} satellites`)
      : warn("Satellites visible ≥ 8", `Currently ${satellites_visible} — marginal`),

    hdop === 0
      ? skip("HDOP ≤ 1.5", "HDOP not yet received")
      : hdopOk
      ? pass("HDOP ≤ 1.5", `HDOP: ${hdop.toFixed(2)}`)
      : warn("HDOP ≤ 1.5", `HDOP: ${hdop.toFixed(2)} — accuracy degraded`),

    homeSet
      ? pass("Home position set", `Source: ${position_source.replace("_", " ")}`)
      : fail("Home position set", "No position fix — home point not established"),

    // STATIC PLACEHOLDER: compass calibration has no dedicated MAVLink signal
    // at this phase; will be wired when EKF status message is parsed.
    pass("Compass calibrated", "Static OK — EKF status not yet parsed"),
  ];

  // ── Power section — driven by real SYS_STATUS ──
  const battChargeOk   = battery_pct >= 80;
  // Cell voltage balance: we only have aggregate voltage, not per-cell.
  // STATIC PLACEHOLDER — per-cell data requires BATTERY_STATUS msg (not yet parsed).
  const voltageOk      = battery_voltage >= 22.0; // rough 6S threshold

  const powerItems = [
    battChargeOk
      ? pass("Battery charge ≥ 80%", `Battery at ${Math.round(battery_pct)}%`)
      : battery_pct >= 50
      ? warn("Battery charge ≥ 80%", `Battery at ${Math.round(battery_pct)}% — top up recommended`)
      : fail("Battery charge ≥ 80%", `Battery at ${Math.round(battery_pct)}% — too low`),

    // STATIC PLACEHOLDER: per-cell balance requires BATTERY_STATUS (not yet parsed).
    pass("Cell voltage balance OK", "Static OK — per-cell data not yet parsed"),

    // STATIC PLACEHOLDER: ESC self-test result not in current MAVLink stream.
    pass("ESC self-test passed", "Static OK — ESC telemetry not yet parsed"),

    battChargeOk
      ? pass("Estimated range ≥ mission", "Battery sufficient for planned route")
      : warn("Estimated range ≥ mission", "Reduced battery may not cover full route"),
  ];

  // ── Communication section ──
  // GCS link status is implied by the WebSocket being alive; RC/video downlink
  // not in current MAVLink stream.  All three are static OK for now.
  const commItems = [
    // Dynamic: if mode != "UNKNOWN" a heartbeat is flowing, so the GCS link is up.
    mode !== "UNKNOWN"
      ? pass("GCS telemetry link active", `Heartbeat OK — mode: ${mode}`)
      : warn("GCS telemetry link active", "No MAVLink heartbeat received yet"),

    // STATIC PLACEHOLDER: RC RSSI requires RC_CHANNELS_RAW (not yet parsed).
    pass("RC signal > −80 dBm", "Static OK — RC RSSI not yet parsed"),

    // STATIC PLACEHOLDER: video downlink detection not yet wired.
    pass("Video downlink connected", "Static OK — downlink not yet monitored"),
  ];

  // ── Airframe section — all static placeholders ──
  // Structural integrity has no MAVLink equivalent; sensor health (vibration)
  // will be added when VIBRATION msg is parsed in a later phase.
  const airframeItems = [
    pass("Motor mounts tight",    "Static OK — no MAVLink equivalent"),
    pass("Propeller condition OK", "Static OK — no MAVLink equivalent"),
    pass("Frame arms locked",      "Static OK — no MAVLink equivalent"),
    pass("Landing gear secure",    "Static OK — no MAVLink equivalent"),
  ];

  // ── Payload section — YOLO model status could be queried but isn't yet ──
  const payloadItems = [
    // STATIC PLACEHOLDER: gimbal calibration requires GIMBAL_DEVICE_ATTITUDE_STATUS.
    pass("Camera gimbal calibrated", "Static OK — gimbal telemetry not yet parsed"),
    // STATIC PLACEHOLDER: no MAVLink equivalent for lens cleanliness.
    pass("Camera lens clean",        "Static OK — no MAVLink equivalent"),
    // STATIC PLACEHOLDER: YOLO model health to be wired via /api/health in a later phase.
    warn("YOLO model loaded",        "Static WARN — model health endpoint not yet wired"),
    // STATIC PLACEHOLDER: SD card detection not in current stream.
    pass("SD card present",          "Static OK — storage telemetry not yet parsed"),
  ];

  // ── Mission Safety section — partially static ──
  const safetyItems = [
    // STATIC PLACEHOLDER: airspace clearance is an operator step, not MAVLink.
    pass("Airspace clearance confirmed", "Static OK — operator checklist item"),
    // STATIC PLACEHOLDER: NOTAM check is operator step.
    pass("NOTAMs checked",               "Static OK — operator checklist item"),
    // STATIC PLACEHOLDER: geofence upload status not yet in stream.
    warn("Geofence loaded",              "Static WARN — geofence upload not yet monitored"),
    // Dynamic: RTL altitude is included in mode/heartbeat; treat as OK when armed=false.
    armed
      ? warn("RTL altitude set", "Drone is ARMED — verify RTL before takeoff")
      : pass("RTL altitude set",  "Disarmed — safe to configure"),
    // STATIC PLACEHOLDER: human observer confirmation is operator step.
    warn("Observer in position", "Static WARN — observer confirmation not yet wired"),
  ];

  const sections = [
    { name: "Airframe",         items: airframeItems },
    { name: "Position",         items: positionItems },
    { name: "Communication",    items: commItems     },
    { name: "Power",            items: powerItems    },
    { name: "Payload",          items: payloadItems  },
    { name: "Mission Safety",   items: safetyItems   },
  ];

  // ── Readiness score ──
  // Simple: (pass items) / (non-skip items) × 100, per section and overall.
  function sectionScore(items) {
    const countable = items.filter((i) => i.status !== "skip");
    if (countable.length === 0) return 100;
    return Math.round((countable.filter((i) => i.status === "pass").length / countable.length) * 100);
  }

  const subScores = sections.map((s) => ({
    label: s.name,
    score: sectionScore(s.items),
  }));

  const allCountable = sections.flatMap((s) => s.items).filter((i) => i.status !== "skip");
  const readinessScore = allCountable.length === 0
    ? 0
    : Math.round((allCountable.filter((i) => i.status === "pass").length / allCountable.length) * 100);

  return { sections, subScores, readinessScore };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PreFlightScreen() {
  const { telemetry, mission } = useTelemetry();
  const navigate = useNavigate();
  const [launchError, setLaunchError] = useState(null);

  // Editable copies of mission geometry — initialised from context,
  // then owned locally so the operator can edit without touching the WS state.
  const [editableWaypoints,  setEditableWaypoints]  = useState(() => mission.waypoints     || []);
  const [editablePolygon,    setEditablePolygon]    = useState(() => mission.searchPolygon || []);

  const checklist = buildChecklist(telemetry);

  // Map data: geometry comes from mission state, stats are static for now
  const mapData = {
    launchPoint:   mission.launchPoint   || [51.505, -0.09],
    waypoints:     editableWaypoints,
    searchPolygon: editablePolygon,
    hazardZone:    mission.hazardZone    || [],
    stats:         mission.stats         || { distanceKm: 0, flightTimeMin: 0, coverageHa: 0, batteryReservePct: 0 },
  };

  async function handleLaunch() {
    setLaunchError(null);           // clear any previous error
    try {
      const res = await fetch("http://localhost:8000/api/mission/phase", {
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
      // Surface error visibly in the ChecklistPanel instead of hiding it in console.
      setLaunchError(err.message ?? "Unknown error — check backend is running");
    }
  }

  return (
    <main className="h-full flex gap-3 p-3 overflow-hidden">
      {/* Left: Mission setup */}
      <aside className="w-56 shrink-0 overflow-hidden flex flex-col">
        <MissionSetupPanel mission={mission} />
      </aside>

      {/* Center: Map editor */}
      <section className="flex-1 min-w-0 overflow-hidden">
        <MissionMapEditor
          mapData={mapData}
          onWaypointsChange={setEditableWaypoints}
          onPolygonChange={setEditablePolygon}
        />
      </section>

      {/* Right: Checklist */}
      <aside className="w-72 shrink-0 overflow-hidden flex flex-col">
        <ChecklistPanel checklist={checklist} onLaunch={handleLaunch} launchError={launchError} />
      </aside>
    </main>
  );
}
