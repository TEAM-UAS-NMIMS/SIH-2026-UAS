"""Detection tracking — stable identity for detections across inference frames.

Why this exists
---------------
The detection pipeline previously handed `AppState` a brand-new list on every
inference frame, with a fresh `uuid4()` per detection. That made every
downstream consumer wrong: detections never accumulated, analyst reviews were
erased ~100 ms after being written, the mission report described a single video
frame, and the ranking formula's age term was always ~0 because timestamps reset
every frame.

This module assigns each detection a **stable track_id** that survives across
frames, so a person seen for 30 seconds is one track with a first_seen and a
last_seen — not 300 unrelated rows.

Matching strategy
-----------------
Greedy nearest-centroid association, normalised to the frame diagonal so the
threshold is resolution-independent:

  1. Each new observation is matched to the closest unmatched live track whose
     centroid is within MATCH_RADIUS (fraction of the frame diagonal).
  2. Tracks not seen for longer than TRACK_TIMEOUT_S stop being match
     candidates, so a new person entering where an old one left does not
     inherit their identity.
  3. Unmatched observations open a new track.

This is deliberately lightweight — no ByteTrack/DeepSORT dependency. For a
nadir search camera where targets move slowly relative to frame size, centroid
association is sufficient. Swapping in IoU or a Kalman predictor later means
replacing `_match()` alone.

Each track retains its **highest-confidence** observation (that is the best
evidence of what/where the target is) while `last_seen` keeps advancing, so
age scoring stays meaningful.
"""

import math
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple


# Association threshold as a fraction of the frame diagonal. At 640x480
# (diagonal 800 px) this is ~96 px of allowed movement between processed
# frames — generous, since we only infer on every 3rd frame.
MATCH_RADIUS = 0.12

# A track stops being a match candidate after this long without a sighting.
TRACK_TIMEOUT_S = 3.0

# A track is reported "active" (currently on screen) within this window.
ACTIVE_WINDOW_S = 2.0

# Ground distance within which a new sighting is treated as the SAME casualty
# as an existing track, even if the camera lost them in between.
#
# Without this, a survivor re-entering the frame on the next survey lane opens a
# brand-new track, and the mission report double-counts them. Geolocation
# uncertainty is a few metres on GNSS and ~8 m on VIO, so 20 m is tight enough
# not to merge genuinely separate people standing apart.
GEO_REASSOCIATE_M = 20.0


def _centroid(bbox: List[float]) -> Tuple[float, float]:
    """Centre point of an [x1, y1, x2, y2] box."""
    x1, y1, x2, y2 = bbox
    return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)


def _ground_distance_m(lat1, lon1, lat2, lon2) -> Optional[float]:
    """Approximate ground separation in metres between two fixes."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    dn = (lat2 - lat1) * 111_111.0
    de = (lon2 - lon1) * 111_111.0 * math.cos(math.radians(lat1))
    return math.hypot(dn, de)


def _priority_for(confidence: float) -> str:
    """Map a confidence score to the operator-facing priority band."""
    if confidence > 0.9:
        return "high"
    if confidence > 0.7:
        return "medium"
    return "low"


class Track:
    """One tracked target, accumulated across many inference frames."""

    __slots__ = (
        "track_id", "label", "first_seen", "last_seen", "sightings",
        "confidence", "bbox", "lat", "lon", "position_source",
        "uncertainty_m", "centroid",
    )

    def __init__(self, observation: Dict[str, Any], now: float):
        self.track_id: str = str(uuid.uuid4())
        self.label: str = observation.get("label", "person")
        self.first_seen: float = now
        self.last_seen: float = now
        self.sightings: int = 1

        # Best-evidence observation (highest confidence seen so far).
        self.confidence: float = float(observation.get("confidence", 0.0))
        self.bbox: List[float] = list(observation.get("bbox", []))
        self.lat: Optional[float] = observation.get("lat")
        self.lon: Optional[float] = observation.get("lon")
        self.position_source: str = observation.get("position_source", "NO_POSITION")
        self.uncertainty_m: Optional[float] = observation.get("uncertainty_m")

        # Most recent centroid — used for association, not for reporting.
        self.centroid: Tuple[float, float] = _centroid(self.bbox) if self.bbox else (0.0, 0.0)

    def absorb(self, observation: Dict[str, Any], now: float) -> None:
        """Fold a new observation of this same target into the track."""
        self.last_seen = now
        self.sightings += 1

        bbox = observation.get("bbox") or []
        if bbox:
            self.centroid = _centroid(bbox)

        # Keep the highest-confidence evidence, including its position fix.
        conf = float(observation.get("confidence", 0.0))
        if conf > self.confidence:
            self.confidence = conf
            self.bbox = list(bbox)
            self.lat = observation.get("lat")
            self.lon = observation.get("lon")
            self.position_source = observation.get("position_source", "NO_POSITION")
            self.uncertainty_m = observation.get("uncertainty_m")
        elif self.lat is None and observation.get("lat") is not None:
            # We had no position fix for this track yet; take the first one that
            # becomes available even if its confidence is lower.
            self.lat = observation.get("lat")
            self.lon = observation.get("lon")
            self.position_source = observation.get("position_source", "NO_POSITION")
            self.uncertainty_m = observation.get("uncertainty_m")

    def to_dict(self, now: float) -> Dict[str, Any]:
        """Serialise for the API / WebSocket broadcast.

        `timestamp` is deliberately first_seen: the ranking formula's age term
        means "how long has this person been waiting", which is measured from
        when we first saw them, not from the most recent frame.
        """
        return {
            "id":               self.track_id,
            "label":            self.label,
            "confidence":       self.confidence,
            "bbox":             list(self.bbox),
            "lat":              self.lat,
            "lon":              self.lon,
            "position_source":  self.position_source,
            "uncertainty_m":    self.uncertainty_m,
            "priority":         _priority_for(self.confidence),
            "timestamp":        self.first_seen,
            "first_seen":       self.first_seen,
            "last_seen":        self.last_seen,
            "sightings":        self.sightings,
            "active":           (now - self.last_seen) <= ACTIVE_WINDOW_S,
        }


class DetectionTracker:
    """Accumulates observations into stable tracks for the whole mission.

    Not internally synchronised — callers hold AppState's lock.
    """

    def __init__(self) -> None:
        self._tracks: Dict[str, Track] = {}

    def reset(self) -> None:
        self._tracks.clear()

    def _match(
        self,
        observation: Dict[str, Any],
        candidates: List[Track],
        frame_diag: float,
    ) -> Optional[Track]:
        """Closest live track within MATCH_RADIUS, or None to open a new track."""
        bbox = observation.get("bbox") or []
        if not bbox or frame_diag <= 0:
            return None

        cx, cy = _centroid(bbox)
        limit = MATCH_RADIUS * frame_diag

        best: Optional[Track] = None
        best_dist = limit
        for track in candidates:
            tx, ty = track.centroid
            dist = math.hypot(cx - tx, cy - ty)
            if dist < best_dist:
                best_dist = dist
                best = track
        return best

    def update(
        self,
        observations: List[Dict[str, Any]],
        frame_w: int,
        frame_h: int,
        now: Optional[float] = None,
    ) -> List[str]:
        """Associate this frame's observations with existing tracks.

        Returns the track_ids touched by this frame.
        """
        now = time.time() if now is None else now
        frame_diag = math.hypot(frame_w, frame_h)

        # Only recently-seen tracks are association candidates.
        live = [t for t in self._tracks.values() if (now - t.last_seen) <= TRACK_TIMEOUT_S]

        touched: List[str] = []
        claimed: set = set()

        for obs in observations:
            available = [t for t in live if t.track_id not in claimed]
            match = self._match(obs, available, frame_diag)

            # Not matched in image space — try ground position against EVERY
            # track, however long ago it was seen. A survivor found again on a
            # later survey lane is the same casualty, not a new one.
            if match is None:
                match = self._match_by_ground(obs, claimed)

            if match is not None:
                match.absorb(obs, now)
                claimed.add(match.track_id)
                touched.append(match.track_id)
            else:
                track = Track(obs, now)
                self._tracks[track.track_id] = track
                claimed.add(track.track_id)
                touched.append(track.track_id)

        return touched

    def _match_by_ground(
        self,
        observation: Dict[str, Any],
        claimed: set,
    ) -> Optional["Track"]:
        """Re-associate a sighting with a known casualty by ground position."""
        lat, lon = observation.get("lat"), observation.get("lon")
        if lat is None or lon is None:
            return None

        best: Optional[Track] = None
        best_dist = GEO_REASSOCIATE_M
        for track in self._tracks.values():
            if track.track_id in claimed or track.lat is None:
                continue
            dist = _ground_distance_m(lat, lon, track.lat, track.lon)
            if dist is not None and dist < best_dist:
                best_dist = dist
                best = track
        return best

    def all_tracks(self, now: Optional[float] = None) -> List[Dict[str, Any]]:
        """Every track seen this mission, newest sighting first."""
        now = time.time() if now is None else now
        out = [t.to_dict(now) for t in self._tracks.values()]
        out.sort(key=lambda d: d["last_seen"], reverse=True)
        return out

    def count(self) -> int:
        return len(self._tracks)
