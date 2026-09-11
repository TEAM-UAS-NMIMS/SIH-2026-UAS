import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { WS_URL } from "../config";

// WS URL follows the same env-driven base as the REST API.

// Telemetry is considered STALE when no update has arrived for this long.
// The backend stamps telemetry_updated_at on every MAVLink tick.
const STALE_THRESHOLD_MS = 3000;

// WebSocket reconnect: exponential backoff capped at 16 s.
const WS_INITIAL_DELAY_MS = 500;
const WS_MAX_DELAY_MS     = 16_000;
const WS_BACKOFF_FACTOR   = 2;

// null means "not reported yet" and MUST render as an explicit no-data state,
// never as 0 — a 0% battery or a level horizon is a confident lie about the
// aircraft. Only fields that are genuinely zero at rest default to 0.
const INITIAL_TELEMETRY = {
  altitude: null, speed: null, heading: null,
  battery_pct: null, battery_voltage: null,
  roll: null, pitch: null, yaw: null, altitude_msl: null,
  mode: "UNKNOWN", armed: false,
  gps_fix_type: 0, satellites_visible: 0,
  hdop: null,
  position_source: "NO_POSITION",
  lat: 0, lon: 0, timestamp: 0,
  phase: "PRE_FLIGHT",
};

// Default mission shape — matches state.py defaults.
// Replaced entirely on each WS message that carries a mission key.
const INITIAL_MISSION = {
  name: "RESCUE_01",
  type: "Search & Rescue",
  area: "Grid Sector 7-B",
  priority: "High",
  operator: "Cpt. A. Sharma",
  estDuration: "22 min",
  searchPattern: "Lawnmower",
  maxAltitude: 55,
  overlapPct: 30,
  coordinateSystem: "WGS-84",
  // NMIMS Shirpur campus — mirrors backend/app/state.py. Replaced wholesale by
  // the first WebSocket message; this only covers the pre-connect render.
  waypoints: [
    [21.34980, 74.87760],
    [21.35060, 74.88180],
    [21.34760, 74.88320],
    [21.34600, 74.87960],
    [21.34800, 74.87720],
  ],
  launchPoint: [21.34860, 74.87980],
  searchPolygon: [
    [21.35140, 74.87600],
    [21.35140, 74.88400],
    [21.34540, 74.88400],
    [21.34540, 74.87600],
  ],
  hazardZone: [
    [21.34520, 74.87680],
    [21.34620, 74.87680],
    [21.34620, 74.88020],
    [21.34520, 74.88020],
  ],
  stats: {
    distanceKm: 3.4,
    flightTimeMin: 22,
    coverageHa: 8.7,
    batteryReservePct: 35,
  },
};

const TelemetryContext = createContext(null);

export function TelemetryProvider({ children }) {
  const [telemetry,    setTelemetry]    = useState(INITIAL_TELEMETRY);
  const [mission,      setMission]      = useState(INITIAL_MISSION);
  const [detections,   setDetections]   = useState([]);
  const [events,       setEvents]       = useState([]);
  const [wsConnected,  setWsConnected]  = useState(false);
  const [wsRetryIn,    setWsRetryIn]    = useState(null); // seconds until next reconnect attempt
  const [telemetryStale, setTelemetryStale] = useState(false);
  const [videoSignal,  setVideoSignal]  = useState(false);
  const [demoMode,     setDemoMode]     = useState(false);
  const [cameraOn,     setCameraOn]     = useState(false);
  const [preflightAcks, setPreflightAcks] = useState({});
  const [missionStart, setMissionStart] = useState(null);   // epoch seconds

  // Wall-clock of last received telemetry_updated_at from backend
  const lastTelemetryRef = useRef(0);
  const wsRef            = useRef(null);
  const delayRef         = useRef(WS_INITIAL_DELAY_MS);
  const retryTimerRef    = useRef(null);
  const staleTimerRef    = useRef(null);
  const mountedRef       = useRef(true);

  // ── Staleness check ──────────────────────────────────────────────────────
  // Runs every second; compares now vs lastTelemetryRef.
  useEffect(() => {
    // Re-arm on every (re)mount. StrictMode runs mount -> cleanup -> remount in
    // dev, and the cleanup below sets this to false; without re-arming it here
    // the ref stays false forever and every WS handler bails out early.
    mountedRef.current = true;
    staleTimerRef.current = setInterval(() => {
      if (!mountedRef.current) return;
      const age = Date.now() - lastTelemetryRef.current;
      // Consider stale when: we've received at least one update (> 0) AND it's old,
      // OR we've never received one and the WS has been connected for a while.
      const isStale = lastTelemetryRef.current > 0 && age > STALE_THRESHOLD_MS;
      setTelemetryStale(isStale);
    }, 1000);
    return () => {
      mountedRef.current = false;
      clearInterval(staleTimerRef.current);
    };
  }, []);

  // ── WebSocket connect / exponential backoff ───────────────────────────────
  const connect = useCallback(() => {
    if (!mountedRef.current) return;
    clearTimeout(retryTimerRef.current);

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      setWsConnected(true);
      setWsRetryIn(null);
      delayRef.current = WS_INITIAL_DELAY_MS; // reset backoff on success
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current || wsRef.current !== ws) return;
      try {
        const data = JSON.parse(e.data);
        if (data.telemetry)  setTelemetry((prev) => ({ ...prev, ...data.telemetry }));
        if (data.mission)    setMission((prev)   => ({ ...prev, ...data.mission }));
        if (data.detections) setDetections(data.detections);
        if (data.events)     setEvents(data.events);

        // Stamp last-received time for staleness tracking.
        // telemetry_updated_at is a backend wall-clock float (seconds);
        // convert to ms so we can compare with Date.now().
        if (data.telemetry_updated_at) {
          lastTelemetryRef.current = data.telemetry_updated_at * 1000;
        }
        if (data.video_signal !== undefined) {
          setVideoSignal(data.video_signal);
        }
        if (data.demo_mode !== undefined) {
          setDemoMode(data.demo_mode);
        }
        if (data.camera_enabled !== undefined) {
          setCameraOn(data.camera_enabled);
        }
        if (data.preflight_acks !== undefined) {
          setPreflightAcks(data.preflight_acks);
        }
        if (data.mission_start_time !== undefined) {
          setMissionStart(data.mission_start_time);
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      // Ignore the close of a socket we have already replaced (StrictMode
      // remount / HMR), otherwise we would schedule a duplicate reconnect.
      if (!mountedRef.current || wsRef.current !== ws) return;
      setWsConnected(false);

      // Exponential backoff countdown display
      const delay = delayRef.current;
      delayRef.current = Math.min(delay * WS_BACKOFF_FACTOR, WS_MAX_DELAY_MS);

      // Show countdown in the UI
      let remaining = Math.ceil(delay / 1000);
      setWsRetryIn(remaining);
      const countdownId = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownId);
          setWsRetryIn(null);
        } else {
          setWsRetryIn(remaining);
        }
      }, 1000);

      retryTimerRef.current = setTimeout(() => {
        clearInterval(countdownId);
        setWsRetryIn(null);
        connect();
      }, delay);
    };

    ws.onerror = () => ws.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      clearTimeout(retryTimerRef.current);
    };
  }, [connect]);

  return (
    <TelemetryContext.Provider
      value={{
        telemetry,
        mission,
        detections,
        events,
        wsConnected,
        wsRetryIn,       // seconds until next WS reconnect attempt (null = not waiting)
        telemetryStale,  // true when last MAVLink update is > STALE_THRESHOLD_MS old
        videoSignal,     // true when the backend camera has an active feed
        demoMode,        // true while the mission simulator is driving state
        cameraOn,        // true when the operator has started the camera payload
        preflightAcks,   // operator checklist confirmations, persisted server-side
        missionStart,    // epoch seconds of mission start (golden-hour clock)
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error("useTelemetry must be used inside TelemetryProvider");
  return ctx;
}
