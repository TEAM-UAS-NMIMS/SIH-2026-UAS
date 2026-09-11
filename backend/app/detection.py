"""YOLO inference pipeline."""

import os
import cv2
import time
import threading
import math
from typing import Optional, Tuple
from ultralytics import YOLO
from app.state import app_state

# ─── Camera model ─────────────────────────────────────────────────────────────
# Horizontal field of view of the colour stream, in degrees.
#
# The previous hardcoded 60 deg matched no camera on this rig. Real values:
#   Intel RealSense D435 / D435i colour : 69.4 deg
#   Intel RealSense D455 colour         : 90.0 deg
#
# CAMERA_HFOV_DEG overrides it explicitly; otherwise we try to read the true
# intrinsics from the RealSense SDK at startup (exact, per-unit calibrated) and
# only fall back to the D435 nominal value if the SDK is unavailable.
DEFAULT_HFOV_DEG = 69.4


def _detect_camera_hfov() -> Tuple[float, str]:
    """Resolve the colour stream's horizontal FOV.

    Returns (hfov_degrees, source) where source describes the provenance so the
    UI and report can state how the geolocation was derived rather than
    implying a precision we do not have.
    """
    override = os.getenv("CAMERA_HFOV_DEG")
    if override:
        try:
            return float(override), "configured (CAMERA_HFOV_DEG)"
        except ValueError:
            print(f"Ignoring invalid CAMERA_HFOV_DEG={override!r}")

    try:
        import pyrealsense2 as rs
        ctx = rs.context()
        if len(ctx.query_devices()) > 0:
            pipeline = rs.pipeline()
            profile = pipeline.start(rs.config())
            try:
                stream = profile.get_stream(rs.stream.color).as_video_stream_profile()
                intr = stream.get_intrinsics()
                hfov = math.degrees(2 * math.atan(intr.width / (2.0 * intr.fx)))
                return hfov, "RealSense SDK intrinsics"
            finally:
                pipeline.stop()
    except Exception:
        pass

    return DEFAULT_HFOV_DEG, "D435 nominal (SDK unavailable)"


CAMERA_HFOV_DEG, CAMERA_HFOV_SOURCE = _detect_camera_hfov()

# The projection below assumes the camera looks straight down (nadir). If the
# payload is mounted forward-facing or on a pitching gimbal, CAMERA_PITCH_DEG
# must be supplied (negative = nose-down); a non-nadir mount without this set
# is reported as such rather than silently mis-projecting.
CAMERA_PITCH_DEG = float(os.getenv("CAMERA_PITCH_DEG", "-90"))
CAMERA_IS_NADIR = abs(CAMERA_PITCH_DEG + 90.0) < 1.0


def camera_model_summary() -> dict:
    """Describe the camera model, for /health and report provenance."""
    return {
        "hfov_deg": round(CAMERA_HFOV_DEG, 2),
        "hfov_source": CAMERA_HFOV_SOURCE,
        "pitch_deg": CAMERA_PITCH_DEG,
        "nadir": CAMERA_IS_NADIR,
        "note": (
            "Geolocation assumes a nadir (straight-down) camera."
            if CAMERA_IS_NADIR
            else f"Camera pitch {CAMERA_PITCH_DEG} deg is not nadir; "
                 "ground projection is approximate."
        ),
    }


def estimate_detection_location(
    bbox: list[float],
    frame_width: int,
    frame_height: int,
    drone_lat: float,
    drone_lon: float,
    drone_alt: float,
    drone_heading: float,
    hfov_deg: Optional[float] = None,
) -> Tuple[Optional[float], Optional[float]]:
    """Estimate the ground lat/lon of a bounding box.

    drone_alt MUST be height above ground (AGL). telemetry.py sources it from
    GLOBAL_POSITION_INT.relative_alt for exactly this reason — using the MSL
    `alt` field would scale every ground offset by the terrain elevation.

    Returns (None, None) when there is no usable position or altitude, rather
    than inventing a coordinate.
    """
    if hfov_deg is None:
        hfov_deg = CAMERA_HFOV_DEG

    if not drone_lat or not drone_lon or drone_alt is None or drone_alt <= 0:
        return None, None

    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0

    # Offset from center of image
    dx_pixels = cx - (frame_width / 2.0)
    dy_pixels = cy - (frame_height / 2.0)

    # Focal length in pixels. Square pixels, so fy == fx and the vertical FOV
    # follows from the frame aspect ratio rather than being assumed.
    fx = (frame_width / 2.0) / math.tan(math.radians(hfov_deg / 2.0))
    fy = fx

    # Angles to the target
    angle_x = math.atan(dx_pixels / fx)
    angle_y = math.atan(dy_pixels / fy)

    # Ground distance relative to camera
    dist_x = drone_alt * math.tan(angle_x)
    dist_y = drone_alt * math.tan(angle_y)

    # Convert to Forward and Right distances
    fwd_dist = -dist_y
    right_dist = dist_x

    heading_rad = math.radians(drone_heading)
    
    # North and East offsets
    dn = fwd_dist * math.cos(heading_rad) - right_dist * math.sin(heading_rad)
    de = fwd_dist * math.sin(heading_rad) + right_dist * math.cos(heading_rad)

    # Lat/Lon offsets
    lat_offset = dn / 111111.0
    lon_offset = de / (111111.0 * math.cos(math.radians(drone_lat)))

    return drone_lat + lat_offset, drone_lon + lon_offset



# Minimum YOLO confidence for a detection to enter the survivor list.
# Ultralytics defaults to 0.25, which let clear noise through as "low priority"
# survivors. Configurable so it can be tuned per deployment.
YOLO_CONF_THRESHOLD = float(os.getenv("YOLO_CONF_THRESHOLD", "0.45"))


class DetectionPipeline:
    """YOLO detection pipeline handler with background streaming."""

    def __init__(self):
        video_src_env = os.getenv("VIDEO_SOURCE", "0")
        try:
            self.video_source = int(video_src_env)
        except ValueError:
            self.video_source = video_src_env
            
        self.running = False
        self.thread = None

        # The camera does NOT open on startup. An operator decides when the
        # payload goes live, and a console that silently grabs the camera the
        # moment the backend boots is both surprising and a privacy problem.
        # GRIDZERO_CAMERA_AUTOSTART=1 restores the old behaviour.
        self.enabled = os.getenv("GRIDZERO_CAMERA_AUTOSTART", "0") == "1"
        self.model = YOLO("yolov8n.pt")  # Auto-downloads if not present
        self.latest_jpeg: Optional[bytes] = None
        self._lock = threading.Lock()
        # Video signal state — updated in the run loop.
        # Flips to False after NO_SIGNAL_THRESHOLD consecutive failed reads;
        # recovers immediately on the next successful read.
        self._signal_ok: bool = False
        self._NO_SIGNAL_THRESHOLD = 10  # consecutive cap.read() failures

    def start(self) -> None:
        """Start the background thread."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def enable(self) -> dict:
        """Open the camera and begin inference."""
        self.enabled = True
        app_state.set_camera_enabled(True)
        app_state.add_event(time.time(), "Camera started by operator", "info",
                            event_type="camera_started")
        return {"ok": True, "enabled": True, "source": str(self.video_source)}

    def disable(self) -> dict:
        """Release the camera and stop inference."""
        self.enabled = False
        self._signal_ok = False
        app_state.set_camera_enabled(False)
        app_state.set_video_signal(False)
        app_state.add_event(time.time(), "Camera stopped by operator", "info",
                            event_type="camera_stopped")
        return {"ok": True, "enabled": False}

    def status(self) -> dict:
        return {
            "enabled": self.enabled,
            "source": str(self.video_source),
            "signal": self._signal_ok,
        }

    def stop(self) -> None:
        """Stop the background thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)

    def get_latest_frame(self) -> Optional[bytes]:
        """Returns the latest annotated JPEG frame bytes safely."""
        with self._lock:
            return self.latest_jpeg

    def _run_loop(self) -> None:
        # Opened lazily once the operator enables the camera, not at boot.
        cap = None

        frame_count = 0
        consecutive_failures = 0

        while self.running:
            # Camera off: release the device and idle. Holding an unused
            # capture open keeps the webcam LED lit and blocks other apps.
            if not self.enabled:
                if cap is not None:
                    cap.release()
                    cap = None
                if self._signal_ok:
                    self._signal_ok = False
                    app_state.set_video_signal(False)
                with self._lock:
                    self.latest_jpeg = None
                time.sleep(0.2)
                continue

            if cap is None:
                cap = cv2.VideoCapture(self.video_source)
                consecutive_failures = 0

            # Demo mode: serve the simulator's synthetic camera instead of the
            # real capture. Detections in demo mode are injected by the
            # simulator at the tracker boundary, so YOLO is skipped here rather
            # than being run on synthetic imagery and claimed as a detection.
            from app.simulator import simulator
            if simulator.active:
                sim_frame = simulator.get_frame()
                if sim_frame is not None:
                    if not self._signal_ok:
                        self._signal_ok = True
                        app_state.set_video_signal(True)
                    ok_jpg, buf = cv2.imencode('.jpg', sim_frame)
                    if ok_jpg:
                        with self._lock:
                            self.latest_jpeg = buf.tobytes()
                time.sleep(0.05)
                continue

            ret, frame = cap.read()
            if not ret:
                consecutive_failures += 1

                # Declare "no signal" after threshold consecutive failures
                if consecutive_failures >= self._NO_SIGNAL_THRESHOLD and self._signal_ok:
                    self._signal_ok = False
                    app_state.set_video_signal(False)
                    app_state.add_event(
                        time.time(),
                        "Video source disconnected — no signal",
                        "warning",
                    )
                    print(f"Video source lost after {consecutive_failures} failures.")

                # Try re-opening the capture after prolonged failure
                if consecutive_failures % 30 == 0:   # every ~3 s at 10 Hz
                    if cap is not None:
                        cap.release()
                    cap = cv2.VideoCapture(self.video_source)

                time.sleep(0.1)
                continue
                
            # Frame read succeeded — clear failure counter and restore signal
            if consecutive_failures > 0:
                consecutive_failures = 0
            if not self._signal_ok:
                self._signal_ok = True
                app_state.set_video_signal(True)
                app_state.add_event(
                    time.time(),
                    "Video source reconnected — signal restored",
                    "info",
                )

            frame_count += 1
            
            # Process every 3rd frame to throttle inference load
            if frame_count % 3 == 0:
                # Run inference for person class (class 0 in COCO)
                results = self.model(
                    frame,
                    classes=[0],
                    conf=YOLO_CONF_THRESHOLD,
                    verbose=False,
                )
                
                detections = []
                frame_h, frame_w = frame.shape[:2]
                # Render annotated frame with bounding boxes
                annotated_frame = results[0].plot() if len(results) > 0 else frame.copy()

                if len(results) > 0:
                    telem = app_state.telemetry
                    drone_lat = telem.get("lat", 0.0)
                    drone_lon = telem.get("lon", 0.0)
                    drone_alt = telem.get("altitude", 0.0)
                    drone_heading = telem.get("heading", 0.0)
                    pos_source = telem.get("position_source", "NO_POSITION")
                    
                    if pos_source == "VIO_FALLBACK":
                        uncertainty = 8.0
                    elif pos_source == "GNSS":
                        uncertainty = 2.0
                    else:
                        uncertainty = None

                    for box in results[0].boxes:
                        conf = float(box.conf[0])
                        bbox = box.xyxy[0].tolist()
                        
                        est_lat, est_lon = estimate_detection_location(
                            bbox, frame_w, frame_h, 
                            drone_lat, drone_lon, drone_alt, drone_heading
                        )
                            
                        # No id and no timestamp here: identity belongs to the
                        # tracker, which assigns a stable track_id and keeps
                        # first_seen/last_seen across frames.
                        detections.append({
                            "label": "person",
                            "confidence": conf,
                            "bbox": bbox,
                            "lat": est_lat,
                            "lon": est_lon,
                            "position_source": pos_source,
                            "uncertainty_m": uncertainty,
                        })

                # Fold this frame's observations into the persistent tracker.
                # An empty list is still submitted so tracks can age out.
                app_state.update_detections(detections, frame_w, frame_h)
                
                # Encode the annotated frame as JPEG
                ret_jpg, buffer = cv2.imencode('.jpg', annotated_frame)
                if ret_jpg:
                    with self._lock:
                        self.latest_jpeg = buffer.tobytes()
            
            # Small yield
            time.sleep(0.01)

        if cap is not None:
            cap.release()


# Global detection pipeline instance
detection_pipeline = DetectionPipeline()
