import StatusPill from "../StatusPill";

/**
 * HazardPanel — what degraded during the mission.
 *
 * Filtered from the event log by severity, because a rescue coordinator
 * reviewing a sortie needs the exceptions, not the full narrative: when GNSS
 * dropped, when the video link failed, when a command was refused. Each of
 * those casts doubt on specific detections, so the panel also explains the
 * consequence rather than only the fact.
 */

const CONSEQUENCE = {
  gnss_lost:
    "Positions during this window came from VIO dead-reckoning. Detection "
    + "coordinates carry roughly 8 m of uncertainty instead of 2 m — verify on approach.",
  gnss_reacquired:
    "GNSS restored; positions from here are satellite-derived again.",
  mavlink_lost:
    "Telemetry stopped. Altitude and heading were unavailable, so any detection "
    + "in this window could not be geolocated at all.",
  camera_stopped:
    "Camera released; no imagery and no detections during this period.",
  command_no_ack:
    "A flight command was sent but never acknowledged. Treat it as NOT executed.",
  demo_started:
    "Simulated mission — all telemetry and detections after this point are synthetic.",
};

function clock(ts) {
  return new Date(ts * 1000).toLocaleTimeString("en-GB");
}

export default function HazardPanel({ events }) {
  const hazards = events.filter((e) => e.severity !== "info");

  if (!hazards.length) {
    return (
      <p className="notice">
        No hazards or degradations logged. GNSS held, the telemetry link stayed
        up, and no command went unacknowledged.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {hazards
        .slice()
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((e, i) => (
          <div
            key={`${e.timestamp}-${i}`}
            className="px-2.5 py-2"
            style={{
              border: "1px solid var(--rule)",
              borderLeft: `3px solid ${
                e.severity === "critical" ? "var(--critical)" : "var(--caution)"
              }`,
            }}
          >
            <div className="flex items-center gap-2">
              <StatusPill
                tone={e.severity === "critical" ? "critical" : "caution"}
                label={e.severity}
                dot
              />
              <span
                className="text-[10.5px] tabular-nums"
                style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace' }}
              >
                {clock(e.timestamp)}
              </span>
            </div>
            <p className="text-[12px] mt-1 leading-snug">{e.message}</p>
            {CONSEQUENCE[e.event_type] && (
              <p className="text-[10.5px] mt-1 leading-snug" style={{ color: "var(--ink-2)" }}>
                <strong>Effect on the record: </strong>
                {CONSEQUENCE[e.event_type]}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
