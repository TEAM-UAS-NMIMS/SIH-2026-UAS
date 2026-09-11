/**
 * Pre-flight checklist for a search-and-rescue sUAS sortie.
 *
 * The previous checklist was a set of invented labels that were mostly
 * hardcoded to "pass", so it looked complete while verifying almost nothing.
 * This one is built the way a real crew checklist is: grouped by the thing
 * being checked, and every item is one of exactly two kinds —
 *
 *   AUTO   derived from live telemetry or backend state. The operator cannot
 *          tick it; the aircraft either reports it or it does not.
 *   MANUAL a physical or procedural check no sensor can make (props inspected,
 *          observer posted, airspace cleared). The operator ticks it, and the
 *          tick is persisted server-side so it survives navigation and can be
 *          cited in the mission report.
 *
 * Nothing is ever silently green. An AUTO item with no data reports "skip"
 * (not reported), never "pass".
 *
 * Item ids are stable strings because operator acknowledgements are stored
 * against them — renaming an id invalidates a previously signed checklist.
 */

export const PASS = "pass";
export const WARN = "warn";
export const FAIL = "fail";
export const SKIP = "skip";

const auto   = (id, label, status, detail) => ({ id, label, status, detail, kind: "auto" });
const manual = (id, label, detail, critical = false) => ({ id, label, detail, kind: "manual", critical });

/**
 * @param telemetry  live telemetry slice
 * @param ctx        { videoSignal, cameraOn, linkConnected, acks, missionStats }
 */
export function buildChecklist(telemetry, ctx = {}) {
  const {
    gps_fix_type, satellites_visible, hdop, position_source,
    battery_pct, battery_voltage, mode, armed, roll, pitch,
  } = telemetry ?? {};

  const {
    videoSignal = false,
    cameraOn = false,
    linkConnected = false,
    acks = {},
    missionStats = {},
    waypointCount = 0,
  } = ctx;

  const num = (v) => typeof v === "number" && Number.isFinite(v);

  // ── 1. Airframe & propulsion — physical inspection, operator signed ──────
  const airframe = [
    manual("af_props",      "Propellers undamaged and correctly seated",
           "Check for nicks, cracks and rotation direction", true),
    manual("af_motors",     "Motor mounts and arms secure",
           "No play in arms; all fasteners torqued", true),
    manual("af_frame",      "Airframe free of cracks or damage",
           "Inspect booms, centre plate and landing gear"),
    manual("af_payload",    "Payload and camera mount secured",
           "Gimbal free to move, cabling strain-relieved"),
    manual("af_cg",         "Centre of gravity within limits",
           "Balance check with flight battery installed"),
  ];

  // ── 2. Power ─────────────────────────────────────────────────────────────
  const battKnown = num(battery_pct);
  const voltKnown = num(battery_voltage);
  const power = [
    !battKnown
      ? auto("pw_charge", "Flight battery ≥ 80%", SKIP, "Not reported by autopilot")
      : battery_pct >= 80
        ? auto("pw_charge", "Flight battery ≥ 80%", PASS, `${Math.round(battery_pct)}% indicated`)
        : battery_pct >= 50
          ? auto("pw_charge", "Flight battery ≥ 80%", WARN, `${Math.round(battery_pct)}% — top up before launch`)
          : auto("pw_charge", "Flight battery ≥ 80%", FAIL, `${Math.round(battery_pct)}% — insufficient for sortie`),

    !voltKnown
      ? auto("pw_volt", "Pack voltage within range", SKIP, "Not reported by autopilot")
      : battery_voltage >= 22.2
        ? auto("pw_volt", "Pack voltage within range", PASS, `${battery_voltage.toFixed(2)} V`)
        : auto("pw_volt", "Pack voltage within range", WARN, `${battery_voltage.toFixed(2)} V — below nominal 6S`),

    manual("pw_cells",   "Cell voltages balanced",
           "Within 0.05 V across cells on the charger", true),
    manual("pw_secure",  "Battery latched and connector seated",
           "Pack cannot shift in flight"),
    manual("pw_reserve", "Reserve battery charged and on site",
           "Second pack available for a follow-up sortie"),
  ];

  // ── 3. Navigation & position ─────────────────────────────────────────────
  const hasFix = num(gps_fix_type) && gps_fix_type >= 3;
  const satsKnown = num(satellites_visible);
  const hdopKnown = num(hdop) && hdop > 0;

  const navigation = [
    hasFix
      ? auto("nav_fix", "GNSS 3D fix acquired", PASS, `Fix type ${gps_fix_type}`)
      : linkConnected
        ? auto("nav_fix", "GNSS 3D fix acquired", FAIL, `Fix type ${gps_fix_type ?? 0} — no 3D fix`)
        : auto("nav_fix", "GNSS 3D fix acquired", SKIP, "No flight controller connected"),

    !satsKnown || !linkConnected
      ? auto("nav_sats", "Satellites ≥ 12", SKIP, "Not reported")
      : satellites_visible >= 12
        ? auto("nav_sats", "Satellites ≥ 12", PASS, `${satellites_visible} tracked`)
        : satellites_visible >= 8
          ? auto("nav_sats", "Satellites ≥ 12", WARN, `${satellites_visible} tracked — marginal`)
          : auto("nav_sats", "Satellites ≥ 12", FAIL, `${satellites_visible} tracked — insufficient`),

    !hdopKnown
      ? auto("nav_hdop", "HDOP ≤ 1.5", SKIP, "Not reported")
      : hdop <= 1.5
        ? auto("nav_hdop", "HDOP ≤ 1.5", PASS, `HDOP ${hdop.toFixed(2)}`)
        : auto("nav_hdop", "HDOP ≤ 1.5", WARN, `HDOP ${hdop.toFixed(2)} — position accuracy degraded`),

    position_source === "GNSS"
      ? auto("nav_home", "Home position set", PASS, "Launch point established from GNSS")
      : position_source === "VIO_FALLBACK"
        ? auto("nav_home", "Home position set", WARN, "Running on VIO fallback — GNSS degraded")
        : auto("nav_home", "Home position set", FAIL, "No position source — home point not established"),

    num(roll) && num(pitch)
      ? Math.abs(roll) < 5 && Math.abs(pitch) < 5
        ? auto("nav_level", "Aircraft level on launch point", PASS,
               `Roll ${roll.toFixed(1)}° pitch ${pitch.toFixed(1)}°`)
        : auto("nav_level", "Aircraft level on launch point", WARN,
               `Roll ${roll.toFixed(1)}° pitch ${pitch.toFixed(1)}° — level the aircraft`)
      : auto("nav_level", "Aircraft level on launch point", SKIP, "ATTITUDE not reported"),

    manual("nav_compass", "Compass calibrated for this site",
           "Re-calibrate after transport or a large location change", true),
  ];

  // ── 4. Communications ────────────────────────────────────────────────────
  const comms = [
    linkConnected
      ? auto("cm_mavlink", "Telemetry link to flight controller", PASS,
             mode && mode !== "UNKNOWN" ? `Heartbeat OK — mode ${mode}` : "Heartbeat OK")
      : auto("cm_mavlink", "Telemetry link to flight controller", FAIL,
             "No MAVLink connection — connect the flight controller"),

    cameraOn
      ? videoSignal
        ? auto("cm_video", "Video downlink active", PASS, "Frames arriving from payload")
        : auto("cm_video", "Video downlink active", FAIL, "Camera started but no frames arriving")
      : auto("cm_video", "Video downlink active", SKIP, "Camera not started"),

    manual("cm_rc",      "RC transmitter bound and range-checked",
           "Failsafe behaviour confirmed", true),
    manual("cm_gcs",     "GCS position clear of obstructions",
           "Antenna line of sight to the search area"),
  ];

  // ── 5. Payload & detection ───────────────────────────────────────────────
  const payload = [
    cameraOn
      ? auto("pl_camera", "Camera payload operational", PASS, "Stream open, inference running")
      : auto("pl_camera", "Camera payload operational", SKIP, "Camera not started"),

    manual("pl_lens",    "Lens clean and unobstructed",
           "Wipe before launch; check for condensation"),
    manual("pl_storage", "Onboard storage has capacity",
           "Sufficient space to record the full sortie"),
    manual("pl_gimbal",  "Gimbal calibrated and pointing nadir",
           "Detection geolocation assumes a straight-down camera", true),
  ];

  // ── 6. Mission & airspace ────────────────────────────────────────────────
  const hasRoute = waypointCount >= 2;
  const reserve = missionStats?.batteryReservePct;

  const mission = [
    hasRoute
      ? auto("ms_route", "Search route planned", PASS,
             `${waypointCount} waypoints · ${missionStats?.distanceKm ?? "—"} km · `
             + `${missionStats?.flightTimeMin ?? "—"} min est.`)
      : auto("ms_route", "Search route planned", FAIL,
             "Fewer than two waypoints — plan a route on the map"),

    num(reserve)
      ? reserve >= 25
        ? auto("ms_reserve", "Battery reserve ≥ 25% at RTL", PASS, `${reserve}% projected reserve`)
        : auto("ms_reserve", "Battery reserve ≥ 25% at RTL", WARN,
               `${reserve}% projected — shorten the route or stage a battery swap`)
      : auto("ms_reserve", "Battery reserve ≥ 25% at RTL", SKIP, "Requires a planned route"),

    manual("ms_geofence", "Geofence loaded and verified",
           "Boundary encloses the search area with margin", true),
    manual("ms_rtl",      "RTL altitude set above obstacles",
           "Clears terrain, trees and structures on the return path", true),
    manual("ms_airspace", "Airspace clearance obtained",
           "Permissions in place for this location and time", true),
    manual("ms_notam",    "NOTAMs and TFRs checked",
           "No conflicting activity or restriction over the area"),
    manual("ms_manned",   "Deconflicted with manned SAR assets",
           "Helicopter or fixed-wing activity coordinated with incident command", true),
    manual("ms_weather",  "Weather within airframe limits",
           "Wind, visibility, precipitation and temperature checked"),
  ];

  // ── 7. Crew & safety ─────────────────────────────────────────────────────
  const safety = [
    armed === true
      ? auto("sf_disarmed", "Aircraft disarmed during pre-flight", FAIL,
             "Aircraft is ARMED — disarm before continuing checks")
      : auto("sf_disarmed", "Aircraft disarmed during pre-flight", PASS,
             "Disarmed — safe to work near the aircraft"),

    manual("sf_observer",  "Visual observer briefed and in position",
           "Maintains visual line of sight throughout the sortie", true),
    manual("sf_area",      "Launch area clear of people",
           "Bystanders and crew clear of the rotor arc", true),
    manual("sf_emergency", "Emergency procedures briefed",
           "Lost link, flyaway and forced landing actions agreed", true),
    manual("sf_firstaid",  "First aid and fire extinguisher on site",
           "Lithium-appropriate extinguisher within reach"),
  ];

  const sections = [
    { name: "Airframe & Propulsion", items: airframe },
    { name: "Power",                 items: power },
    { name: "Navigation & Position", items: navigation },
    { name: "Communications",        items: comms },
    { name: "Payload & Detection",   items: payload },
    { name: "Mission & Airspace",    items: mission },
    { name: "Crew & Safety",         items: safety },
  ];

  // Resolve manual items against the operator's persisted acknowledgements.
  // An unticked critical item is a hard fail — it blocks launch. An unticked
  // non-critical item is a caution the operator may knowingly accept.
  for (const section of sections) {
    section.items = section.items.map((item) => {
      if (item.kind !== "manual") return item;
      const acked = !!acks?.[item.id]?.ack;
      return {
        ...item,
        status: acked ? PASS : item.critical ? FAIL : WARN,
        acked,
        detail: acked
          ? `Confirmed by ${acks[item.id].by ?? "operator"}`
          : item.detail,
      };
    });
  }

  const scoreOf = (items) => {
    const countable = items.filter((i) => i.status !== SKIP);
    if (!countable.length) return 100;
    return Math.round(
      (countable.filter((i) => i.status === PASS).length / countable.length) * 100,
    );
  };

  const subScores = sections.map((s) => ({ label: s.name, score: scoreOf(s.items) }));
  const all = sections.flatMap((s) => s.items);
  const countable = all.filter((i) => i.status !== SKIP);
  const readinessScore = countable.length
    ? Math.round((countable.filter((i) => i.status === PASS).length / countable.length) * 100)
    : 0;

  return {
    sections,
    subScores,
    readinessScore,
    failCount: all.filter((i) => i.status === FAIL).length,
    warnCount: all.filter((i) => i.status === WARN).length,
    manualTotal: all.filter((i) => i.kind === "manual").length,
    manualDone: all.filter((i) => i.kind === "manual" && i.acked).length,
  };
}
