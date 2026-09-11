"""Shared in-memory mission, telemetry, and detection state."""


import math
import time
import threading
from typing import Any, Dict, List, Optional


class AppState:
    """Thread-safe in-memory state for telemetry, detections, and events."""
    
    def __init__(self):
        self._lock = threading.Lock()

        # Wall-clock time (time.time()) when the current live mission started.
        # Set by start_mission() called from POST /api/mission/end logic.
        self._mission_start_time: Optional[float] = None

        # Computed stats — populated by compute_mission_stats().
        # Returned as-is by GET /api/mission/stats.
        self.mission_stats: Dict[str, Any] = {}

        # Last wall-clock time a telemetry update was received from MAVLink.
        # Exposed in the WS broadcast so the frontend can show a STALE badge
        # when this is older than TELEMETRY_STALE_THRESHOLD_S (default 3 s).
        self.telemetry_updated_at: float = 0.0

        # True while the video pipeline is reading frames successfully.
        # Set to False by the detection pipeline on camera disconnect.
        self.video_signal: bool = False

        self.telemetry: Dict[str, Any] = {
            "altitude": 0.0,
            "speed": 0.0,
            "heading": 0.0,
            "battery_pct": 0.0,
            "battery_voltage": 0.0,
            "mode": "UNKNOWN",
            "armed": False,
            "gps_fix_type": 0,
            "satellites_visible": 0,
            "hdop": 0.0,             # Horizontal dilution of precision (from GPS_RAW_INT)
            "position_source": "NO_POSITION",  # "GNSS", "VIO_FALLBACK", "NO_POSITION"
            "lat": 0.0,
            "lon": 0.0,
            "timestamp": 0.0,
            "phase": "PRE_FLIGHT",   # Current mission phase; starts in PRE_FLIGHT
        }

        # Static mission metadata — editable via /api/mission endpoints in future phases.
        # For now these are pre-populated defaults matching the PreFlight mock shape.
        self.mission: Dict[str, Any] = {
            "name":             "RESCUE_01",
            "type":             "Search & Rescue",
            "area":             "Grid Sector 7-B",
            "priority":         "High",
            "operator":         "Cpt. A. Sharma",
            "estDuration":      "22 min",
            "searchPattern":    "Lawnmower",
            "maxAltitude":      55,
            "overlapPct":       30,
            "coordinateSystem": "WGS-84",
            # Waypoints used by MissionMapEditor (lat/lon pairs)
            "waypoints": [
                [51.507, -0.088],
                [51.508, -0.092],
                [51.506, -0.096],
                [51.504, -0.092],
                [51.505, -0.088],
            ],
            "launchPoint":    [51.505, -0.09],
            "searchPolygon":  [
                [51.509, -0.085],
                [51.509, -0.099],
                [51.503, -0.099],
                [51.503, -0.085],
            ],
            "hazardZone": [
                [51.507, -0.094],
                [51.508, -0.094],
                [51.508, -0.097],
                [51.507, -0.097],
            ],
            "stats": {
                "distanceKm":        3.4,
                "flightTimeMin":     22,
                "coverageHa":        8.7,
                "batteryReservePct": 35,
            },
        }

        self.detections: List[Dict[str, Any]] = []
        self.events: List[Dict[str, Any]] = []

        # Telemetry position history for area-coverage estimate.
        # Appended by update_telemetry() whenever lat/lon are non-zero.
        self._position_history: List[tuple] = []  # [(lat, lon), ...]

    def mark_mission_start(self) -> None:
        """Record wall-clock start time for the current live mission."""
        with self._lock:
            self._mission_start_time = time.time()

    def update_telemetry(self, data: Dict[str, Any]) -> None:
        """Update telemetry dictionary with new data.

        Also stamps telemetry_updated_at and accumulates lat/lon position
        history for area-coverage estimation.
        """
        with self._lock:
            self.telemetry.update(data)
            self.telemetry_updated_at = time.time()
            lat = self.telemetry.get("lat", 0.0)
            lon = self.telemetry.get("lon", 0.0)
            if lat != 0.0 and lon != 0.0:
                self._position_history.append((lat, lon))

    def set_video_signal(self, has_signal: bool) -> None:
        """Update video signal status (called by DetectionPipeline)."""
        with self._lock:
            self.video_signal = has_signal

    def update_mission(self, data: Dict[str, Any]) -> None:
        """Partial-update the mission dict."""
        with self._lock:
            self.mission.update(data)

    def update_detections(self, detections: List[Dict[str, Any]]) -> None:
        """Replace the current list of detections."""
        with self._lock:
            self.detections = detections

    def add_event(self, timestamp: float, message: str, severity: str = "info") -> None:
        """Append an event to the timeline log.
        
        Args:
            timestamp: Event timestamp.
            message: Event description.
            severity: "info", "warning", or "critical".
        """
        with self._lock:
            self.events.append({
                "timestamp": timestamp,
                "message": message,
                "severity": severity
            })

    def compute_mission_stats(self) -> Dict[str, Any]:
        """Derive mission statistics from logged telemetry and events.

        All values are best-effort estimates from in-memory data:

        duration_seconds
            Wall-clock seconds since mark_mission_start(); 0 if not started.

        area_covered_pct
            Rough estimate: ratio of the bounding-box area of the flown path
            to the search polygon's bounding-box area (capped at 100 %).
            Falls back to 0 when fewer than 2 position samples exist.

        survivors_by_priority
            Counts from the current detections list keyed by priority field.

        gnss_outage_seconds
            Sum of seconds between consecutive events whose messages contain
            "GNSS" and "degraded" (start) / "reacquired" (end).

        vio_usage_seconds
            Sum of seconds spent with position_source == "VIO_FALLBACK".
            Derived from events whose messages contain "VIO".
        """
        with self._lock:
            now = time.time()

            # ── Duration ──────────────────────────────────────────────────────
            duration = (
                now - self._mission_start_time
                if self._mission_start_time is not None
                else 0.0
            )

            # ── Area covered (bounding-box ratio) ─────────────────────────────
            area_pct = 0.0
            positions = list(self._position_history)  # snapshot under lock
            if len(positions) >= 2:
                lats = [p[0] for p in positions]
                lons = [p[1] for p in positions]
                flown_lat_span = max(lats) - min(lats)
                flown_lon_span = max(lons) - min(lons)
                flown_area = flown_lat_span * flown_lon_span  # in deg²

                # Search polygon bounding box
                poly = self.mission.get("searchPolygon", [])
                if poly and len(poly) >= 2:
                    p_lats = [p[0] for p in poly]
                    p_lons = [p[1] for p in poly]
                    poly_area = (
                        (max(p_lats) - min(p_lats))
                        * (max(p_lons) - min(p_lons))
                    )
                    if poly_area > 0:
                        area_pct = min(100.0, (flown_area / poly_area) * 100.0)

            # ── Survivors by priority ─────────────────────────────────────────
            survivors: Dict[str, int] = {"high": 0, "medium": 0, "low": 0}
            for det in self.detections:
                p = det.get("priority", "low")
                survivors[p] = survivors.get(p, 0) + 1

            # ── GNSS outage and VIO usage from event log ───────────────────────
            # Strategy: walk the event list in chronological order, tracking
            # open "degraded" intervals (closed by "reacquired") and
            # open "VIO" intervals (closed by next non-VIO position event).
            events_snapshot = list(self.events)

        # (released lock — compute the rest outside)

        gnss_outage_s  = 0.0
        vio_usage_s    = 0.0
        gnss_start: Optional[float] = None
        vio_start:  Optional[float] = None

        for ev in sorted(events_snapshot, key=lambda e: e.get("timestamp", 0)):
            msg = ev.get("message", "").lower()
            ts  = float(ev.get("timestamp", 0))

            # GNSS outage window
            if "gnss" in msg and "degraded" in msg:
                gnss_start = ts
            elif "gnss" in msg and "reacquired" in msg and gnss_start is not None:
                gnss_outage_s += ts - gnss_start
                gnss_start = None

            # VIO usage window
            if "vio" in msg and vio_start is None:
                vio_start = ts
            elif ("gnss" in msg and "reacquired" in msg) and vio_start is not None:
                vio_usage_s += ts - vio_start
                vio_start = None

        # Close any still-open windows using now
        now_ts = time.time()
        if gnss_start is not None:
            gnss_outage_s += now_ts - gnss_start
        if vio_start is not None:
            vio_usage_s += now_ts - vio_start

        stats = {
            "duration_seconds":    round(duration, 1),
            "area_covered_pct":    round(area_pct, 1),
            "survivors_by_priority": survivors,
            "gnss_outage_seconds": round(gnss_outage_s, 1),
            "vio_usage_seconds":   round(vio_usage_s, 1),
            "detection_count":     sum(survivors.values()),
        }

        with self._lock:
            self.mission_stats = stats

        return stats

    def get_state(self) -> Dict[str, Any]:
        """Serialize the whole state to a dict for WebSocket broadcast."""
        with self._lock:
            return {
                "telemetry":         dict(self.telemetry),
                "mission":           dict(self.mission),
                "detections":        list(self.detections),
                "events":            list(self.events),
                # Diagnostics exposed for frontend staleness / signal checks
                "telemetry_updated_at": self.telemetry_updated_at,
                "video_signal":         self.video_signal,
            }


# Global in-memory state instance
app_state = AppState()
