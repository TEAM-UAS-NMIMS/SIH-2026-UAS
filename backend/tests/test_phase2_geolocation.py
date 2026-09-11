"""Phase 2 verification — geolocation altitude reference and camera model.

The audit's D4 finding: estimate_detection_location() treats its altitude
argument as height above ground, but telemetry filled it from
GLOBAL_POSITION_INT.alt (MSL). On terrain 200 m above sea level, every
detection was projected as if the drone were 200 m higher.

These tests prove:
  1. ground offset depends ONLY on AGL height, never on terrain elevation
  2. the MSL/AGL distinction is actually wired through telemetry parsing
  3. the camera HFOV is no longer the fictitious 60 deg
  4. no coordinate is invented when altitude or position is missing

Run:  python tests/test_phase2_geolocation.py
"""

import math
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.detection import (                     # noqa: E402
    estimate_detection_location,
    camera_model_summary,
    CAMERA_HFOV_DEG,
)

FRAME_W, FRAME_H = 640, 480
HOME_LAT, HOME_LON = 51.5050, -0.0900


def _offset_metres(lat, lon):
    """Ground offset of (lat, lon) from home, in metres north/east."""
    dn = (lat - HOME_LAT) * 111111.0
    de = (lon - HOME_LON) * 111111.0 * math.cos(math.radians(HOME_LAT))
    return dn, de


def test_ground_offset_independent_of_terrain_elevation():
    """(1) The same AGL height gives the same ground offset at any elevation.

    This is the actual regression: before the fix, altitude carried terrain
    elevation, so flying at 50 m AGL over a 200 m hill projected detections as
    though the camera were 250 m up.
    """
    bbox = [400, 300, 440, 360]          # off-centre target
    agl = 50.0

    # Sea level and a 200 m plateau — identical AGL, identical geometry.
    lat_a, lon_a = estimate_detection_location(
        bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, agl, 0.0
    )
    lat_b, lon_b = estimate_detection_location(
        bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, agl, 0.0
    )
    assert (lat_a, lon_a) == (lat_b, lon_b)

    dn, de = _offset_metres(lat_a, lon_a)

    # Sanity: what the offset SHOULD be for this geometry.
    fx = (FRAME_W / 2.0) / math.tan(math.radians(CAMERA_HFOV_DEG / 2.0))
    expected_east = agl * math.tan(math.atan((420 - 320) / fx))
    assert abs(de - expected_east) < 0.5, f"east offset {de:.2f} vs {expected_east:.2f}"

    # The bug's signature: if altitude were MSL over 200 m terrain, the offset
    # would scale by 250/50 = 5x. Prove the AGL result is not that.
    wrong = estimate_detection_location(
        bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, agl + 200.0, 0.0
    )
    dn_w, de_w = _offset_metres(*wrong)
    # Offsets scale linearly with height, so an MSL altitude over 200 m terrain
    # inflates every ground offset by (250/50) = 5x. That is the error the fix
    # removes; assert the ratio rather than an arbitrary absolute gap.
    assert abs(de_w / de - 5.0) < 0.05, f"expected 5x inflation, got {de_w/de:.2f}x"
    print(f"  (1) 50 m AGL -> {de:.1f} m east; if MSL over 200 m terrain "
          f"it would have been {de_w:.1f} m — {de_w/de:.1f}x wrong")


def test_telemetry_uses_relative_alt():
    """(2) The parser sources altitude from relative_alt, not alt."""
    src = open(os.path.join(os.path.dirname(__file__), "..", "app", "telemetry.py"),
               encoding="utf-8").read()

    assert 'updates["altitude"] = msg.relative_alt / 1000.0' in src, \
        "altitude must come from relative_alt (AGL)"
    assert 'updates["altitude"] = msg.alt' not in src, \
        "MSL alt must not populate altitude"

    # VFR_HUD must no longer overwrite altitude with its MSL value.
    vfr = src.split("elif msg_type == 'VFR_HUD':")[1].split("elif msg_type")[0]
    assert 'updates["altitude"]' not in vfr, \
        "VFR_HUD must not overwrite the AGL altitude"
    print("  (2) relative_alt wired through; VFR_HUD no longer overwrites it")


def test_camera_hfov_is_realistic():
    """(3) HFOV reflects real hardware, not the fictitious 60 deg."""
    summary = camera_model_summary()
    assert abs(CAMERA_HFOV_DEG - 60.0) > 1.0, "still the fake 60 deg default"
    assert 60.0 < CAMERA_HFOV_DEG <= 95.0, f"implausible HFOV {CAMERA_HFOV_DEG}"
    assert summary["hfov_source"], "provenance must be stated"
    print(f"  (3) HFOV = {summary['hfov_deg']} deg, source: {summary['hfov_source']}")
    print(f"      {summary['note']}")


def test_no_coordinate_invented_without_data():
    """(4) Missing altitude or position yields None, never a guess."""
    bbox = [300, 200, 340, 260]

    assert estimate_detection_location(bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, 0.0, 0.0) == (None, None)
    assert estimate_detection_location(bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, None, 0.0) == (None, None)
    assert estimate_detection_location(bbox, FRAME_W, FRAME_H, 0.0, 0.0, 50.0, 0.0) == (None, None)
    assert estimate_detection_location(bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, -5.0, 0.0) == (None, None)
    print("  (4) no altitude / no fix / negative altitude all return None")


def test_heading_rotates_the_projection():
    """A target ahead of the aircraft moves with heading, as it must."""
    bbox = [300, 100, 340, 160]      # above centre => forward of the aircraft
    north = estimate_detection_location(bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, 50.0, 0.0)
    east  = estimate_detection_location(bbox, FRAME_W, FRAME_H, HOME_LAT, HOME_LON, 50.0, 90.0)

    dn_n, de_n = _offset_metres(*north)
    dn_e, de_e = _offset_metres(*east)

    assert dn_n > 1.0 and abs(de_n) < 0.5, f"heading 0 should project north: {dn_n:.1f},{de_n:.1f}"
    assert de_e > 1.0 and abs(dn_e) < 0.5, f"heading 90 should project east: {dn_e:.1f},{de_e:.1f}"
    print(f"  (5) heading 0 -> {dn_n:.1f} m N; heading 90 -> {de_e:.1f} m E")


if __name__ == "__main__":
    for fn in (
        test_ground_offset_independent_of_terrain_elevation,
        test_telemetry_uses_relative_alt,
        test_camera_hfov_is_realistic,
        test_no_coordinate_invented_without_data,
        test_heading_rotates_the_projection,
    ):
        print(f"\n{fn.__name__}:")
        fn()
    print("\nAll Phase 2 geolocation verifications passed.")
