"""Post-mission detection ranking and report generation.

All scoring uses a simple, documented linear formula — no LLM, no invented
facts.  Every justification string is assembled from the actual values of the
detection being described.

Ranking formula
---------------
score = 0.50 * conf_score
      + 0.30 * proximity_score
      + 0.20 * age_score

conf_score      = detection.confidence  (already 0-1)
proximity_score = 1 - clamp(hazard_dist_m / PROXIMITY_MAX_M, 0, 1)
                  (closer to hazard zone → higher score)
                  If no hazard zone is defined → 0.0 (neutral)
age_score       = clamp(age_seconds / AGE_MAX_S, 0, 1)
                  (older detection → higher urgency; they have waited longer)

Tier thresholds (score → tier):
  score ≥ 0.75  →  URGENT
  score ≥ 0.55  →  HIGH
  score ≥ 0.35  →  MEDIUM
  else          →  LOW

Top-3 actions are generated from the top-3 URGENT/HIGH detections that have
not been marked "rejected".
"""

import math
import time
from typing import Any, Dict, List, Optional, Tuple


# ─── Tuning constants ─────────────────────────────────────────────────────────

PROXIMITY_MAX_M = 300.0   # Distances beyond this get proximity_score = 0
AGE_MAX_S       = 600.0   # Ages beyond this get age_score = 1

TIER_THRESHOLDS = [
    (0.75, "URGENT"),
    (0.55, "HIGH"),
    (0.35, "MEDIUM"),
    (0.00, "LOW"),
]

WEIGHTS = {"conf": 0.50, "proximity": 0.30, "age": 0.20}


# ─── Geometry helpers ─────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine great-circle distance in metres between two WGS-84 points."""
    R = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi        = math.radians(lat2 - lat1)
    dlambda     = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _nearest_hazard_dist_m(
    det_lat: float,
    det_lon: float,
    hazard_zone: List[List[float]],
) -> Optional[float]:
    """Return the distance (metres) to the nearest vertex of the hazard polygon.

    Returns None if hazard_zone is empty or detection has no valid coordinates.
    """
    if not hazard_zone or det_lat is None or det_lon is None:
        return None
    dists = [_haversine_m(det_lat, det_lon, v[0], v[1]) for v in hazard_zone]
    return min(dists)


# ─── Scoring ──────────────────────────────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _score_detection(
    det: Dict[str, Any],
    hazard_zone: List[List[float]],
    now: float,
) -> Tuple[float, float, float, float, Optional[float]]:
    """Return (total_score, conf_s, proximity_s, age_s, hazard_dist_m)."""
    conf = float(det.get("confidence", 0.0))
    conf_score = _clamp(conf, 0.0, 1.0)

    det_lat = det.get("lat")
    det_lon = det.get("lon")
    hazard_dist_m = _nearest_hazard_dist_m(det_lat, det_lon, hazard_zone)
    if hazard_dist_m is not None:
        proximity_score = 1.0 - _clamp(hazard_dist_m / PROXIMITY_MAX_M, 0.0, 1.0)
    else:
        proximity_score = 0.0  # neutral — no hazard zone defined

    ts = float(det.get("timestamp", now))
    age_s = max(0.0, now - ts)
    age_score = _clamp(age_s / AGE_MAX_S, 0.0, 1.0)

    total = (
        WEIGHTS["conf"]      * conf_score
        + WEIGHTS["proximity"] * proximity_score
        + WEIGHTS["age"]       * age_score
    )
    return total, conf_score, proximity_score, age_score, hazard_dist_m


def _tier(score: float) -> str:
    for threshold, label in TIER_THRESHOLDS:
        if score >= threshold:
            return label
    return "LOW"


# ─── Justification templates ──────────────────────────────────────────────────

def _justification(
    det: Dict[str, Any],
    tier: str,
    score: float,
    hazard_dist_m: Optional[float],
    age_s: float,
) -> str:
    """Build a justification string from the detection's actual values.

    Nothing is invented: every clause is gated on whether the underlying
    value is actually available.
    """
    conf_pct  = det.get("confidence", 0.0) * 100
    label     = det.get("label", "person")
    pos_src   = det.get("position_source", "UNKNOWN").replace("_", " ")
    unc       = det.get("uncertainty_m")
    status    = det.get("status", "pending")

    parts: List[str] = []

    # Confidence clause
    parts.append(f"{conf_pct:.1f}% confidence {label} detection")

    # Hazard proximity clause
    if hazard_dist_m is not None:
        parts.append(f"{hazard_dist_m:.0f} m from nearest hazard zone vertex")

    # Age clause
    if age_s >= 60:
        parts.append(f"detected {age_s / 60:.1f} min ago")
    else:
        parts.append(f"detected {age_s:.0f} s ago")

    # Position quality clause
    unc_str = f" (±{unc:.0f} m uncertainty)" if unc is not None else ""
    parts.append(f"position via {pos_src}{unc_str}")

    # Review status note
    if status == "confirmed":
        parts.append("analyst confirmed")
    elif status == "rejected":
        parts.append("analyst rejected")

    return ". ".join(parts) + "."


# ─── Action templates ─────────────────────────────────────────────────────────

_ACTION_TEMPLATES = {
    "URGENT": (
        "URGENT: Dispatch rescue team immediately to "
        "{lat_str}, {lon_str} — {justification_short}"
    ),
    "HIGH": (
        "HIGH: Prioritise retrieval at "
        "{lat_str}, {lon_str} — {justification_short}"
    ),
    "MEDIUM": (
        "MEDIUM: Schedule recovery at "
        "{lat_str}, {lon_str} — {justification_short}"
    ),
    "LOW": (
        "LOW: Log and review detection at "
        "{lat_str}, {lon_str} — {justification_short}"
    ),
}


def _action_for(ranked_det: Dict[str, Any]) -> str:
    tier = ranked_det["tier"]
    lat  = ranked_det.get("lat")
    lon  = ranked_det.get("lon")
    lat_str = f"{lat:.5f}" if lat is not None else "unknown lat"
    lon_str = f"{lon:.5f}" if lon is not None else "unknown lon"
    conf_pct = ranked_det["confidence"] * 100
    short = f"{conf_pct:.1f}% confidence"
    if ranked_det["hazard_distance_m"] is not None:
        short += f", {ranked_det['hazard_distance_m']:.0f} m from hazard zone"
    tmpl = _ACTION_TEMPLATES.get(tier, _ACTION_TEMPLATES["LOW"])
    return tmpl.format(lat_str=lat_str, lon_str=lon_str, justification_short=short)


# ─── Public API ───────────────────────────────────────────────────────────────

def generate_report(
    detections: List[Dict[str, Any]],
    hazard_zone: List[List[float]],
    mission_stats: Dict[str, Any],
    mission_meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Rank all detections and build the full report payload.

    Parameters
    ----------
    detections   : current detections list from AppState
    hazard_zone  : mission hazard zone polygon [[lat,lon], ...]
    mission_stats: output of AppState.compute_mission_stats()
    mission_meta : AppState.mission dict (name, operator, area, etc.)

    Returns
    -------
    {
        generated_at        : ISO timestamp string
        mission             : {name, operator, area, type}
        mission_stats       : forwarded from compute_mission_stats()
        summary_counts      : {URGENT, HIGH, MEDIUM, LOW}
        ranked_detections   : sorted list, best-first
        top_actions         : top-3 non-rejected detections as action strings
    }
    """
    now = time.time()

    ranked: List[Dict[str, Any]] = []

    for det in detections:
        total, conf_s, prox_s, age_s_norm, hazard_dist_m = _score_detection(
            det, hazard_zone, now
        )
        ts     = float(det.get("timestamp", now))
        age_s  = max(0.0, now - ts)
        tier   = _tier(total)
        just   = _justification(det, tier, total, hazard_dist_m, age_s)

        ranked.append({
            "id":                 det.get("id"),
            "label":              det.get("label", "person"),
            "tier":               tier,
            "score":              round(total, 4),
            "confidence":         round(float(det.get("confidence", 0.0)), 4),
            "priority":           det.get("priority", "low"),
            "status":             det.get("status", "pending"),
            "lat":                det.get("lat"),
            "lon":                det.get("lon"),
            "position_source":    det.get("position_source", "UNKNOWN"),
            "uncertainty_m":      det.get("uncertainty_m"),
            "timestamp":          ts,
            "age_seconds":        round(age_s, 1),
            "hazard_distance_m":  round(hazard_dist_m, 1) if hazard_dist_m is not None else None,
            "justification":      just,
            # Component scores for transparency
            "score_components": {
                "confidence_score":  round(conf_s,    4),
                "proximity_score":   round(prox_s,    4),
                "age_score":         round(age_s_norm, 4),
                "weights":           WEIGHTS,
            },
        })

    # Sort: highest score first; within equal tier sort by confidence desc
    ranked.sort(key=lambda r: (-r["score"], -r["confidence"]))

    # Number the ranks after sorting
    for i, r in enumerate(ranked):
        r["rank"] = i + 1

    # Summary counts
    summary_counts: Dict[str, int] = {"URGENT": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    for r in ranked:
        summary_counts[r["tier"]] = summary_counts.get(r["tier"], 0) + 1

    # Top-3 actions: take the 3 highest-scoring non-rejected detections
    actionable = [r for r in ranked if r.get("status") != "rejected"][:3]
    top_actions = []
    for i, r in enumerate(actionable):
        top_actions.append({
            "rank":         i + 1,
            "tier":         r["tier"],
            "detection_id": r["id"],
            "action":       _action_for(r),
            "justification": r["justification"],
        })

    return {
        "generated_at":     time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now)),
        "mission": {
            "name":     mission_meta.get("name",     "RESCUE_01"),
            "operator": mission_meta.get("operator", "—"),
            "area":     mission_meta.get("area",     "—"),
            "type":     mission_meta.get("type",     "—"),
        },
        "mission_stats":     mission_stats,
        "summary_counts":    summary_counts,
        "ranked_detections": ranked,
        "top_actions":       top_actions,
    }
