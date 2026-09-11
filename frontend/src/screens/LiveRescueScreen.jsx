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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function LiveRescueScreen() {
  const { telemetry, detections, events } = useTelemetry();

  return (
    <main className="h-full flex gap-3 p-3 overflow-hidden">
      {/* Left: Telemetry column — receives live telemetry object */}
      <aside className="w-52 shrink-0 overflow-hidden flex flex-col">
        <TelemetryColumn telemetry={telemetry} />
      </aside>

      {/* Center: Video feed (pointed at /api/video_feed) + live event timeline */}
      <section className="flex-1 min-w-0 overflow-hidden">
        <FeedAndTimeline events={events} />
      </section>

      {/* Right: Detection cards — receives live detections array */}
      <aside className="w-72 shrink-0 overflow-hidden flex flex-col">
        <DetectionsPanel detections={detections} />
      </aside>
    </main>
  );
}
