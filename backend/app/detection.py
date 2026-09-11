"""YOLO inference pipeline."""

import os
import cv2
import time
import threading
import uuid
import math
from typing import Optional, Tuple
from ultralytics import YOLO
from app.state import app_state

def estimate_detection_location(
    bbox: list[float], 
    frame_width: int, 
    frame_height: int, 
    drone_lat: float, 
    drone_lon: float, 
    drone_alt: float, 
    drone_heading: float, 
    hfov_deg: float = 60.0
) -> Tuple[Optional[float], Optional[float]]:
    """
    Estimates lat/lon of a bounding box assuming camera is pointing straight down (-90 pitch).
    """
    if not drone_lat or not drone_lon or not drone_alt or drone_alt <= 0:
        return None, None

    x1, y1, x2, y2 = bbox
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0

    # Offset from center of image
    dx_pixels = cx - (frame_width / 2.0)
    dy_pixels = cy - (frame_height / 2.0)

    # Focal length in pixels
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
        cap = cv2.VideoCapture(self.video_source)
        if not cap.isOpened():
            print(f"Warning: Failed to open video source {self.video_source}")

        frame_count = 0
        consecutive_failures = 0

        while self.running:
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
                results = self.model(frame, classes=[0], verbose=False)
                
                detections = []
                # Render annotated frame with bounding boxes
                annotated_frame = results[0].plot() if len(results) > 0 else frame.copy()
                
                if len(results) > 0:
                    frame_h, frame_w = frame.shape[:2]
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
                        
                        if conf > 0.9:
                            priority = "high"
                        elif conf > 0.7:
                            priority = "medium"
                        else:
                            priority = "low"
                            
                        est_lat, est_lon = estimate_detection_location(
                            bbox, frame_w, frame_h, 
                            drone_lat, drone_lon, drone_alt, drone_heading
                        )
                            
                        detections.append({
                            "id": str(uuid.uuid4()),
                            "label": "person",
                            "confidence": conf,
                            "bbox": bbox,
                            "lat": est_lat,
                            "lon": est_lon,
                            "position_source": pos_source,
                            "uncertainty_m": uncertainty,
                            "priority": priority,
                            "timestamp": time.time()
                        })
                
                app_state.update_detections(detections)
                
                # Encode the annotated frame as JPEG
                ret_jpg, buffer = cv2.imencode('.jpg', annotated_frame)
                if ret_jpg:
                    with self._lock:
                        self.latest_jpeg = buffer.tobytes()
            
            # Small yield
            time.sleep(0.01)

        cap.release()


# Global detection pipeline instance
detection_pipeline = DetectionPipeline()
