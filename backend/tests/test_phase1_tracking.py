"""Phase 1 verification — detection identity, accumulation and review durability.

Proves the three things the audit demanded:
  (a) the same track_id persists across frames for a moving target
  (b) a Confirm/Reject/priority/notes change survives subsequent inference cycles
  (c) the report lists every distinct track seen, not just the last frame

Run:  python -m pytest tests/test_phase1_tracking.py -v
   or python tests/test_phase1_tracking.py
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.state import AppState                      # noqa: E402
from app.report import generate_report              # noqa: E402


FRAME_W, FRAME_H = 640, 480


def _obs(cx, cy, conf=0.80, lat=None, lon=None, size=40):
    """One synthetic observation centred at (cx, cy)."""
    half = size / 2
    return {
        "label": "person",
        "confidence": conf,
        "bbox": [cx - half, cy - half, cx + half, cy + half],
        "lat": lat,
        "lon": lon,
        "position_source": "GNSS" if lat is not None else "NO_POSITION",
        "uncertainty_m": 2.0 if lat is not None else None,
    }


def test_track_id_persists_for_moving_target():
    """(a) A person walking across frame keeps one stable id."""
    st = AppState()

    ids = []
    for step in range(40):                      # 40 inference cycles
        cx = 100 + step * 8                     # drifts 8 px per cycle
        cy = 240
        st.update_detections([_obs(cx, cy)], FRAME_W, FRAME_H)
        dets = st.get_detections()
        assert len(dets) == 1, f"expected 1 track at step {step}, got {len(dets)}"
        ids.append(dets[0]["id"])

    assert len(set(ids)) == 1, f"track id changed mid-flight: {len(set(ids))} distinct ids"

    det = st.get_detections()[0]
    assert det["sightings"] == 40
    assert det["last_seen"] > det["first_seen"]
    print(f"  (a) one id across 40 frames: {ids[0][:8]}… sightings={det['sightings']}")


def test_review_survives_subsequent_inference():
    """(b) An analyst decision is not clobbered by later frames."""
    st = AppState()
    st.update_detections([_obs(200, 200)], FRAME_W, FRAME_H)
    track_id = st.get_detections()[0]["id"]

    st.apply_review(track_id, status="confirmed", notes="Visual on survivor, waving")
    st.apply_review(track_id, priority="high")

    # 10 further inference cycles on the same moving target
    for step in range(10):
        st.update_detections([_obs(200 + step * 5, 200)], FRAME_W, FRAME_H)

    det = next(d for d in st.get_detections() if d["id"] == track_id)
    assert det["status"] == "confirmed", f"status lost: {det['status']}"
    assert det["priority"] == "high", f"priority lost: {det['priority']}"
    assert det["notes"] == "Visual on survivor, waving", "notes lost"
    print(f"  (b) review survived 10 cycles: status={det['status']} "
          f"priority={det['priority']} notes present")


def test_report_lists_all_distinct_tracks():
    """(c) The report covers the whole mission, not the last frame."""
    st = AppState()

    # Three people appear in different parts of the frame at different times,
    # and none of them is present in the final frame.
    st.update_detections([_obs(100, 100, conf=0.95)], FRAME_W, FRAME_H)
    time.sleep(0.01)
    st.update_detections([_obs(500, 120, conf=0.85)], FRAME_W, FRAME_H)
    time.sleep(0.01)
    st.update_detections([_obs(320, 400, conf=0.60)], FRAME_W, FRAME_H)
    time.sleep(0.01)
    st.update_detections([], FRAME_W, FRAME_H)          # nobody in final frame

    dets = st.get_detections()
    assert len(dets) == 3, f"expected 3 accumulated tracks, got {len(dets)}"

    report = generate_report(
        detections=dets,
        hazard_zone=[],
        mission_stats={},
        mission_meta={"name": "TEST"},
    )
    assert len(report["ranked_detections"]) == 3, "report dropped tracks"

    stats = st.compute_mission_stats()
    assert stats["detection_count"] == 3, f"detection_count wrong: {stats}"
    print(f"  (c) 3 tracks accumulated, report ranked {len(report['ranked_detections'])}, "
          f"detection_count={stats['detection_count']}")


def test_age_term_is_live_again():
    """The 20% age weight actually varies now that timestamp is first_seen."""
    st = AppState()
    st.update_detections([_obs(300, 300, conf=0.5)], FRAME_W, FRAME_H)
    det = st.get_detections()[0]

    # Backdate first_seen by 5 minutes to simulate a long-waiting survivor.
    track = next(iter(st.tracker._tracks.values()))
    track.first_seen = time.time() - 300.0

    aged = st.get_detections()[0]
    report = generate_report([aged], [], {}, {})
    age_score = report["ranked_detections"][0]["score_components"]["age_score"]

    assert age_score > 0.4, f"age term still inert: {age_score}"
    print(f"  (d) age_score for a 5-minute-old track = {age_score} (was always ~0)")


def test_rejected_excluded_from_survivor_counts():
    """Rejected tracks leave the survivor counts but stay reconcilable."""
    st = AppState()
    st.update_detections([_obs(100, 100, conf=0.95)], FRAME_W, FRAME_H)
    st.update_detections([_obs(500, 400, conf=0.95)], FRAME_W, FRAME_H)

    dets = st.get_detections()
    st.apply_review(dets[0]["id"], status="rejected")

    stats = st.compute_mission_stats()
    assert stats["detection_count"] == 1, stats
    assert stats["rejected_count"] == 1, stats
    print(f"  (e) counts reconcile: {stats['detection_count']} kept, "
          f"{stats['rejected_count']} rejected")


def test_active_flag_distinguishes_live_from_historical():
    """Live screen shows current targets; Analysis shows every sighting."""
    st = AppState()
    st.update_detections([_obs(100, 100)], FRAME_W, FRAME_H)   # old sighting
    old_id = st.get_detections()[0]["id"]

    # Age that track past the active window, then see somebody else.
    st.tracker._tracks[old_id].last_seen = time.time() - 30.0
    st.update_detections([_obs(500, 400)], FRAME_W, FRAME_H)

    dets = st.get_detections()
    active = [d for d in dets if d["active"]]
    assert len(dets) == 2, f"both tracks should be retained, got {len(dets)}"
    assert len(active) == 1, f"only the recent track should be active, got {len(active)}"
    assert next(d for d in dets if d["id"] == old_id)["active"] is False
    print(f"  (g) {len(dets)} tracks retained, {len(active)} currently active")


def test_separate_people_get_separate_tracks():
    """Two people far apart must not collapse into one track."""
    st = AppState()
    st.update_detections(
        [_obs(80, 80), _obs(560, 420)], FRAME_W, FRAME_H
    )
    assert len(st.get_detections()) == 2, "distinct targets merged"
    print("  (f) two distant targets stayed distinct")


if __name__ == "__main__":
    for fn in (
        test_track_id_persists_for_moving_target,
        test_review_survives_subsequent_inference,
        test_report_lists_all_distinct_tracks,
        test_age_term_is_live_again,
        test_rejected_excluded_from_survivor_counts,
        test_active_flag_distinguishes_live_from_historical,
        test_separate_people_get_separate_tracks,
    ):
        print(f"\n{fn.__name__}:")
        fn()
    print("\nAll Phase 1 verifications passed.")
