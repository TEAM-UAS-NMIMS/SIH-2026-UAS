/**
 * LiveRescueScreen — rendered at /live.
 *
 * Three-column layout:
 *   Left   (w-52):  TelemetryColumn   ← live from TelemetryContext
 *   Center (flex-1): FeedAndTimeline  ← video: /api/video_feed; timeline: live events
 *   Right  (w-72):  DetectionsPanel   ← live from TelemetryContext
 *
 * All three columns are wired to the shared WebSocket context.
 * Do NOT touch PreFlightScreen, StatusBar, or any other route's files.
 */

import { useTelemetry } from "../context/TelemetryContext";
import TelemetryColumn from "../components/live/TelemetryColumn";
import FeedAndTimeline from "../components/live/FeedAndTimeline";
import DetectionsPanel from "../components/live/DetectionsPanel";
import MapPanel        from "../components/live/MapPanel";

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LiveRescueScreen() {
  const { telemetry, detections, events } = useTelemetry();

  // Detections accumulate for the whole mission (stable track ids). The live
  // column shows RECENT finds rather than only what is under the camera this
  // instant: at survey speed a casualty is in frame for about four seconds, so
  // an "in view only" list is empty almost all the time and useless to an
  // operator. Cards still mark which targets are currently visible.
  const RECENT_WINDOW_S = 120;
  const nowS = Date.now() / 1000;
  const recentDetections = detections.filter(
    (d) => !d.last_seen || nowS - d.last_seen <= RECENT_WINDOW_S,
  );

  return (
    <main className="h-full flex gap-2 p-2 overflow-hidden">
      {/* Left: telemetry readouts and flight commands */}
      <aside className="w-[15rem] shrink-0 overflow-hidden flex flex-col">
        <TelemetryColumn telemetry={telemetry} />
      </aside>

      {/* Centre: the live feed is the primary instrument and gets the most
          space on the screen, with the event timeline pinned beneath it. */}
      <section className="flex-1 min-w-0 overflow-hidden">
        <FeedAndTimeline events={events} />
      </section>

      {/* Right: map above, detections below. The map keeps its own column so
          the feed is not competing with it for height. */}
      <aside className="w-[24rem] shrink-0 flex flex-col gap-2 overflow-hidden">
        {/* Flex ratios, not percentage heights: a % height on a flex child has
            no definite containing block here and resolves to 0, which silently
            collapsed the map to a blank panel. */}
        <div style={{ flex: "45 1 0", minHeight: 0 }}>
          <MapPanel
            droneLat={telemetry.lat}
            droneLon={telemetry.lon}
            droneHeading={telemetry.heading}
            positionSource={telemetry.position_source}
            detections={recentDetections}
          />
        </div>
        <div style={{ flex: "55 1 0", minHeight: 0 }} className="overflow-hidden">
          <DetectionsPanel
            detections={recentDetections}
            totalSeen={detections.length}
          />
        </div>
      </aside>
    </main>
  );
}
