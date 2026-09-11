"""Phase 1 verification at the HTTP layer.

The unit tests prove the tracker and AppState behave. This exercises the real
FastAPI routes against the same process-wide app_state, so it also proves the
API surface the frontend consumes is correct — /api/detections accumulates,
/api/detections/{id}/review persists across inference, and /api/report and
/api/mission/stats describe the whole mission rather than one frame.

Run:  python tests/test_phase1_api.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Keep the real background threads out of this test: no camera, no MAVLink.
os.environ.setdefault("VIDEO_SOURCE", "__none__")
os.environ.setdefault("MAVLINK_CONNECTION_STRING", "__none__")

from fastapi.testclient import TestClient   # noqa: E402
from app.main import app                    # noqa: E402
from app.state import app_state             # noqa: E402


FRAME_W, FRAME_H = 640, 480


def observe(step, conf=0.88):
    """Push one synthetic inference frame through the real state path."""
    app_state.update_detections([{
        "label": "person",
        "confidence": conf,
        "bbox": [100 + step * 6, 200, 140 + step * 6, 300],
        "lat": 51.5062,
        "lon": -0.0885,
        "position_source": "GNSS",
        "uncertainty_m": 2.0,
    }], FRAME_W, FRAME_H)


def main():
    # TestClient runs lifespan, which starts the pipeline threads; they will
    # simply fail to open the bogus sources and idle, which is what we want.
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        print("health: ok")

        # ── Accumulation ────────────────────────────────────────────────
        for step in range(6):
            observe(step)

        dets = client.get("/api/detections").json()
        assert len(dets) == 1, f"expected 1 accumulated track, got {len(dets)}"
        track = dets[0]
        tid = track["id"]
        assert track["sightings"] == 6, track["sightings"]
        assert track["active"] is True
        print(f"accumulated: 1 track, {track['sightings']} sightings, active={track['active']}")

        # ── active_only filter ──────────────────────────────────────────
        live = client.get("/api/detections?active_only=true").json()
        assert len(live) == 1, live
        print(f"active_only filter: {len(live)} live track")

        # ── Review persistence ──────────────────────────────────────────
        r = client.post(f"/api/detections/{tid}/review",
                        json={"action": "confirm", "notes": "E2E confirm"})
        assert r.status_code == 200, r.text
        assert r.json()["detection"]["status"] == "confirmed"

        r = client.post(f"/api/detections/{tid}/review",
                        json={"action": "adjust_priority", "priority": "high"})
        assert r.status_code == 200, r.text
        print("review written: confirmed + priority=high + notes")

        # The old code erased the review right here.
        for step in range(6, 20):
            observe(step, conf=0.93)

        after = [d for d in client.get("/api/detections").json() if d["id"] == tid][0]
        assert after["status"] == "confirmed", f"status lost: {after['status']}"
        assert after["priority"] == "high", f"priority lost: {after['priority']}"
        assert after["notes"] == "E2E confirm", "notes lost"
        assert after["sightings"] == 20, after["sightings"]
        print(f"after 14 more inference frames: status={after['status']} "
              f"priority={after['priority']} sightings={after['sightings']} — review intact")

        # ── Unknown track is a clean 404 ────────────────────────────────
        r = client.post("/api/detections/not-a-real-id/review", json={"action": "confirm"})
        assert r.status_code == 404, r.status_code
        print("unknown track id -> 404")

        # ── Report covers the mission ───────────────────────────────────
        # A second person appears elsewhere and then leaves frame entirely.
        app_state.update_detections([{
            "label": "person", "confidence": 0.72,
            "bbox": [520, 380, 560, 450],
            "lat": 51.5071, "lon": -0.0941,
            "position_source": "GNSS", "uncertainty_m": 2.0,
        }], FRAME_W, FRAME_H)
        app_state.update_detections([], FRAME_W, FRAME_H)

        rep = client.get("/api/report").json()
        assert len(rep["ranked_detections"]) == 2, rep["summary_counts"]
        ids = {d["id"] for d in rep["ranked_detections"]}
        assert tid in ids, "report dropped the reviewed track"
        top = rep["ranked_detections"][0]
        print(f"report: {len(rep['ranked_detections'])} ranked, top tier={top['tier']}, "
              f"score={top['score']}, age_score={top['score_components']['age_score']}")

        stats = client.get("/api/mission/stats").json()
        assert stats["detection_count"] == 2, stats
        print(f"stats: detection_count={stats['detection_count']} "
              f"rejected_count={stats['rejected_count']}")

        # ── Reject removes from survivor counts, keeps the record ───────
        client.post(f"/api/detections/{tid}/review", json={"action": "reject"})
        stats = client.get("/api/mission/stats").json()
        assert stats["detection_count"] == 1 and stats["rejected_count"] == 1, stats
        assert len(client.get("/api/detections").json()) == 2, "rejected track was deleted"
        print(f"after reject: kept={stats['detection_count']} "
              f"rejected={stats['rejected_count']}, record retained")

    print("\nPHASE 1 API VERIFICATION: PASS")


if __name__ == "__main__":
    main()
