import { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";

const WS_URL = "ws://localhost:8000/ws";

// Telemetry is considered STALE when no update has arrived for this long.
// The backend stamps telemetry_updated_at on every MAVLink tick.
const STALE_THRESHOLD_MS = 3000;

// WebSocket reconnect: exponential backoff capped at 16 s.
const WS_INITIAL_DELAY_MS = 500;
const WS_MAX_DELAY_MS     = 16_000;
const WS_BACKOFF_FACTOR   = 2;

const INITIAL_TELEMETRY = {
  altitude: 0, speed: 0, heading: 0,
  battery_pct: 0, battery_voltage: 0,
  mode: "UNKNOWN", armed: false,
  gps_fix_type: 0, satellites_visible: 0,
  hdop: 0,
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
  waypoints: [
    [51.507, -0.088],
    [51.508, -0.092],
    [51.506, -0.096],
    [51.504, -0.092],
    [51.505, -0.088],
  ],
  launchPoint: [51.505, -0.09],
  searchPolygon: [
    [51.509, -0.085],
    [51.509, -0.099],
    [51.503, -0.099],
    [51.503, -0.085],
  ],
  hazardZone: [
    [51.507, -0.094],
    [51.508, -0.094],
    [51.508, -0.097],
    [51.507, -0.097],
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
      if (!mountedRef.current) return;
      setWsConnected(true);
      setWsRetryIn(null);
      delayRef.current = WS_INITIAL_DELAY_MS; // reset backoff on success
    };

    ws.onmessage = (e) => {
      if (!mountedRef.current) return;
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
      } catch (_) {}
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
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
