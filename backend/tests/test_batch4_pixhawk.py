"""Batch 4 verification — the real Pixhawk path works.

No flight controller is attached in this environment, so the production code is
exercised against a mock autopilot speaking genuine MAVLink over UDP: it sends
heartbeats, answers COMMAND_LONG with COMMAND_ACK, exposes a mode mapping, and
runs the mission-upload protocol (MISSION_COUNT -> MISSION_REQUEST ->
MISSION_ITEM_INT -> MISSION_ACK).

Nothing on the gridZERO side is stubbed. When a real Pixhawk is plugged in, the
only thing that changes is the connection string.

Covers:
  1. runtime connect/disconnect without restarting the backend
  2. arm accepted, and arm REFUSED reported as a refusal
  3. flight mode change
  4. waypoint mission upload, end to end
  5. serial port discovery returns a usable shape

Run:  python tests/test_batch4_pixhawk.py
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pymavlink import mavutil          # noqa: E402

from app import link                    # noqa: E402

_next_port = [14700]


def _alloc_port():
    _next_port[0] += 1
    return _next_port[0]


class MockAutopilot:
    """Heartbeats, command acks, and the mission upload protocol."""

    def __init__(self, port, ack_result=0):
        self.ack_result = ack_result
        self.commands = []
        self.mission_items = []
        self.mission_expected = 0
        self._running = False
        self._thread = None
        self.conn = mavutil.mavlink_connection(
            f"udpout:127.0.0.1:{port}", source_system=1, source_component=1
        )

    def start(self):
        self._running = True
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self):
        self._running = False
        if self._thread:
            self._thread.join(timeout=2.0)
        try:
            self.conn.close()
        except Exception:
            pass

    def _loop(self):
        last_hb = 0.0
        while self._running:
            # Windows returns ICMP port-unreachable as ConnectionResetError when
            # we heartbeat at a port nothing is bound to yet. That is expected
            # while the GCS is still connecting, so the mock must survive it.
            try:
                self._tick(last_hb)
            except (ConnectionResetError, OSError):
                pass
            except Exception:
                pass
            if time.time() - last_hb > 0.2:
                last_hb = time.time()
            time.sleep(0.01)

    def _tick(self, last_hb):
            now = time.time()
            if now - last_hb > 0.2:
                self.conn.mav.heartbeat_send(
                    mavutil.mavlink.MAV_TYPE_QUADROTOR,
                    mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
                    mavutil.mavlink.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
                    4,                                    # custom mode = GUIDED
                    mavutil.mavlink.MAV_STATE_STANDBY,
                )

            msg = self.conn.recv_match(blocking=False)
            if msg is None:
                return

            t = msg.get_type()
            if t == "COMMAND_LONG":
                self.commands.append(msg.command)
                self.conn.mav.command_ack_send(msg.command, self.ack_result)
            elif t == "MISSION_COUNT":
                # Request every item in turn, as a real autopilot does.
                self.mission_expected = msg.count
                self.mission_items = []
                self.conn.mav.mission_request_int_send(
                    msg.target_system, msg.target_component, 0
                )
            elif t in ("MISSION_ITEM_INT", "MISSION_ITEM"):
                self.mission_items.append(msg)
                nxt = len(self.mission_items)
                if nxt < self.mission_expected:
                    self.conn.mav.mission_request_int_send(1, 1, nxt)
                else:
                    self.conn.mav.mission_ack_send(1, 1, 0)   # MAV_MISSION_ACCEPTED
            return


def connected_service(ack_result=0):
    from app.telemetry import MAVLinkTelemetry

    port = _alloc_port()
    pilot = MockAutopilot(port, ack_result=ack_result)
    pilot.start()

    svc = MAVLinkTelemetry()
    svc.connection_string = f"udp:127.0.0.1:{port}"
    svc.start()
    for _ in range(80):
        if svc.is_connected:
            break
        time.sleep(0.1)
    assert svc.is_connected, "mock autopilot link never came up"
    return svc, pilot


def test_runtime_connect_and_disconnect():
    """(1) The operator can connect and drop the link with no restart."""
    from app.telemetry import MAVLinkTelemetry

    port = _alloc_port()
    pilot = MockAutopilot(port)
    pilot.start()

    svc = MAVLinkTelemetry()
    svc.connection_string = "udp:127.0.0.1:1"     # deliberately dead
    svc.start()
    time.sleep(0.6)
    assert not svc.is_connected

    try:
        # Repoint at the live mock — this is what the UI's Connect button does.
        svc.reconnect(f"udp:127.0.0.1:{port}", baud=115200)
        for _ in range(80):
            if svc.is_connected:
                break
            time.sleep(0.1)
        assert svc.is_connected, "reconnect() did not establish the link"

        st = svc.status()
        assert st["connected"] and st["link"]["system_id"] == 1, st
        print(f"  (1) connected at runtime: sys_id={st['link']['system_id']} "
              f"autopilot={st['link']['autopilot']}")

        svc.disconnect()
        time.sleep(0.4)
        assert not svc.is_connected and svc.status()["suspended"]
        print("  (1) disconnect held (does not silently reconnect)")
    finally:
        svc.stop()
        pilot.stop()


def test_arm_accepted_and_refused():
    """(2) Arming reports the autopilot's real answer, both ways."""
    svc, pilot = connected_service(ack_result=0)
    try:
        res = svc.arm(True)
        assert res["ok"] and res["code"] == "ACCEPTED", res
        assert mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM in pilot.commands
        print(f"  (2) arm accepted: {res['detail']}")
    finally:
        svc.stop(); pilot.stop()

    # An autopilot that refuses (e.g. pre-arm checks failed) must not read OK.
    svc, pilot = connected_service(ack_result=4)       # MAV_RESULT_FAILED
    try:
        res = svc.arm(True)
        assert res["ok"] is False and res["code"] == "FAILED", res
        print(f"  (2) arm refusal surfaced: {res['detail']}")
    finally:
        svc.stop(); pilot.stop()


def test_mode_change():
    """(3) Flight mode changes go out by name."""
    svc, pilot = connected_service()
    try:
        res = svc.set_mode("GUIDED")
        assert res["ok"], res
        print(f"  (3) mode change: {res['detail']}")

        bad = svc.set_mode("HYPERSPACE")
        assert bad["ok"] is False and bad["code"] == "UNKNOWN_MODE", bad
        print(f"  (3) unknown mode rejected, offered {len(bad['available'])} real modes")
    finally:
        svc.stop(); pilot.stop()


def test_mission_upload():
    """(4) A planned route uploads through the mission protocol."""
    svc, pilot = connected_service()
    try:
        wps = [
            [21.34980, 74.87760],
            [21.35060, 74.88180],
            [21.34760, 74.88320],
            [21.34600, 74.87960],
        ]
        res = svc.upload_mission(wps, altitude=45.0)
        assert res["ok"], res
        # 4 waypoints + the home item at index 0
        assert len(pilot.mission_items) == len(wps) + 1, (
            f"autopilot received {len(pilot.mission_items)} items"
        )
        first = pilot.mission_items[1]
        assert abs(first.x / 1e7 - wps[0][0]) < 1e-5, "waypoint latitude mangled"
        assert abs(first.z - 45.0) < 0.01, "altitude not carried"
        print(f"  (4) uploaded {len(wps)} waypoints (+home): {res['detail']}")
        print(f"      first waypoint round-tripped as "
              f"{first.x / 1e7:.5f},{first.y / 1e7:.5f} @ {first.z:.0f} m")
    finally:
        svc.stop(); pilot.stop()


def test_port_discovery_shape():
    """(5) Port discovery returns a usable list (may be empty with no hardware)."""
    ports = link.list_serial_ports()
    assert isinstance(ports, list)
    for p in ports:
        assert {"device", "description", "likely_autopilot"} <= set(p)
    assert 115200 in link.COMMON_BAUD_RATES
    print(f"  (5) port discovery OK — {len(ports)} port(s) present on this machine")

    # A dead port must fail with an actionable message, not a stack trace.
    probe = link.probe_link("udp:127.0.0.1:2", timeout=1.0)
    assert probe["ok"] is False and probe["code"] in ("NO_HEARTBEAT", "CONNECT_FAILED"), probe
    print(f"  (5) dead link reported as {probe['code']}")


if __name__ == "__main__":
    for fn in (
        test_runtime_connect_and_disconnect,
        test_arm_accepted_and_refused,
        test_mode_change,
        test_mission_upload,
        test_port_discovery_shape,
    ):
        print(f"\n{fn.__name__}:")
        fn()
    print("\nAll Batch 4 (Pixhawk) verifications passed.")
