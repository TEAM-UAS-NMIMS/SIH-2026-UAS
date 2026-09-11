"""FastAPI application entrypoint for gridZERO."""

from contextlib import asynccontextmanager
import asyncio
import time
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from app.telemetry import telemetry_service, COMMAND_SPEC
from app.detection import detection_pipeline
from app.state import app_state
from app.ws import router as ws_router, broadcast_loop
from app.report import generate_report
from app.simulator import simulator
from app import link

broadcast_task = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global broadcast_task
    telemetry_service.start()
    detection_pipeline.start()
    broadcast_task = asyncio.create_task(broadcast_loop())
    yield
    if broadcast_task:
        broadcast_task.cancel()
    telemetry_service.stop()
    detection_pipeline.stop()

app = FastAPI(
    title="gridZERO API",
    description="Backend service for gridZERO telemetry, detection, and mission management.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(ws_router)

# CORS configuration for localhost
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:8000",
    "http://127.0.0.1",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok"}


@app.get("/api/telemetry")
async def get_telemetry():
    """Returns the current telemetry state as JSON."""
    return app_state.get_state()


async def video_stream():
    """MJPEG stream generator."""
    while True:
        frame = detection_pipeline.get_latest_frame()
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        await asyncio.sleep(0.033)


@app.get("/api/video_feed")
async def video_feed():
    """Streaming endpoint for the latest YOLO annotated frames."""
    return StreamingResponse(video_stream(), media_type="multipart/x-mixed-replace; boundary=frame")



# --- Flight controller link (Pixhawk) ----------------------------------------

class LinkConnectRequest(BaseModel):
    """Body for POST /api/link/connect."""
    link_type: str = "serial"          # "serial" | "udp" | "tcp"
    device:    Optional[str] = None    # e.g. "COM7" or "/dev/ttyACM0"
    host:      Optional[str] = None
    port:      Optional[int] = None
    baud:      int = 115200


@app.get("/api/link/ports")
async def link_ports():
    """Serial ports available on this machine, likely autopilots first.

    Lets an operator plug a Pixhawk in and pick it from a list instead of
    editing an environment variable and restarting the ground station.
    """
    return {
        "ports": link.list_serial_ports(),
        "baud_rates": link.COMMON_BAUD_RATES,
        "default_baud": link.DEFAULT_BAUD,
    }


@app.get("/api/link/status")
async def link_status():
    """Current link state, including what answered the heartbeat."""
    return telemetry_service.status()


@app.post("/api/link/test")
async def link_test(body: LinkConnectRequest):
    """Open the link, wait for a heartbeat, report the result, then close.

    Non-destructive: lets the operator confirm a port and baud rate before
    committing the ground station to it.
    """
    from fastapi import HTTPException
    try:
        conn_str = link.build_connection_string(
            body.link_type, body.device, body.host, body.port
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return await asyncio.to_thread(link.probe_link, conn_str, body.baud)


@app.post("/api/link/connect")
async def link_connect(body: LinkConnectRequest):
    """Point the ground station at this link and start ingesting telemetry."""
    from fastapi import HTTPException
    try:
        conn_str = link.build_connection_string(
            body.link_type, body.device, body.host, body.port
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    result = await asyncio.to_thread(telemetry_service.reconnect, conn_str, body.baud)
    return {**result, "status": telemetry_service.status()}


@app.post("/api/link/disconnect")
async def link_disconnect():
    """Drop the link and stay disconnected until told otherwise."""
    return await asyncio.to_thread(telemetry_service.disconnect)


# --- Vehicle control (Mission Planner essentials) ----------------------------

class ModeRequest(BaseModel):
    mode: str


class ArmRequest(BaseModel):
    arm: bool
    force: bool = False


class MissionUploadRequest(BaseModel):
    altitude: float = 45.0
    waypoints: Optional[List[List[float]]] = None   # defaults to the planned route


@app.post("/api/vehicle/mode")
async def vehicle_mode(body: ModeRequest):
    """Set flight mode by name (GUIDED / AUTO / RTL / LOITER / LAND...)."""
    if simulator.active:
        return {"ok": True, "simulated": True, "code": "ACCEPTED_SIMULATED",
                "detail": "Mode " + body.mode.upper()
                          + " set on the simulated aircraft (no real command sent)",
                "mode": body.mode.upper()}
    return await asyncio.to_thread(telemetry_service.set_mode, body.mode)


@app.post("/api/vehicle/arm")
async def vehicle_arm(body: ArmRequest):
    """Arm or disarm the vehicle.

    The response carries the autopilot's real COMMAND_ACK: a refusal from
    failed pre-arm checks is reported as a refusal, never as success.
    """
    if simulator.active:
        return {"ok": True, "simulated": True, "code": "ACCEPTED_SIMULATED",
                "detail": ("Arm" if body.arm else "Disarm")
                          + " accepted by the simulated aircraft (no real command sent)"}
    return await asyncio.to_thread(telemetry_service.arm, body.arm, body.force)


@app.post("/api/vehicle/mission/upload")
async def vehicle_mission_upload(body: MissionUploadRequest):
    """Upload the planned waypoints to the autopilot via the mission protocol."""
    waypoints = body.waypoints
    if not waypoints:
        with app_state._lock:
            waypoints = list(app_state.mission.get("waypoints") or [])

    if simulator.active:
        return {"ok": True, "simulated": True, "code": "ACCEPTED_SIMULATED",
                "detail": str(len(waypoints))
                          + " waypoints accepted by the simulated aircraft "
                            "(no real upload performed)",
                "uploaded": len(waypoints)}

    return await asyncio.to_thread(
        telemetry_service.upload_mission, waypoints, body.altitude
    )


@app.get("/api/vehicle/modes")
async def vehicle_modes():
    """Flight modes this autopilot offers, for the mode selector."""
    if simulator.active:
        return {"modes": ["STABILIZE", "ALT_HOLD", "LOITER", "AUTO", "GUIDED", "RTL", "LAND"],
                "simulated": True}
    with telemetry_service._conn_lock:
        conn = telemetry_service._connection
        if conn is None:
            return {"modes": [], "detail": "No flight controller connected"}
        try:
            return {"modes": sorted((conn.mode_mapping() or {}).keys())}
        except Exception as exc:
            return {"modes": [], "detail": str(exc)}


# ─── Pre-flight checklist ─────────────────────────────────────────────────────

class PreflightAckRequest(BaseModel):
    """Body for POST /api/preflight/ack."""
    item_id: str
    ack: bool = True
    by: str = "operator"


@app.post("/api/preflight/ack")
async def preflight_ack(body: PreflightAckRequest):
    """Record an operator tick against a checklist item that no sensor can verify.

    Props inspected, observer posted, airspace cleared — these are crew actions,
    not telemetry. They are persisted server-side so they survive navigation and
    can be cited in the mission report: a pre-flight checklist is a record of
    what the crew actually confirmed.
    """
    acks = app_state.acknowledge_preflight(body.item_id, body.ack, body.by)
    return {"ok": True, "acks": acks}


@app.post("/api/preflight/reset")
async def preflight_reset():
    """Clear all operator acknowledgements (new sortie)."""
    app_state.reset_preflight_acks()
    return {"ok": True, "acks": {}}


# ─── Mission geometry ─────────────────────────────────────────────────────────

class GeometryRequest(BaseModel):
    """Body for PUT /api/mission/geometry. Any subset may be sent."""
    waypoints:     Optional[List[List[float]]] = None
    searchPolygon: Optional[List[List[float]]] = None
    hazardZone:    Optional[List[List[float]]] = None
    geofence:      Optional[List[List[float]]] = None
    launchPoint:   Optional[List[float]] = None


@app.put("/api/mission/geometry")
async def update_mission_geometry(body: GeometryRequest):
    """Persist the flight plan the operator drew.

    Planner edits used to live only in React state, so navigating away threw the
    whole plan away and the aircraft never saw it. Saving here also recomputes
    distance / flight time / coverage from the real route.
    """
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="No geometry supplied")

    mission = app_state.update_geometry(payload)
    app_state.add_event(
        time.time(),
        f"Mission geometry updated — {mission['stats']['distanceKm']} km route, "
        f"{mission['stats']['coverageHa']} ha search area",
        "info",
        event_type="geometry_updated",
    )
    return {"ok": True, "mission": mission}


# ─── Camera control ───────────────────────────────────────────────────────────

@app.post("/api/camera/start")
async def camera_start():
    """Open the camera and begin YOLO inference.

    The payload starts OFF: an operator decides when the camera goes live,
    rather than the backend grabbing the device the moment it boots.
    """
    return await asyncio.to_thread(detection_pipeline.enable)


@app.post("/api/camera/stop")
async def camera_stop():
    """Release the camera and stop inference."""
    return await asyncio.to_thread(detection_pipeline.disable)


@app.get("/api/camera/status")
async def camera_status():
    return detection_pipeline.status()


# ─── Demo mode ────────────────────────────────────────────────────────────────

@app.post("/api/demo/start")
async def demo_start():
    """Start a simulated mission so the console can be demonstrated end-to-end.

    The simulator drives the same state, tracker and ranking code a real
    mission uses; only the source of the telemetry and observations differs.
    Every response and broadcast flags demo_mode so the UI can make it obvious.
    """
    result = await asyncio.to_thread(simulator.start)
    if not result.get("ok"):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=result.get("detail", "Could not start demo"))
    app_state.update_telemetry({"phase": "LIVE_RESCUE"})
    return {**result, "demo_mode": True}


@app.post("/api/demo/stop")
async def demo_stop():
    """Stop the simulated mission and clear the demo flag."""
    result = await asyncio.to_thread(simulator.stop)
    return {**result, "demo_mode": False}


@app.get("/api/demo/status")
async def demo_status():
    return simulator.status()


class CommandRequest(BaseModel):
    """Body for POST /api/command."""
    command: str      # "rtl" | "land" | "hold"


@app.post("/api/command")
async def send_command(body: CommandRequest):
    """Send a flight command to the aircraft over MAVLink.

    Returns the real outcome, including the autopilot's COMMAND_ACK result.
    A command that could not be delivered or was not acknowledged comes back
    with ok=false and an explicit reason — the UI must surface that rather than
    showing a success animation, which is the defect this endpoint replaces.

    HTTP is 200 for "we got your request and here is what happened"; inspect
    `ok` for whether the aircraft accepted it. 503 is returned when there is no
    link at all, so the UI can disable the controls.
    """
    from fastapi import HTTPException

    allowed = set(COMMAND_SPEC.keys())
    if body.command not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"command must be one of {sorted(allowed)}",
        )

    if simulator.active:
        # Simulated aircraft: the response is explicitly marked simulated so it
        # can never be mistaken for a real autopilot acknowledgement.
        return await asyncio.to_thread(simulator.send_command, body.command)

    result = await asyncio.to_thread(telemetry_service.send_command, body.command)

    if result.get("code") == "NO_LINK":
        raise HTTPException(status_code=503, detail=result["detail"])

    return result


@app.get("/api/command/availability")
async def command_availability():
    """Whether flight commands can currently be issued.

    The UI uses this to disable RTL/LAND/HOLD with an explicit reason instead
    of presenting controls that look armed but cannot reach the aircraft.
    """
    if simulator.active:
        return {
            "available": True,
            "simulated": True,
            "reason": None,
            "commands": sorted(COMMAND_SPEC.keys()),
        }
    connected = telemetry_service.is_connected
    return {
        "available": connected,
        "simulated": False,
        "reason": None if connected else "No flight controller connected",
        "commands": sorted(COMMAND_SPEC.keys()),
    }


@app.get("/api/flight_path")
async def get_flight_path():
    """The path actually flown this mission, oldest sample first.

    Backed by AppState._position_history, which records every valid fix for the
    whole session — not just the samples that arrived while the Analysis screen
    was mounted.
    """
    path = app_state.get_flight_path()
    return {"count": len(path), "path": path}


@app.get("/api/detections")
async def get_detections(active_only: bool = False):
    """Every detection track accumulated this mission.

    Each entry carries `active` (seen within the last couple of seconds), so
    the Live screen can show "currently visible" while Analysis shows every
    sighting of the mission. Pass ?active_only=true for just the live set.
    """
    dets = app_state.get_detections()
    if active_only:
        dets = [d for d in dets if d.get("active")]
    return dets


class PhaseRequest(BaseModel):
    phase: str


@app.post("/api/mission/phase")
async def set_mission_phase(body: PhaseRequest):
    """Update the current mission phase (e.g. PRE_FLIGHT -> LIVE_RESCUE)."""
    allowed = {"PRE_FLIGHT", "LIVE_RESCUE", "ANALYSIS", "REPORT"}
    if body.phase not in allowed:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail=f"Unknown phase: {body.phase}")
    app_state.update_telemetry({"phase": body.phase})
    # Record mission start time when entering the live phase.
    if body.phase == "LIVE_RESCUE":
        app_state.mark_mission_start()
    return {"ok": True, "phase": body.phase}


@app.post("/api/mission/end")
async def end_mission():
    """End the active mission, compute stats, and transition to ANALYSIS phase.

    Actions (in order):
      1. Compute mission stats from logged telemetry/events/detections.
      2. Set phase to ANALYSIS.
      3. Log a "Mission ended" event on the timeline.

    Returns the computed stats so the caller can act immediately without
    a separate GET /api/mission/stats round-trip.
    """
    import time

    stats = app_state.compute_mission_stats()
    app_state.lock_mission_stats()
    app_state.update_telemetry({"phase": "ANALYSIS"})
    app_state.add_event(
        timestamp=time.time(),
        message=(
            f"Mission ended — "
            f"{stats['duration_seconds']:.0f} s, "
            f"{stats['detection_count']} detection(s), "
            f"{stats['area_covered_pct']:.1f}% area covered"
        ),
        severity="info",
    )
    return {"ok": True, "phase": "ANALYSIS", "stats": stats}


@app.get("/api/mission/stats")
async def get_mission_stats():
    """Return the last computed mission stats.

    If POST /api/mission/end has not been called yet this session,
    compute a live snapshot on demand without changing the phase.
    """
    with app_state._lock:
        locked = app_state.mission_stats_locked
        cached = dict(app_state.mission_stats)
    if locked and cached:
        # Mission has ended — serve the frozen post-mission record.
        return cached
    # Mission still running: recompute a live snapshot (phase unchanged).
    return app_state.compute_mission_stats()


class ReviewRequest(BaseModel):
    """Body for POST /api/detections/{id}/review."""
    action:   str             # "confirm" | "reject" | "adjust_priority"
    priority: str | None = None   # required when action=="adjust_priority"
    notes:    str | None = None   # optional free-text annotation


@app.post("/api/detections/{det_id}/review")
async def review_detection(det_id: str, body: ReviewRequest):
    """Record an analyst decision against a detection track.

    Allowed actions:
      confirm          -> status = "confirmed"
      reject           -> status = "rejected"
      adjust_priority  -> priority = body.priority ("high"|"medium"|"low")

    The decision is stored in AppState.review_overrides, keyed by the stable
    track_id, and merged over the tracker's data on read. Inference frames
    cannot overwrite it. Returns 404 if the track is unknown.
    """
    from fastapi import HTTPException

    allowed_actions    = {"confirm", "reject", "adjust_priority"}
    allowed_priorities = {"high", "medium", "low"}

    if body.action not in allowed_actions:
        raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")

    status = None
    priority = None

    if body.action == "confirm":
        status = "confirmed"
    elif body.action == "reject":
        status = "rejected"
    elif body.action == "adjust_priority":
        if body.priority not in allowed_priorities:
            raise HTTPException(
                status_code=400,
                detail=f"priority must be one of {allowed_priorities}",
            )
        priority = body.priority

    updated = app_state.apply_review(
        det_id, status=status, priority=priority, notes=body.notes
    )
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Detection {det_id!r} not found")
    return {"ok": True, "detection": updated}


@app.get("/api/report")
async def get_report():
    """Generate and return a full post-mission report.

    Ranking formula (documented in app/report.py):
        score = 0.50 * confidence
              + 0.30 * proximity_to_hazard_zone  (normalised, closer = higher)
              + 0.20 * age                        (normalised, older = higher)

    Tier thresholds:
        score ≥ 0.75 → URGENT
        score ≥ 0.55 → HIGH
        score ≥ 0.35 → MEDIUM
        else         → LOW

    All justification strings are template-based; no LLM is called.

    Returns
    -------
    {
        generated_at      : ISO timestamp
        mission           : {name, operator, area, type}
        mission_stats     : from compute_mission_stats()
        summary_counts    : {URGENT, HIGH, MEDIUM, LOW}
        ranked_detections : sorted list with per-item justification +
                            score_components for transparency
        top_actions       : top-3 non-rejected detections as action strings
    }
    """
    # Snapshot everything we need under a single lock acquisition
    detections = app_state.get_detections()
    with app_state._lock:
        hazard_zone  = list(app_state.mission.get("hazardZone", []))
        mission_start = app_state._mission_start_time
        mission_meta = dict(app_state.mission)
        cached_stats = dict(app_state.mission_stats)

    # Reuse cached stats if available, otherwise compute a live snapshot
    mission_stats = cached_stats if cached_stats else app_state.compute_mission_stats()

    return generate_report(
        detections=detections,
        hazard_zone=hazard_zone,
        mission_stats=mission_stats,
        mission_meta=mission_meta,
        mission_start=mission_start,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
