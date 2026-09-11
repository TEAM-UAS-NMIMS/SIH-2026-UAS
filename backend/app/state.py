"""Shared in-memory mission, telemetry, and detection state."""


import math
import time
import threading
from typing import Any, Dict, List, Optional

from app.tracking import DetectionTracker


# Retention caps. Both of these previously grew without bound for the life of
# the process; _position_history at the MAVLink position rate would exhaust
# memory on a long mission.
MAX_EVENTS = 2000
MAX_POSITION_SAMPLES = 5000


# Cruise assumptions used to turn a drawn route into time/endurance figures.
# Exposed as constants so the planner numbers can be traced to an assumption
# rather than appearing as unexplained magic.
CRUISE_SPEED_MS      = 8.0
TURN_PENALTY_S       = 4.0      # per waypoint, for decelerate/turn/accelerate
BATTERY_ENDURANCE_S  = 37 * 60  # airframe endurance at survey power


def _ground_distance_m(lat1, lon1, lat2, lon2) -> float:
    dn = (lat2 - lat1) * 111_111.0
    de = (lon2 - lon1) * 111_111.0 * math.cos(math.radians(lat1))
    return math.hypot(dn, de)


def _polygon_area_m2(poly) -> float:
    """Shoelace area of a lat/lon polygon, projected locally to metres."""
    if not poly or len(poly) < 3:
        return 0.0
    lat0 = sum(p[0] for p in poly) / len(poly)
    mx = 111_111.0 * math.cos(math.radians(lat0))
    pts = [(p[1] * mx, p[0] * 111_111.0) for p in poly]
    acc = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        acc += x1 * y2 - x2 * y1
    return abs(acc) / 2.0


def _compute_route_stats(mission: Dict[str, Any]) -> Dict[str, Any]:
    """Derive planner figures from the route the operator actually drew.

    These were previously a hardcoded literal (3.4 km / 22 min / 8.7 ha), so
    they contradicted the map the moment a waypoint moved.
    """
    wps = mission.get("waypoints") or []
    launch = mission.get("launchPoint")

    # Route: launch -> each waypoint -> back to launch (the aircraft returns).
    legs = []
    if launch and wps:
        legs.append((launch, wps[0]))
    for i in range(len(wps) - 1):
        legs.append((wps[i], wps[i + 1]))
    if launch and wps:
        legs.append((wps[-1], launch))

    distance_m = sum(
        _ground_distance_m(a[0], a[1], b[0], b[1]) for a, b in legs
    )

    flight_s = (distance_m / CRUISE_SPEED_MS if CRUISE_SPEED_MS else 0.0)
    flight_s += TURN_PENALTY_S * max(0, len(wps))

    poly_m2 = _polygon_area_m2(mission.get("searchPolygon") or [])

    reserve_pct = 0.0
    if BATTERY_ENDURANCE_S > 0:
        used = min(1.0, flight_s / BATTERY_ENDURANCE_S)
        reserve_pct = max(0.0, (1.0 - used) * 100.0)

    return {
        "distanceKm":        round(distance_m / 1000.0, 2),
        "flightTimeMin":     round(flight_s / 60.0, 1),
        "coverageHa":        round(poly_m2 / 10_000.0, 2),
        "batteryReservePct": round(reserve_pct),
        "waypointCount":     len(wps),
        "assumedSpeedMs":    CRUISE_SPEED_MS,
    }


class AppState:
    """Thread-safe in-memory state for telemetry, detections, and events."""
    
    def __init__(self):
        self._lock = threading.Lock()

        # Wall-clock time (time.time()) when the current live mission started.
        # Set by start_mission() called from POST /api/mission/end logic.
        self._mission_start_time: Optional[float] = None

        # Computed stats — populated by compute_mission_stats().
        # Only served as-is by GET /api/mission/stats once the mission has
        # ended; before that the endpoint recomputes a live snapshot, otherwise
        # the first call would freeze the numbers for the rest of the session.
        self.mission_stats: Dict[str, Any] = {}
        self.mission_stats_locked: bool = False

        # Last wall-clock time a telemetry update was received from MAVLink.
        # Exposed in the WS broadcast so the frontend can show a STALE badge
        # when this is older than TELEMETRY_STALE_THRESHOLD_S (default 3 s).
        self.telemetry_updated_at: float = 0.0

        # True while the video pipeline is reading frames successfully.
        # Set to False by the detection pipeline on camera disconnect.
        self.video_signal: bool = False

        # True while the mission simulator is driving the state. Broadcast on
        # every frame so the UI can show an unmissable banner. Never default-on.
        self.demo_mode: bool = False

        # The camera payload is operator-controlled and starts OFF.
        self.camera_enabled: bool = False

        # Operator acknowledgements for checklist items that no sensor can
        # verify (props inspected, observer posted, airspace cleared...).
        # Persisted here so they survive navigation and appear in the report:
        # a checklist is a legal record of what the crew actually checked.
        # {item_id: {"ack": bool, "at": epoch, "by": str}}
        self.preflight_acks: Dict[str, Dict[str, Any]] = {}

        self.telemetry: Dict[str, Any] = {
            "altitude": 0.0,
            "speed": 0.0,
            "heading": 0.0,
            "battery_pct": None,     # None = MAVLink reported "unknown" (-1)
            "battery_voltage": None,  # None = MAVLink reported "unknown" (65535)
            "mode": "UNKNOWN",
            "armed": False,
            "gps_fix_type": 0,
            "satellites_visible": 0,
            "hdop": None,            # Horizontal dilution of precision; None = not received
            "roll": None,            # degrees, from ATTITUDE; None = not received
            "pitch": None,           # degrees, from ATTITUDE
            "yaw": None,             # degrees, from ATTITUDE
            "altitude_msl": None,    # metres above mean sea level (display only)
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
            # NMIMS Shirpur campus, Maharashtra. Approximate campus centre —
            # drag the search polygon in the Mission Map Editor to match the
            # exact area you intend to survey.
            "waypoints": [
                [21.34980, 74.87760],
                [21.35060, 74.88180],
                [21.34760, 74.88320],
                [21.34600, 74.87960],
                [21.34800, 74.87720],
            ],
            "launchPoint":    [21.34860, 74.87980],
            "searchPolygon":  [
                [21.35140, 74.87600],
                [21.35140, 74.88400],
                [21.34540, 74.88400],
                [21.34540, 74.87600],
            ],
            # Hazard zone overlapping the southern search lanes — in a real
            # SAR tasking the hazard (flood front, fire line, debris field) is
            # precisely why casualties are where they are, so the ranking
            # engine's proximity term is meaningful rather than inert.
            "hazardZone": [
                [21.34520, 74.87680],
                [21.34620, 74.87680],
                [21.34620, 74.88020],
                [21.34520, 74.88020],
            ],
            # Populated immediately below from the seed geometry, and
            # recomputed on every geometry edit.
            "stats": {},
        }
        self.mission["stats"] = _compute_route_stats(self.mission)

        # Detections are accumulated as stable tracks for the whole mission,
        # NOT replaced per inference frame. See app/tracking.py.
        self.tracker = DetectionTracker()

        # Analyst decisions, keyed by track_id and held separately from the
        # tracker so a new inference frame can never overwrite them.
        # {track_id: {"status": ..., "priority": ..., "notes": ...}}
        self.review_overrides: Dict[str, Dict[str, Any]] = {}

        self.events: List[Dict[str, Any]] = []

        # Telemetry position history for area-coverage estimate.
        # Appended by update_telemetry() whenever lat/lon are non-zero.
        # [(timestamp, lat, lon), ...] — bounded, see _decimate_positions_locked.
        self._position_history: List[tuple] = []

    def _decimate_positions_locked(self) -> None:
        """Keep the position history bounded without losing the flight shape.

        Rather than hard-truncating (which would delete the start of the
        mission), we halve the resolution of the OLDER half whenever the cap is
        exceeded. Recent movement stays full-rate; early legs coarsen
        gracefully. Caller must hold the lock.
        """
        if len(self._position_history) <= MAX_POSITION_SAMPLES:
            return
        half = len(self._position_history) // 2
        older = self._position_history[:half][::2]     # every 2nd old sample
        recent = self._position_history[half:]
        self._position_history = older + recent

    def get_flight_path(self) -> List[Dict[str, Any]]:
        """The flown path as [{t, lat, lon}, ...], oldest first.

        Exposed via GET /api/flight_path so the Analysis screen reads the real
        recorded path instead of rebuilding a partial one from whatever
        telemetry arrived while that screen happened to be mounted.
        """
        with self._lock:
            return [
                {"t": t, "lat": lat, "lon": lon}
                for (t, lat, lon) in self._position_history
            ]

    def mark_mission_start(self, reset_record: bool = True) -> None:
        """Begin a new sortie.

        By default this clears the mission-scoped record: detections, analyst
        reviews, the flown track and the computed stats. Without that, a second
        sortie inherits the first one's casualties and the report describes two
        flights as though they were one — during testing this produced nine
        tracks for five casualties.

        Mission metadata, geometry and crew checklist confirmations deliberately
        survive: those belong to the tasking, not to a single flight.
        """
        with self._lock:
            self._mission_start_time = time.time()
            self.mission_stats_locked = False
            if reset_record:
                self.tracker.reset()
                self.review_overrides.clear()
                self._position_history.clear()
                self.events.clear()
                self.mission_stats = {}

    def lock_mission_stats(self) -> None:
        """Freeze the computed stats as the final post-mission record."""
        with self._lock:
            self.mission_stats_locked = True

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
                self._position_history.append((time.time(), lat, lon))
                self._decimate_positions_locked()

    def set_demo_mode(self, active: bool) -> None:
        """Flag the whole console as showing simulated data."""
        with self._lock:
            self.demo_mode = active

    def acknowledge_preflight(self, item_id: str, ack: bool, by: str = "operator") -> Dict[str, Any]:
        """Record (or clear) an operator's tick against a checklist item."""
        with self._lock:
            if ack:
                self.preflight_acks[item_id] = {
                    "ack": True, "at": time.time(), "by": by,
                }
            else:
                self.preflight_acks.pop(item_id, None)
            return dict(self.preflight_acks)

    def reset_preflight_acks(self) -> None:
        with self._lock:
            self.preflight_acks.clear()

    def set_camera_enabled(self, enabled: bool) -> None:
        with self._lock:
            self.camera_enabled = enabled

    def set_video_signal(self, has_signal: bool) -> None:
        """Update video signal status (called by DetectionPipeline)."""
        with self._lock:
            self.video_signal = has_signal

    def update_geometry(self, geometry: Dict[str, Any]) -> Dict[str, Any]:
        """Persist edited mission geometry from the planner.

        Waypoints, the search polygon, the geofence and the launch point are
        written into mission state so they survive navigation and a reload, and
        so the aircraft/report consume what the operator actually drew rather
        than the seed defaults.
        """
        allowed = {"waypoints", "searchPolygon", "hazardZone", "geofence", "launchPoint"}
        with self._lock:
            for key, value in geometry.items():
                if key in allowed and value is not None:
                    self.mission[key] = value
            self.mission["stats"] = _compute_route_stats(self.mission)
            return dict(self.mission)

    def update_mission(self, data: Dict[str, Any]) -> None:
        """Partial-update the mission dict."""
        with self._lock:
            self.mission.update(data)

    def update_detections(
        self,
        observations: List[Dict[str, Any]],
        frame_w: int = 0,
        frame_h: int = 0,
    ) -> List[str]:
        """Fold one inference frame's observations into the persistent tracker.

        Observations carry no identity of their own — the tracker assigns and
        reuses a stable track_id. Nothing here discards prior detections.
        """
        with self._lock:
            return self.tracker.update(observations, frame_w, frame_h)

    def get_detections(self) -> List[Dict[str, Any]]:
        """All tracks seen this mission, with analyst overrides merged on top."""
        with self._lock:
            return self._detections_locked()

    def _detections_locked(self) -> List[Dict[str, Any]]:
        """Caller must hold the lock."""
        out = []
        for det in self.tracker.all_tracks():
            override = self.review_overrides.get(det["id"])
            if override:
                det.update(override)
            det.setdefault("status", "pending")
            out.append(det)
        return out

    def apply_review(
        self,
        track_id: str,
        status: Optional[str] = None,
        priority: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Record an analyst decision against a track.

        Written to review_overrides rather than onto the track itself, so the
        next inference frame cannot erase it. Returns the merged detection, or
        None if no such track exists.
        """
        with self._lock:
            known = {d["id"] for d in self.tracker.all_tracks()}
            if track_id not in known:
                return None

            entry = self.review_overrides.setdefault(track_id, {})
            if status is not None:
                entry["status"] = status
            if priority is not None:
                entry["priority"] = priority
            if notes is not None:
                entry["notes"] = notes

            for det in self._detections_locked():
                if det["id"] == track_id:
                    return det
            return None

    def add_event(
        self,
        timestamp: float,
        message: str,
        severity: str = "info",
        event_type: str = "generic",
    ) -> None:
        """Append an event to the timeline log.

        Args:
            timestamp:  Event timestamp.
            message:    Human-readable description (display only).
            severity:   "info", "warning", or "critical".
            event_type: Machine-readable kind, e.g. "gnss_lost" /
                        "gnss_reacquired". Statistics key off THIS, never off
                        substrings of `message` — the previous code looked for
                        "degraded" in text that actually said "lost", so GNSS
                        outage silently reported 0.0 forever.

        The log is bounded: oldest events are evicted past MAX_EVENTS so a long
        mission cannot exhaust memory.
        """
        with self._lock:
            self.events.append({
                "timestamp":  timestamp,
                "message":    message,
                "severity":   severity,
                "event_type": event_type,
            })
            if len(self.events) > MAX_EVENTS:
                del self.events[: len(self.events) - MAX_EVENTS]

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

            # ── Area covered (sensor swath along the flown path) ──────────
            # The previous bounding-box ratio reported 0% for a straight leg,
            # because a single lane has zero span on one axis — so a survey that
            # had genuinely covered a corridor read as having covered nothing.
            #
            # Instead: integrate the camera's ground swath along the path.
            #   swath_width = 2 * altitude_agl * tan(HFOV / 2)
            #   covered     = sum(segment_length) * swath_width
            # Overlap between adjacent lanes is NOT subtracted, so this is an
            # upper bound; it is capped at the search polygon's own area and
            # labelled as an estimate wherever it is displayed.
            area_pct = 0.0
            positions = list(self._position_history)   # snapshot under lock
            altitude = self.telemetry.get("altitude") or 0.0

            if len(positions) >= 2 and altitude > 0:
                try:
                    from app.detection import CAMERA_HFOV_DEG
                    hfov = CAMERA_HFOV_DEG
                except Exception:
                    hfov = 69.4
                swath_m = 2.0 * altitude * math.tan(math.radians(hfov / 2.0))

                path_m = 0.0
                for i in range(1, len(positions)):
                    _, lat1, lon1 = positions[i - 1]
                    _, lat2, lon2 = positions[i]
                    dn = (lat2 - lat1) * 111_111.0
                    de = (lon2 - lon1) * 111_111.0 * math.cos(math.radians(lat1))
                    path_m += math.hypot(dn, de)

                covered_m2 = path_m * swath_m

                poly = self.mission.get("searchPolygon", [])
                if poly and len(poly) >= 3:
                    p_lats = [p[0] for p in poly]
                    p_lons = [p[1] for p in poly]
                    lat_m = (max(p_lats) - min(p_lats)) * 111_111.0
                    lon_m = (max(p_lons) - min(p_lons)) * 111_111.0 * math.cos(
                        math.radians(sum(p_lats) / len(p_lats))
                    )
                    poly_m2 = lat_m * lon_m
                    if poly_m2 > 0:
                        area_pct = min(100.0, (covered_m2 / poly_m2) * 100.0)

            # ── Survivors by priority ─────────────────────────────────────────
            # Counted over every track accumulated this mission (not one frame).
            # Analyst-rejected tracks are excluded from the survivor counts but
            # reported separately, so the two numbers always reconcile.
            survivors: Dict[str, int] = {"high": 0, "medium": 0, "low": 0}
            rejected_count = 0
            for det in self._detections_locked():
                if det.get("status") == "rejected":
                    rejected_count += 1
                    continue
                p = det.get("priority", "low")
                survivors[p] = survivors.get(p, 0) + 1

            # ── GNSS outage and VIO usage from event log ───────────────────────
            # Strategy: walk the event list in chronological order, tracking
            # open "degraded" intervals (closed by "reacquired") and
            # open "VIO" intervals (closed by next non-VIO position event).
            # Scope to this sortie. Without this a leftover log could report a
            # GNSS outage longer than the mission that supposedly contained it.
            start = self._mission_start_time
            events_snapshot = [
                e for e in self.events
                if start is None or e.get("timestamp", 0) >= start
            ]

        # (released lock — compute the rest outside)

        gnss_outage_s  = 0.0
        vio_usage_s    = 0.0
        gnss_start: Optional[float] = None
        vio_start:  Optional[float] = None

        for ev in sorted(events_snapshot, key=lambda e: e.get("timestamp", 0)):
            kind = ev.get("event_type", "generic")
            ts   = float(ev.get("timestamp", 0))

            # GNSS outage window — keyed on event_type, not message text.
            if kind == "gnss_lost":
                if gnss_start is None:
                    gnss_start = ts
                if vio_start is None:
                    vio_start = ts
            elif kind == "gnss_reacquired":
                if gnss_start is not None:
                    gnss_outage_s += ts - gnss_start
                    gnss_start = None
                if vio_start is not None:
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
            "rejected_count":      rejected_count,
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
                "detections":        self._detections_locked(),
                "events":            list(self.events),
                # Diagnostics exposed for frontend staleness / signal checks
                "telemetry_updated_at": self.telemetry_updated_at,
                "video_signal":         self.video_signal,
                "demo_mode":            self.demo_mode,
                "camera_enabled":       self.camera_enabled,
                "preflight_acks":       dict(self.preflight_acks),
                # Wall-clock mission start; the UI runs the golden-hour clock
                # from this so every screen agrees on the same countdown.
                "mission_start_time":   self._mission_start_time,
            }


# Global in-memory state instance
app_state = AppState()
