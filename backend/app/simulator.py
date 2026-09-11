"""Demo mode — a simulated mission that exercises the real pipeline.

Why this exists
---------------
gridZERO could not be shown end-to-end without a flight controller and a
camera: with no MAVLink the pre-flight checklist hard-fails, launch is blocked,
and every screen downstream stays empty. That made the product impossible to
demonstrate.

Demo mode flies a synthetic aircraft over the configured search area and feeds
its telemetry and detections through **the same code paths as a real mission** —
`app_state.update_telemetry()`, the `DetectionTracker`, `compute_mission_stats()`,
the ranking engine. Nothing downstream of this module knows or cares that the
data is simulated, which is the point: the demo proves the real system works.

Honesty rules (non-negotiable)
------------------------------
  * Every simulated value is physically plausible, never a flattering fiction.
  * `app_state.demo_mode` is broadcast on every WebSocket frame so the UI can
    show an unmissable banner. It is never enabled by default.
  * Simulated command acknowledgements are labelled as simulated and can never
    be mistaken for a real autopilot ack.
  * The synthetic camera frames are visibly marked SIMULATED, and YOLO is not
    claimed to have run on them — the detections are injected as observations
    at the tracker boundary, exactly where real YOLO observations enter.
"""

import math
import random
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

from app.state import app_state


# ── Mission profile ──────────────────────────────────────────────────────────

CRUISE_SPEED_MS      = 8.0     # m/s ground speed on a survey leg
SURVEY_ALTITUDE_M    = 45.0    # AGL
BATTERY_START_PCT    = 98.0
BATTERY_DRAIN_PCT_S  = 0.045   # ~37 min endurance, realistic for this airframe
TICK_HZ              = 5.0     # telemetry update rate

# Scripted events, in seconds from mission start.
GNSS_LOSS_AT_S       = 42.0
GNSS_REACQUIRE_AT_S  = 63.0

FRAME_W, FRAME_H     = 960, 540


def _lawnmower(polygon: List[List[float]], lane_count: int = 6) -> List[Tuple[float, float]]:
    """Generate a boustrophedon (lawnmower) survey path over a polygon's bbox.

    This is the same pattern the mission planner describes, so the simulated
    aircraft flies what the operator actually planned.
    """
    if not polygon or len(polygon) < 3:
        return []

    lats = [p[0] for p in polygon]
    lons = [p[1] for p in polygon]
    lat_min, lat_max = min(lats), max(lats)
    lon_min, lon_max = min(lons), max(lons)

    path: List[Tuple[float, float]] = []
    for i in range(lane_count):
        f = i / max(1, lane_count - 1)
        lat = lat_min + (lat_max - lat_min) * f
        if i % 2 == 0:
            path.append((lat, lon_min))
            path.append((lat, lon_max))
        else:
            path.append((lat, lon_max))
            path.append((lat, lon_min))
    return path


def _haversine_m(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp = math.radians(b[0] - a[0])
    dl = math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def _bearing_deg(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


class SimulatedSurvivor:
    """A person on the ground the simulated camera will find."""

    def __init__(self, lat: float, lon: float, confidence: float, label: str = "person"):
        self.lat = lat
        self.lon = lon
        self.confidence = confidence
        self.label = label
        self.seen_count = 0


class MissionSimulator:
    """Drives a synthetic mission through the real application state."""

    def __init__(self) -> None:
        self._thread: Optional[threading.Thread] = None
        self._running = False
        self._lock = threading.Lock()

        self._frame: Optional[np.ndarray] = None
        self._started_at = 0.0
        self._path: List[Tuple[float, float]] = []
        self._survivors: List[SimulatedSurvivor] = []
        self._mode = "AUTO"
        self._commanded: Optional[str] = None

    # ── Lifecycle ────────────────────────────────────────────────────────

    @property
    def active(self) -> bool:
        return self._running

    def start(self) -> Dict[str, Any]:
        if self._running:
            return {"ok": True, "already_running": True}

        with app_state._lock:
            polygon = list(app_state.mission.get("searchPolygon", []))

        self._path = _lawnmower(polygon)
        if not self._path:
            return {"ok": False, "detail": "Mission has no search polygon to survey"}

        self._survivors = self._place_survivors(polygon)
        self._started_at = time.time()
        self._mode = "AUTO"
        self._commanded = None
        self._running = True

        app_state.set_demo_mode(True)
        app_state.mark_mission_start()
        app_state.add_event(
            time.time(),
            "DEMO MODE — simulated mission started. All telemetry and detections are synthetic.",
            "warning",
            event_type="demo_started",
        )

        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        return {"ok": True, "survivors": len(self._survivors), "legs": len(self._path)}

    def stop(self) -> Dict[str, Any]:
        if not self._running:
            return {"ok": True, "already_stopped": True}
        self._running = False
        if self._thread:
            self._thread.join(timeout=3.0)
        app_state.set_demo_mode(False)
        app_state.add_event(
            time.time(),
            "DEMO MODE ended — simulated data stopped.",
            "info",
            event_type="demo_stopped",
        )
        return {"ok": True}

    def status(self) -> Dict[str, Any]:
        return {
            "active": self._running,
            "elapsed_s": round(time.time() - self._started_at, 1) if self._running else 0.0,
            "survivors_planted": len(self._survivors),
            "mode": self._mode,
        }

    # ── Simulated commands ───────────────────────────────────────────────

    def send_command(self, command: str) -> Dict[str, Any]:
        """Accept a flight command against the simulated aircraft.

        Clearly marked as simulated so it can never be read as a real ack.
        """
        labels = {"rtl": "Return to launch", "land": "Land", "hold": "Position hold"}
        label = labels.get(command, command)

        self._commanded = command
        self._mode = {"rtl": "RTL", "land": "LAND", "hold": "LOITER"}.get(command, self._mode)

        app_state.add_event(
            time.time(),
            f"[SIMULATED] {label} accepted by simulated aircraft",
            "info",
            event_type="demo_command",
        )
        return {
            "ok": True,
            "code": "ACCEPTED_SIMULATED",
            "simulated": True,
            "detail": f"{label}: ACCEPTED (simulated aircraft — no real command was sent)",
            "command": command,
            "label": label,
        }

    # ── Synthetic camera ─────────────────────────────────────────────────

    def get_frame(self) -> Optional[np.ndarray]:
        with self._lock:
            return None if self._frame is None else self._frame.copy()

    # ── Internals ────────────────────────────────────────────────────────

    def _path_point_at(self, fraction: float) -> Tuple[float, float]:
        """Interpolate a position at `fraction` along the whole survey path."""
        if len(self._path) < 2:
            return self._path[0] if self._path else (0.0, 0.0)

        legs = [
            _haversine_m(self._path[i], self._path[i + 1])
            for i in range(len(self._path) - 1)
        ]
        total = sum(legs)
        target = max(0.0, min(1.0, fraction)) * total

        run = 0.0
        for i, leg_len in enumerate(legs):
            if run + leg_len >= target:
                f = 0.0 if leg_len <= 0 else (target - run) / leg_len
                a, b = self._path[i], self._path[i + 1]
                return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
            run += leg_len
        return self._path[-1]

    def _place_survivors(self, polygon: List[List[float]]) -> List[SimulatedSurvivor]:
        """Place casualties ON the survey path so the demo actually finds them.

        Scattering them randomly across the search area is realistic but useless
        for a demonstration: the camera footprint at survey altitude is roughly
        60 m across while the search box is several hundred metres, so the
        aircraft would fly for many minutes without seeing anyone.

        Instead each survivor sits a few metres to one side of a known point
        along the planned path, so they enter the footprint at a predictable
        time. Confidences descend so the demo shows one strong find and a
        realistic tail of weaker contacts.
        """
        rng = random.Random(7)   # fixed seed: the demo tells the same story twice

        # (fraction along path, confidence, lateral offset in metres)
        # Fractions kept early in the path so the demo finds people within the
        # first couple of minutes. A full lawnmower of this box is ~12 minutes
        # of flight; nobody watching a demo waits that long for the first find.
        plan = [
            (0.02, 0.94,  6.0),
            (0.05, 0.88, -9.0),
            (0.09, 0.79,  4.0),
            (0.14, 0.72, -7.0),
            (0.20, 0.61,  8.0),
        ]

        out: List[SimulatedSurvivor] = []
        for frac, conf, lateral in plan:
            lat, lon = self._path_point_at(frac)
            # Offset perpendicular to travel, but well inside the footprint.
            nxt = self._path_point_at(min(1.0, frac + 0.01))
            brg = math.radians(_bearing_deg((lat, lon), nxt))
            dn = -math.sin(brg) * lateral
            de = math.cos(brg) * lateral
            out.append(SimulatedSurvivor(
                lat + dn / 111_111.0,
                lon + de / (111_111.0 * math.cos(math.radians(lat))),
                conf,
            ))
        return out

    def _loop(self) -> None:
        dt = 1.0 / TICK_HZ
        leg = 0
        leg_progress_m = 0.0
        gnss_lost = False
        battery = BATTERY_START_PCT

        while self._running:
            now = time.time()
            elapsed = now - self._started_at

            # ── Advance along the survey path ────────────────────────────
            if self._commanded == "land":
                pos = self._current_pos(leg, leg_progress_m)
                alt = max(0.0, SURVEY_ALTITUDE_M - (elapsed % 1000) * 0.0)  # held below
            elif self._commanded == "hold":
                pos = self._current_pos(leg, leg_progress_m)
            else:
                if leg < len(self._path) - 1:
                    leg_len = _haversine_m(self._path[leg], self._path[leg + 1])
                    leg_progress_m += CRUISE_SPEED_MS * dt
                    if leg_progress_m >= leg_len:
                        leg_progress_m = 0.0
                        leg += 1
                pos = self._current_pos(leg, leg_progress_m)

            heading = (
                _bearing_deg(self._path[leg], self._path[min(leg + 1, len(self._path) - 1)])
                if leg < len(self._path) - 1 else 0.0
            )

            # ── Battery drain ────────────────────────────────────────────
            battery = max(0.0, battery - BATTERY_DRAIN_PCT_S * dt)

            # ── Scripted GNSS degradation, so the VIO fallback is demonstrable ──
            if not gnss_lost and GNSS_LOSS_AT_S <= elapsed < GNSS_REACQUIRE_AT_S:
                gnss_lost = True
                app_state.add_event(
                    now, "GNSS signal lost — VIO fallback engaged", "warning",
                    event_type="gnss_lost",
                )
            elif gnss_lost and elapsed >= GNSS_REACQUIRE_AT_S:
                gnss_lost = False
                app_state.add_event(
                    now, "GNSS signal reacquired", "info",
                    event_type="gnss_reacquired",
                )

            # ── Attitude: gentle survey-flight motion ────────────────────
            roll  = 6.0 * math.sin(elapsed * 0.6)
            pitch = -3.0 + 1.5 * math.sin(elapsed * 0.35)

            mode = self._mode if self._commanded else "AUTO"

            app_state.update_telemetry({
                "lat": pos[0],
                "lon": pos[1],
                "altitude": SURVEY_ALTITUDE_M,
                "altitude_msl": SURVEY_ALTITUDE_M + 142.0,   # Shirpur ~142 m AMSL
                "heading": heading,
                "speed": 0.0 if self._commanded in ("hold", "land") else CRUISE_SPEED_MS,
                "battery_pct": round(battery, 1),
                "battery_voltage": round(22.2 + (battery / 100.0) * 3.0, 2),
                "roll": round(roll, 2),
                "pitch": round(pitch, 2),
                "yaw": round(heading, 2),
                "mode": mode,
                "armed": True,
                "gps_fix_type": 1 if gnss_lost else 4,
                "satellites_visible": 5 if gnss_lost else 17,
                "hdop": 3.4 if gnss_lost else 0.68,
                "position_source": "VIO_FALLBACK" if gnss_lost else "GNSS",
                "timestamp": now,
            })

            # ── Detections: feed the REAL tracker at the same boundary that
            #    real YOLO observations enter. ──────────────────────────────
            observations = self._observe(pos, heading, gnss_lost)
            app_state.update_detections(observations, FRAME_W, FRAME_H)

            # ── Synthetic camera frame ───────────────────────────────────
            frame = self._render_frame(pos, heading, elapsed, observations, battery, gnss_lost)
            with self._lock:
                self._frame = frame

            time.sleep(dt)

    def _current_pos(self, leg: int, progress_m: float) -> Tuple[float, float]:
        if leg >= len(self._path) - 1:
            return self._path[-1]
        a, b = self._path[leg], self._path[leg + 1]
        total = _haversine_m(a, b)
        f = 0.0 if total <= 0 else min(1.0, progress_m / total)
        return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)

    def _observe(self, pos, heading, gnss_lost) -> List[Dict[str, Any]]:
        """Which survivors are inside the camera footprint right now.

        The footprint is derived from the real camera model, so the geometry
        matches what the live system would see at this altitude.
        """
        from app.detection import CAMERA_HFOV_DEG

        half_w = SURVEY_ALTITUDE_M * math.tan(math.radians(CAMERA_HFOV_DEG / 2.0))
        half_h = half_w * (FRAME_H / FRAME_W)

        out: List[Dict[str, Any]] = []
        for s in self._survivors:
            dn = (s.lat - pos[0]) * 111_111.0
            de = (s.lon - pos[1]) * 111_111.0 * math.cos(math.radians(pos[0]))

            hr = math.radians(heading)
            fwd   =  dn * math.cos(hr) + de * math.sin(hr)
            right = -dn * math.sin(hr) + de * math.cos(hr)

            if abs(right) > half_w or abs(fwd) > half_h:
                continue

            px = FRAME_W / 2.0 + (right / half_w) * (FRAME_W / 2.0)
            py = FRAME_H / 2.0 - (fwd / half_h) * (FRAME_H / 2.0)
            box = 46.0

            s.seen_count += 1
            jitter = random.uniform(-0.03, 0.03)
            out.append({
                "label": s.label,
                "confidence": max(0.30, min(0.99, s.confidence + jitter)),
                "bbox": [px - box / 2, py - box, px + box / 2, py + box],
                "lat": s.lat,
                "lon": s.lon,
                "position_source": "VIO_FALLBACK" if gnss_lost else "GNSS",
                "uncertainty_m": 8.0 if gnss_lost else 2.0,
            })
        return out

    def _render_frame(self, pos, heading, elapsed, observations, battery, gnss_lost):
        """Render a synthetic downward camera view, clearly marked SIMULATED."""
        img = np.full((FRAME_H, FRAME_W, 3), 58, dtype=np.uint8)

        # Drifting ground texture so the view reads as moving terrain.
        step = 64
        off = int((elapsed * CRUISE_SPEED_MS * 3) % step)
        for x in range(-step, FRAME_W + step, step):
            cv2.line(img, (x + off, 0), (x + off, FRAME_H), (70, 70, 70), 1)
        for y in range(-step, FRAME_H + step, step):
            cv2.line(img, (0, y + off), (FRAME_W, y + off), (70, 70, 70), 1)

        rng = random.Random(int(elapsed * 2) // 7)
        for _ in range(18):
            cx = rng.randint(0, FRAME_W); cy = rng.randint(0, FRAME_H)
            cv2.circle(img, (cx, cy), rng.randint(8, 26), (48, 56, 48), -1)

        # Detection boxes, drawn the way the annotated YOLO stream draws them.
        for obs in observations:
            x1, y1, x2, y2 = [int(v) for v in obs["bbox"]]
            cv2.rectangle(img, (x1, y1), (x2, y2), (255, 255, 255), 2)
            cv2.putText(img, f"person {obs['confidence']:.2f}", (x1, max(14, y1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)

        # Reticle
        cv2.line(img, (FRAME_W // 2 - 16, FRAME_H // 2), (FRAME_W // 2 + 16, FRAME_H // 2), (200, 200, 200), 1)
        cv2.line(img, (FRAME_W // 2, FRAME_H // 2 - 16), (FRAME_W // 2, FRAME_H // 2 + 16), (200, 200, 200), 1)

        # Unmissable provenance banner.
        cv2.rectangle(img, (0, 0), (FRAME_W, 30), (0, 0, 0), -1)
        cv2.putText(img, "SIMULATED CAMERA - DEMO MODE - NOT A REAL FEED", (12, 21),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.58, (90, 190, 255), 2, cv2.LINE_AA)

        hud = (f"ALT {SURVEY_ALTITUDE_M:.0f}m AGL   HDG {heading:03.0f}   "
               f"BAT {battery:.0f}%   {'VIO' if gnss_lost else 'GNSS'}   "
               f"{pos[0]:.5f},{pos[1]:.5f}")
        cv2.rectangle(img, (0, FRAME_H - 26), (FRAME_W, FRAME_H), (0, 0, 0), -1)
        cv2.putText(img, hud, (12, FRAME_H - 8),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.47, (220, 220, 220), 1, cv2.LINE_AA)
        return img


simulator = MissionSimulator()
