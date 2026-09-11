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
import Icon from "../Icon";
import StatusPill from "../StatusPill";
import { api } from "../../config";
import { API_BASE } from "../../config";

// ─── Severity styling ─────────────────────────────────────────────────────────

const SEVERITY = {
  critical: { dot: "bg-red-500",   text: "text-red-600",   label: "CRIT" },
  warning:  { dot: "bg-amber-500", text: "text-amber-600", label: "WARN" },
  info:     { dot: "bg-slate-400", text: "text-[var(--ink-2)]", label: "INFO" },
};

function severityCfg(s) {
  return SEVERITY[s] ?? SEVERITY.info;
}

// ─── VideoFeed ────────────────────────────────────────────────────────────────

// Auto-retry constants for the MJPEG img tag.
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS     = 30_000;
const RETRY_FACTOR     = 2;

function CameraToggle({ cameraOn }) {
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(api(cameraOn ? "/api/camera/stop" : "/api/camera/start"), { method: "POST" });
    } catch {
      /* the panel already shows the resulting signal state */
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className="btn"
      style={cameraOn ? undefined : { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }}
      title={cameraOn ? "Release the camera and stop inference" : "Open the camera and start inference"}
    >
      {busy ? "…" : cameraOn ? "Stop Camera" : "Start Camera"}
    </button>
  );
}

function VideoFeed({ noSignal, cameraOn }) {
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
      {/* Header bar. A healthy feed is stated quietly; only a lost feed
          or an offline stream takes colour. */}
      <div className="panel-head">
        <h2 className="panel-title">Live Feed</h2>
        <div className="flex items-center gap-2.5">
          <CameraToggle cameraOn={cameraOn} />
          {cameraOn && !errored && !noSignal && (
            <StatusPill tone="nominal" label="Streaming" dot pulse
              title="MJPEG stream active" />
          )}
          {cameraOn && showNoSignal && (
            <StatusPill tone="caution" label="No Signal" dot pulse
              title="Camera disconnected — reconnecting automatically" />
          )}
          {cameraOn && showOffline && (
            <StatusPill
              tone="critical"
              label={`Offline${retryIn !== null ? ` · ${retryIn}s` : ""}`}
              dot
              title="Video stream unreachable" />
          )}
          <span className="text-[10px] font-mono" style={{ color: "var(--ink-3)" }}>
            YOLOv8n · person
          </span>
        </div>
      </div>

      {/* Feed area */}
      <div className="flex-1 flex items-center justify-center min-h-0 relative" style={{ background: "#0A0A0A" }}>
        {!cameraOn ? (
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <Icon name="camera" size={32} style={{ color: "#6B6B6B" }} />
            <p className="text-xs font-semibold uppercase tracking-[0.16em]"
               style={{ color: "#B8B8B8" }}>
              Camera off
            </p>
            <p className="text-[11px] font-mono" style={{ color: "#7A7A7A" }}>
              Press Start Camera to open the payload and begin YOLO inference
            </p>
          </div>
        ) : showNoSignal ? (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <Icon name="camera" size={30} style={{ color: "#D8A94A" }} />
            <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: "#D8A94A" }}>
              No Signal
            </p>
            <p className="text-[var(--ink-2)] text-[10px] font-mono">
              Camera disconnected — auto-reconnecting…
            </p>
          </div>
        ) : showOffline ? (
          <div className="flex flex-col items-center gap-2 text-center px-4">
            <Icon name="satellite-dish" size={24} className="text-[var(--ink-3)]" />
            <p className="text-[var(--ink-3)] text-xs font-medium">
              Video feed unavailable
            </p>
            {retryIn !== null && (
              <p className="text-[var(--ink-2)] text-[10px] font-mono">
                Auto-retry in {retryIn}s…
              </p>
            )}
            <p className="text-[var(--ink-2)] text-[10px] font-mono">
              {API_BASE.replace(/^https?:\/\//, "")}/api/video_feed
            </p>
            <button
              onClick={handleManualRetry}
              className="mt-1 px-3 py-1 text-[10px] font-bold uppercase tracking-widest
                         rounded bg-white text-black hover:bg-[var(--surface-2)] transition-colors"
            >
              Retry Now
            </button>
          </div>
        ) : (
          <img
            key={imgKey}
            src={`${API_BASE}/api/video_feed?k=${imgKey}`}
            alt="YOLO annotated drone feed"
            className="w-full h-full object-contain"
            style={{ imageRendering: "auto" }}
            onError={handleError}
          />
        )}

        {/* Corner overlay: feed metadata */}
        {!errored && !noSignal && (
          <div className="absolute bottom-2 left-2 right-2 flex items-end justify-between pointer-events-none">
            <span className="text-[9px] font-mono text-white/45 px-1.5 py-0.5"
              style={{ background: "rgba(0,0,0,.45)", borderRadius: 2 }}>
              {API_BASE.replace(/^https?:\/\//, "")}/api/video_feed
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
          <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest">
            Event Timeline
          </h2>
          {issueCount > 0 && (
            <span className="pill-amber text-[10px]">
              {issueCount} alert{issueCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--ink-3)] tabular-nums">
            {events.length} events
          </span>
          <span className="text-[var(--ink-3)] text-xs leading-none">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Event list */}
      {open && (
        <div
          ref={listRef}
          className="max-h-64 overflow-y-auto scroll-thin px-3 pb-2.5 flex flex-col gap-1"
        >
          {events.length === 0 && (
            <p className="text-xs text-[var(--ink-3)] italic py-1">No events yet.</p>
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
                  <span className="text-[10px] text-[var(--ink-3)] font-mono shrink-0 mt-0.5 tabular-nums">
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
  // The video feed is the primary instrument on this screen, so it now owns the
  // whole centre column and the map has moved beside it (see LiveRescueScreen).
  // The timeline stays pinned beneath the feed and collapses to a header.
  const { videoSignal, cameraOn } = useTelemetry();

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      <VideoFeed noSignal={!videoSignal} cameraOn={cameraOn} />
      <EventTimeline events={events} />
    </div>
  );
}

export { MapPanel };
