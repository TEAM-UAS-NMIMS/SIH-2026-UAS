"""Rescue tasking — turn a ranked detection into an actionable dispatch card.

Why this exists
---------------
A ranked list of coordinates is not a rescue plan. The crew going to a casualty
needs to know how far, on what bearing, how big an area to sweep when they get
there, what the hazard picture is, and how much of the survival window is left.

Everything here is derived from data gridZERO actually holds — the detection's
position and its uncertainty, the hazard polygon, the launch/staging point, the
confidence, and the mission clock. Nothing is invented:

  * distance and bearing come from the staging point to the casualty
  * the on-arrival search radius comes from the position uncertainty, which in
    turn comes from whether the fix was GNSS or VIO dead-reckoning
  * hazard standoff comes from the real distance to the hazard polygon
  * urgency comes from the golden-hour clock

Where a recommendation cannot be supported by data we say so, rather than
guessing. In particular gridZERO has no terrain model, no water layer and no
casualty triage, so this module never claims to know the medical picture or the
ground conditions — it says what is known and flags what must be assessed on
arrival.
"""

import math
from typing import Any, Dict, List, Optional


# Survival window used across the console.
GOLDEN_WINDOW_S = 12 * 60 * 60

# A ground team moving over unknown terrain, conservatively.
GROUND_SPEED_MS = 1.1          # ~4 km/h including obstacles
VEHICLE_SPEED_MS = 8.3         # ~30 km/h on tracks

# Inside this distance from the hazard polygon, approach needs specific care.
HAZARD_CLOSE_M = 50.0
HAZARD_CAUTION_M = 150.0

COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
           "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]


def _haversine_m(lat1, lon1, lat2, lon2) -> float:
    R = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _bearing_deg(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def _compass(bearing: float) -> str:
    return COMPASS[int((bearing + 11.25) % 360 // 22.5)]


def _fmt_duration(seconds: float) -> str:
    if seconds < 90:
        return f"{seconds:.0f} s"
    if seconds < 3600:
        return f"{seconds / 60:.0f} min"
    return f"{seconds / 3600:.1f} h"


def build_rescue_plan(
    det: Dict[str, Any],
    rank: int,
    staging: Optional[List[float]],
    hazard_distance_m: Optional[float],
    mission_start: Optional[float],
    now: float,
) -> Dict[str, Any]:
    """Build the dispatch card for one casualty."""
    lat, lon = det.get("lat"), det.get("lon")
    tier = det.get("tier", "LOW")
    conf = float(det.get("confidence", 0.0))
    source = det.get("position_source", "UNKNOWN")
    unc = det.get("uncertainty_m")

    plan: Dict[str, Any] = {
        "rank": rank,
        "detection_id": det.get("id"),
        "tier": tier,
    }

    # ── Approach: where is it, from the staging point ────────────────────
    if lat is None or lon is None:
        plan["approach"] = {
            "known": False,
            "note": "No position estimate for this contact. It cannot be tasked "
                    "to a ground team until a fix is recovered — re-fly the leg "
                    "with GNSS restored.",
        }
        plan["search_pattern"] = None
    elif staging and len(staging) == 2:
        dist = _haversine_m(staging[0], staging[1], lat, lon)
        brg = _bearing_deg(staging[0], staging[1], lat, lon)
        plan["approach"] = {
            "known": True,
            "distance_m": round(dist, 1),
            "bearing_deg": round(brg),
            "cardinal": _compass(brg),
            "on_foot": _fmt_duration(dist / GROUND_SPEED_MS),
            "by_vehicle": _fmt_duration(dist / VEHICLE_SPEED_MS),
            "note": f"{dist:.0f} m on a bearing of {brg:.0f}° ({_compass(brg)}) "
                    f"from the staging point.",
        }
    else:
        plan["approach"] = {
            "known": True,
            "note": "Position known, but no staging point is set — distance and "
                    "bearing cannot be computed. Set the launch point on the planner.",
        }

    # ── On-arrival search pattern, sized from the real position error ────
    if lat is not None and unc is not None:
        # Sweep a radius of 3x the stated uncertainty: a ~99% containment
        # radius if the error is roughly Gaussian, which is the conservative
        # read for a life-safety task.
        radius = max(10.0, unc * 3.0)
        plan["search_pattern"] = {
            "radius_m": round(radius),
            "method": "Expanding spiral from the coordinate",
            "note": (
                f"Position is {source.replace('_', ' ')}-derived with "
                f"±{unc:.0f} m stated error. Sweep a {radius:.0f} m radius around "
                f"the coordinate rather than treating it as a point."
                + (" VIO dead-reckoning drifts, so treat the coordinate as an "
                   "area of probability, not a location."
                   if source == "VIO_FALLBACK" else "")
            ),
        }
    elif lat is not None:
        plan["search_pattern"] = {
            "radius_m": None,
            "method": "Visual sweep",
            "note": "No position uncertainty was recorded; size the sweep on arrival.",
        }

    # ── Hazard picture ───────────────────────────────────────────────────
    if hazard_distance_m is None:
        plan["hazard"] = {
            "level": "unknown",
            "note": "No hazard zone was defined for this mission, so no standoff "
                    "can be advised. Assess on approach.",
        }
    elif hazard_distance_m < HAZARD_CLOSE_M:
        plan["hazard"] = {
            "level": "inside",
            "distance_m": round(hazard_distance_m),
            "note": f"Casualty is {hazard_distance_m:.0f} m from the hazard "
                    "boundary — effectively inside it. Do not commit a team "
                    "until incident command clears entry; full PPE, buddy "
                    "system, and a named safety officer watching the boundary.",
        }
    elif hazard_distance_m < HAZARD_CAUTION_M:
        plan["hazard"] = {
            "level": "close",
            "distance_m": round(hazard_distance_m),
            "note": f"{hazard_distance_m:.0f} m from the hazard boundary. Approach "
                    "from the far side, keep an escape route open, and post a "
                    "lookout on the hazard.",
        }
    else:
        plan["hazard"] = {
            "level": "clear",
            "distance_m": round(hazard_distance_m),
            "note": f"{hazard_distance_m:.0f} m clear of the hazard zone. Standard "
                    "approach.",
        }

    # ── Verification posture, from detection confidence ──────────────────
    if conf >= 0.90:
        plan["verification"] = {
            "posture": "commit",
            "note": f"{conf * 100:.0f}% detection confidence across "
                    f"{det.get('sightings') or '?'} sightings. Strong enough to "
                    "commit a team without a re-fly.",
        }
    elif conf >= 0.70:
        plan["verification"] = {
            "posture": "verify",
            "note": f"{conf * 100:.0f}% confidence. Task a team, but re-fly the "
                    "coordinate for a confirming pass if one is available.",
        }
    else:
        plan["verification"] = {
            "posture": "re-fly",
            "note": f"{conf * 100:.0f}% confidence — weak. Re-fly this coordinate "
                    "at lower altitude before committing ground resources.",
        }

    # ── Resourcing, scaled to what the data supports ─────────────────────
    if tier == "URGENT":
        plan["resourcing"] = {
            "team": "2 technical rescuers + 1 medic",
            "equipment": "Stretcher, trauma kit, extrication tools, comms relay",
            "note": "Highest-ranked contact. Dispatch first and hold a second "
                    "team in reserve for extraction support.",
        }
    elif tier == "HIGH":
        plan["resourcing"] = {
            "team": "2 rescuers + 1 medic",
            "equipment": "Stretcher, trauma kit, comms",
            "note": "Dispatch as soon as a team is free.",
        }
    elif tier == "MEDIUM":
        plan["resourcing"] = {
            "team": "2 rescuers",
            "equipment": "First aid kit, comms",
            "note": "Schedule after higher-ranked contacts are cleared.",
        }
    else:
        plan["resourcing"] = {
            "team": "1 rescuer (assess and report)",
            "equipment": "First aid kit, comms",
            "note": "Log and sweep when resources allow; re-verify before "
                    "committing a full team.",
        }

    # ── Time pressure, from the mission clock ────────────────────────────
    if mission_start:
        remaining = GOLDEN_WINDOW_S - (now - mission_start)
        plan["time"] = {
            "golden_hour_remaining_s": round(max(0.0, remaining)),
            "expired": remaining <= 0,
            "note": (
                "Survival window has elapsed. Continue as a recovery operation "
                "under incident command direction."
                if remaining <= 0 else
                f"{_fmt_duration(remaining)} of the 12-hour survival window remains."
                + (" Time-critical — dispatch now."
                   if remaining < 2 * 3600 else "")
            ),
        }
    else:
        plan["time"] = {
            "golden_hour_remaining_s": None,
            "expired": False,
            "note": "Mission start was not recorded, so the survival window "
                    "cannot be computed.",
        }

    # ── One-line order, assembled from the above ─────────────────────────
    bits = [f"{tier}"]
    ap = plan.get("approach", {})
    if ap.get("distance_m") is not None:
        bits.append(f"{ap['distance_m']:.0f} m {ap['cardinal']} ({ap['bearing_deg']}°)")
    if plan.get("search_pattern", {}) and plan["search_pattern"].get("radius_m"):
        bits.append(f"sweep {plan['search_pattern']['radius_m']} m radius")
    if plan["hazard"]["level"] in ("inside", "close"):
        bits.append(f"hazard {plan['hazard']['distance_m']} m")
    bits.append(plan["resourcing"]["team"])
    plan["order"] = " · ".join(bits)

    return plan


def build_rescue_summary(
    ranked: List[Dict[str, Any]],
    mission_start: Optional[float],
    now: float,
) -> Dict[str, Any]:
    """Force-level summary for the incident commander."""
    actionable = [r for r in ranked if r.get("status") != "rejected"]
    urgent = [r for r in actionable if r.get("tier") == "URGENT"]
    high = [r for r in actionable if r.get("tier") == "HIGH"]
    no_fix = [r for r in actionable if r.get("lat") is None]
    vio = [r for r in actionable if r.get("position_source") == "VIO_FALLBACK"]

    # Teams needed if urgent and high contacts are worked in parallel.
    teams = max(1, len(urgent) + max(0, (len(high) + 1) // 2)) if actionable else 0

    remaining = (GOLDEN_WINDOW_S - (now - mission_start)) if mission_start else None

    notes: List[str] = []
    if urgent:
        notes.append(
            f"{len(urgent)} urgent contact(s) — dispatch immediately, in parallel "
            "if teams allow."
        )
    if no_fix:
        notes.append(
            f"{len(no_fix)} contact(s) have no position estimate and cannot be "
            "tasked. Re-fly those legs with GNSS restored."
        )
    if vio:
        notes.append(
            f"{len(vio)} contact(s) were located by VIO dead-reckoning rather "
            "than GNSS; treat their coordinates as areas, not points."
        )
    if remaining is not None and remaining < 2 * 3600:
        notes.append(
            "Under two hours of the survival window remain — prioritise "
            "extraction over further searching."
        )
    if not actionable:
        notes.append("No actionable contacts. Continue or re-task the search.")

    return {
        "actionable_count": len(actionable),
        "urgent_count": len(urgent),
        "high_count": len(high),
        "unlocatable_count": len(no_fix),
        "degraded_position_count": len(vio),
        "teams_recommended": teams,
        "golden_hour_remaining_s": round(max(0.0, remaining)) if remaining is not None else None,
        "notes": notes,
    }
