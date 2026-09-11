/**
 * FeedAndTimeline — center column of LiveRescueScreen.
 * Props: { events }
 *
 * Three sub-sections stacked vertically (top → bottom):
 *  1. MapPanel     — live drone + detection map (above video, 40% height)
 *  2. VideoFeed    — MJPEG stream at /api/video_feed (flex-1)
 *  3. EventTimeline — collapsible event list, auto-scrolls to newest event
 *
 * MapPanel receives its telemetry/detections slice directly from
 * TelemetryContext so it stays decoupled from the events prop.
 */
import { useState, useEffect, useRef } from "react";
import { useTelemetry } from "../../context/TelemetryContext";
import MapPanel from "./MapPanel";

// ─── Severity styling ─────────────────────────────────────────────────────────

const SEVERITY = {
  critical: { dot: "bg-red-500",   text: "text-red-600",   label: "CRIT" },
  warning:  { dot: "bg-amber-500", text: "text-amber-600", label: "WARN" },
  info:     { dot: "bg-slate-400", text: "text-slate-500", label: "INFO" },
};

function severityCfg(s) {
  return SEVERITY[s] ?? SEVERITY.info;
}

// ─── VideoFeed ────────────────────────────────────────────────────────────────

// Auto-retry constants for the MJPEG img tag.
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS     = 30_000;
const RETRY_FACTOR     = 2;

function VideoFeed({ noSignal }) {
  const [errored, setErrored] = useState(false);
  const [retryIn, setRetryIn] = useState(null); // seconds until auto-retry
  const [imgKey,  setImgKey]  = useState(0);    // bump to re-mount <img>
  const delayRef = useRef(INITIAL_RETRY_MS);
  const timerRef = useRef(null);

  // Auto-retry on HTTP error: countdown + re-mount img
  function scheduleRetry() {
    const delay = delayRef.current;
    delayRef.current = Math.min(delay * RETRY_FACTOR, MAX_RETRY_MS);
    let remaining = Math.ceil(delay / 1000);
    setRetryIn(remaining);
    const countId = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) clearInterval(countId);
      else setRetryIn(remaining);
    }, 1000);
    timerRef.current = setTimeout(() => {
      clearInterval(countId);
      setRetryIn(null);
      setErrored(false);
      setImgKey((k) => k + 1);
    }, delay);
  }

  // When backend signals camera restored, clear error and re-request stream
  useEffect(() => {
    if (noSignal === false) {
      clearTimeout(timerRef.current);
      delayRef.current = INITIAL_RETRY_MS;
      setErrored(false);
      setRetryIn(null);
      setImgKey((k) => k + 1);
    }
  }, [noSignal]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  function handleError() {
    if (!errored) {
      setErrored(true);
      scheduleRetry();
    }
  }

  function handleManualRetry() {
    clearTimeout(timerRef.current);
    delayRef.current = INITIAL_RETRY_MS;
    setErrored(false);
    setRetryIn(null);
    setImgKey((k) => k + 1);
  }

  const showNoSignal = noSignal && !errored;
  const showOffline  = errored;

  return (
    <div className="panel overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Header bar */}
      <div className="px-3 pt-2.5 pb-2 flex items-center justify-between shrink-0 border-b border-slate-100">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Live Feed
        </h2>
        <div className="flex items-center gap-2">
          {!errored && !noSignal && (
            <span className="pill-red text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              MJPEG
            </span>
          )}
          {showNoSignal && (
            <span className="pill-amber text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              NO SIGNAL
            </span>
          )}
          {showOffline && (
            <span className="pill-slate text-[10px]">
              OFFLINE{retryIn !== null ? ` · retry ${retryIn}s` : ""}
            </span>
          )}
          <span className="text-[10px] text-slate-400 font-mono">
            YOLOv8n · person
          </span>
        </div>
      </div>

      {/* Feed area */}
      <div className="flex-1 bg-slate-950 flex items-center justify-center min-h-0 relative">
        {showNoSignal ? (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <span className="text-3xl">📷</span>
            <p className="text-amber-400 text-xs font-bold uppercase tracking-widest">
              No Signal
            </p>
            <p className="text-slate-500 text-[10px] font-mono">
              Camera disconnected — auto-reconnecting…
            </p>
          </div>
        ) : showOffline ? (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <span className="text-2xl">📡</span>
            <p className="text-slate-400 text-xs font-medium">
              Video feed unavailable
            </p>
            {retryIn !== null && (
              <p className="text-slate-500 text-[10px] font-mono">
                Auto-retry in {retryIn}s…
              </p>
            )}
            <p className="text-slate-600 text-[10px] font-mono">
              localhost:8000/api/video_feed
            </p>
            <button
              onClick={handleManualRetry}
              className="mt-1 px-3 py-1 text-[10px] font-bold uppercase tracking-widest
                         rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
            >
              Retry Now
            </button>
          </div>
        ) : (
          <img
            key={imgKey}
            src="http://localhost:8000/api/video_feed"
            alt="YOLO annotated drone feed"
            className="w-full h-full object-contain"
            onError={handleError}
          />
        )}

        {/* Corner overlay: feed metadata */}
        {!errored && !noSignal && (
          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between pointer-events-none">
            <span className="text-[9px] font-mono text-white/40 bg-black/30 rounded px-1.5 py-0.5">
              localhost:8000/api/video_feed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── EventTimeline ────────────────────────────────────────────────────────────

function EventTimeline({ events }) {
  const [open, setOpen] = useState(true);
  const listRef = useRef(null);

  // Auto-scroll to bottom (newest) whenever events list changes
  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [events, open]);

  const issueCount = events.filter(
    (e) => e.severity === "critical" || e.severity === "warning"
  ).length;

  return (
    <div className="panel flex flex-col shrink-0">
      {/* Collapsible header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
            Event Timeline
          </h2>
          {issueCount > 0 && (
            <span className="pill-amber text-[10px]">
              {issueCount} alert{issueCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 tabular-nums">
            {events.length} events
          </span>
          <span className="text-slate-400 text-xs leading-none">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Event list */}
      {open && (
        <div
          ref={listRef}
          className="max-h-36 overflow-y-auto px-3 pb-2.5 flex flex-col gap-1"
        >
          {events.length === 0 && (
            <p className="text-xs text-slate-400 italic py-1">No events yet.</p>
          )}
          {/* Show newest first (reverse) but render top-to-bottom */}
          {events
            .slice()
            .reverse()
            .map((ev, i) => {
              const cfg = severityCfg(ev.severity);
              return (
                <div key={i} className="flex items-start gap-2 py-0.5">
                  {/* Severity dot */}
                  <span
                    className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${cfg.dot}`}
                  />
                  {/* Timestamp */}
                  <span className="text-[10px] text-slate-400 font-mono shrink-0 mt-0.5 tabular-nums">
                    {new Date(ev.timestamp * 1000).toLocaleTimeString()}
                  </span>
                  {/* Severity label */}
                  <span
                    className={`text-[10px] font-bold shrink-0 mt-0.5 w-7 ${cfg.text}`}
                  >
                    {cfg.label}
                  </span>
                  {/* Message */}
                  <span className={`text-xs font-medium ${cfg.text} leading-tight`}>
                    {ev.message}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─── FeedAndTimeline ─────────────────────────────────────────────────────────

export default function FeedAndTimeline({ events }) {
  // Pull the map-relevant slice from the shared WebSocket context.
  // TelemetryColumn and DetectionsPanel are untouched.
  const { telemetry, detections, videoSignal } = useTelemetry();

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      {/* Map — top 40% of column height; stays above the video feed */}
      <div className="shrink-0" style={{ height: "40%" }}>
        <MapPanel
          droneLat={telemetry.lat}
          droneLon={telemetry.lon}
          droneHeading={telemetry.heading}
          positionSource={telemetry.position_source}
          detections={detections}
        />
      </div>

      {/* Video feed — fills remaining space between map and timeline.
          Pass noSignal so VideoFeed can show the right placeholder. */}
      <VideoFeed noSignal={!videoSignal} />

      {/* Timeline — pinned at bottom, shrinks to its own content height */}
      <EventTimeline events={events} />
    </div>
  );
}
