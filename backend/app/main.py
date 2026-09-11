"""FastAPI application entrypoint for gridZERO."""

from contextlib import asynccontextmanager
import asyncio
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.telemetry import telemetry_service
from app.detection import detection_pipeline
from app.state import app_state
from app.ws import router as ws_router, broadcast_loop
from app.report import generate_report

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


@app.get("/api/detections")
async def get_detections():
    """Returns the current list of detections."""
    return app_state.get_state()["detections"]


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
        cached = dict(app_state.mission_stats)
    if cached:
        return cached
    # No cached stats yet — compute a live snapshot (phase unchanged).
    return app_state.compute_mission_stats()


class ReviewRequest(BaseModel):
    """Body for POST /api/detections/{id}/review."""
    action:   str             # "confirm" | "reject" | "adjust_priority"
    priority: str | None = None   # required when action=="adjust_priority"
    notes:    str | None = None   # optional free-text annotation


@app.post("/api/detections/{det_id}/review")
async def review_detection(det_id: str, body: ReviewRequest):
    """Update a detection's review status in-place.

    Allowed actions:
      confirm          — sets detection.status = "confirmed"
      reject           — sets detection.status = "rejected"
      adjust_priority  — sets detection.priority to body.priority
                          (must be "high" | "medium" | "low")

    Optional notes field is stored on the detection.
    Returns 404 if det_id is not found in the current detections list.
    """
    from fastapi import HTTPException

    allowed_actions   = {"confirm", "reject", "adjust_priority"}
    allowed_priorities = {"high", "medium", "low"}

    if body.action not in allowed_actions:
        raise HTTPException(status_code=400, detail=f"Unknown action: {body.action}")

    if body.action == "adjust_priority":
        if body.priority not in allowed_priorities:
            raise HTTPException(
                status_code=400,
                detail=f"priority must be one of {allowed_priorities}",
            )

    with app_state._lock:
        for det in app_state.detections:
            if det.get("id") == det_id:
                if body.action == "confirm":
                    det["status"] = "confirmed"
                elif body.action == "reject":
                    det["status"] = "rejected"
                elif body.action == "adjust_priority":
                    det["priority"] = body.priority
                    det["status"] = det.get("status", "pending")
                if body.notes is not None:
                    det["notes"] = body.notes
                return {"ok": True, "detection": dict(det)}
        raise HTTPException(status_code=404, detail=f"Detection {det_id!r} not found")


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
    with app_state._lock:
        detections   = list(app_state.detections)
        hazard_zone  = list(app_state.mission.get("hazardZone", []))
        mission_meta = dict(app_state.mission)
        cached_stats = dict(app_state.mission_stats)

    # Reuse cached stats if available, otherwise compute a live snapshot
    mission_stats = cached_stats if cached_stats else app_state.compute_mission_stats()

    return generate_report(
        detections=detections,
        hazard_zone=hazard_zone,
        mission_stats=mission_stats,
        mission_meta=mission_meta,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
