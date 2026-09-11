"""Phase 2 verification — RTL / LAND / HOLD actually reach the aircraft.

The audit's LR11 finding: the command buttons set local React state, animated
"Sending…", and sent nothing. No POST /api/command existed.

No flight controller or SITL is available in this environment, so this exercises
the real command path against a **mock autopilot** speaking genuine MAVLink over
UDP: it sends heartbeats, receives COMMAND_LONG, and replies with COMMAND_ACK.
The code under test is the production send_command() — nothing is stubbed on the
gridZERO side.

Covers:
  1. RTL / LAND / HOLD are delivered as the correct MAV_CMD ids
  2. an ACCEPTED ack is reported as success
  3. a DENIED ack is reported as a failure, not a success
  4. a silent autopilot yields NO_ACK ("treat as NOT executed"), never success
  5. with no link at all the command is refused, not faked

Run:  python tests/test_phase2_command.py
"""

import os
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pymavlink import mavutil          # noqa: E402


_next_port = [14577]


def _alloc_port():
    """A fresh UDP port per scenario, so one test's socket cannot serve another."""
    _next_port[0] += 1
    return _next_port[0]


class MockAutopilot:
    """A minimal MAVLink autopilot: heartbeats + COMMAND_ACK replies."""

    def __init__(self, port, ack_result=0, answer=True):
        self.ack_result = ack_result
        self.answer = answer
        self.received = []
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
            now = time.time()
            if now - last_hb > 0.25:
                self.conn.mav.heartbeat_send(
                    mavutil.mavlink.MAV_TYPE_QUADROTOR,
                    mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA,
                    mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED,
                    0,
                    mavutil.mavlink.MAV_STATE_ACTIVE,
                )
                last_hb = now

            msg = self.conn.recv_match(type="COMMAND_LONG", blocking=False)
            if msg is not None:
                self.received.append(msg.command)
                if self.answer:
                    self.conn.mav.command_ack_send(msg.command, self.ack_result)
            time.sleep(0.02)


def fresh_service(ack_result=0, answer=True):
    """A MAVLinkTelemetry wired to a fresh mock autopilot on its own port."""
    from app.telemetry import MAVLinkTelemetry

    port = _alloc_port()
    conn_str = f"udp:127.0.0.1:{port}"

    pilot = MockAutopilot(port, ack_result=ack_result, answer=answer)
    pilot.start()

    svc = MAVLinkTelemetry()
    svc.connection_string = conn_str
    svc.start()

    for _ in range(80):                      # up to ~8 s for heartbeat
        if svc.is_connected:
            break
        time.sleep(0.1)
    assert svc.is_connected, "mock autopilot link never established"
    return svc, pilot


def test_commands_are_delivered_and_accepted():
    """(1)+(2) Each command reaches the autopilot and an ACCEPTED ack succeeds."""
    svc, pilot = fresh_service(ack_result=0)
    try:
        expected = {
            "rtl":  mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
            "land": mavutil.mavlink.MAV_CMD_NAV_LAND,
            "hold": mavutil.mavlink.MAV_CMD_NAV_LOITER_UNLIM,
        }
        for name, cmd_id in expected.items():
            res = svc.send_command(name)
            assert res["ok"] is True, f"{name} not accepted: {res}"
            assert res["code"] == "ACCEPTED", res
            assert cmd_id in pilot.received, f"{name} never reached the autopilot"
            print(f"  {name:<5} -> MAV_CMD {cmd_id} delivered, ack {res['code']}")
        print("  (1)+(2) all three commands delivered and accepted")
    finally:
        svc.stop()
        pilot.stop()


def test_denied_ack_is_a_failure():
    """(3) A rejecting autopilot must not read as success."""
    svc, pilot = fresh_service(ack_result=2)       # MAV_RESULT_DENIED
    try:
        res = svc.send_command("rtl")
        assert res["ok"] is False, f"DENIED reported as success: {res}"
        assert res["code"] == "DENIED", res
        print(f"  (3) DENIED surfaced as failure: {res['detail']}")
    finally:
        svc.stop()
        pilot.stop()


def test_silent_autopilot_is_not_success():
    """(4) No ack => NO_ACK, explicitly 'treat as NOT executed'."""
    svc, pilot = fresh_service(answer=False)
    try:
        t0 = time.time()
        res = svc.send_command("land")
        elapsed = time.time() - t0
        assert res["ok"] is False, f"unacknowledged command reported success: {res}"
        assert res["code"] == "NO_ACK", res
        assert "NOT executed" in res["detail"], res["detail"]
        print(f"  (4) silent autopilot -> NO_ACK after {elapsed:.1f}s: {res['detail']}")
    finally:
        svc.stop()
        pilot.stop()


def test_no_link_refuses_rather_than_fakes():
    """(5) With no autopilot at all the command is refused."""
    from app.telemetry import MAVLinkTelemetry

    svc = MAVLinkTelemetry()
    svc.connection_string = "udp:127.0.0.1:14599"   # nothing listening
    res = svc.send_command("rtl")
    assert res["ok"] is False and res["code"] == "NO_LINK", res
    print(f"  (5) no link -> refused: {res['detail']}")


def test_unknown_command_rejected():
    from app.telemetry import MAVLinkTelemetry
    res = MAVLinkTelemetry().send_command("self_destruct")
    assert res["ok"] is False and res["code"] == "UNKNOWN_COMMAND", res
    print("  (6) unknown command rejected")


if __name__ == "__main__":
    for fn in (
        test_commands_are_delivered_and_accepted,
        test_denied_ack_is_a_failure,
        test_silent_autopilot_is_not_success,
        test_no_link_refuses_rather_than_fakes,
        test_unknown_command_rejected,
    ):
        print(f"\n{fn.__name__}:")
        fn()
    print("\nAll Phase 2 command verifications passed.")
