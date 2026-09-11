"""MAVLink connection, telemetry ingestion, and command dispatch."""

import math
import os
import queue
import time
import threading
from typing import Any, Dict, Optional, Tuple

from pymavlink import mavutil

from app.state import app_state

# MAVLink "value unknown" sentinels. These must be filtered, not clamped:
# battery_remaining == -1 previously became 0, which the pre-flight checklist
# read as a critically flat battery rather than as missing data.
BATTERY_PCT_UNKNOWN = -1
VOLTAGE_UNKNOWN     = 65535
EPH_UNKNOWN         = 65535

# Commands the operator can issue from the Live screen.
# Each entry: (MAV_CMD, params tuple, human label)
COMMAND_SPEC: Dict[str, Tuple[int, Tuple[float, ...], str]] = {
    "rtl": (
        mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH,
        (0, 0, 0, 0, 0, 0, 0),
        "Return to launch",
    ),
    "land": (
        mavutil.mavlink.MAV_CMD_NAV_LAND,
        (0, 0, 0, 0, 0, 0, 0),
        "Land",
    ),
    # Hold = loiter unlimited at the current position.
    "hold": (
        mavutil.mavlink.MAV_CMD_NAV_LOITER_UNLIM,
        (0, 0, 0, 0, 0, 0, 0),
        "Position hold",
    ),
}

COMMAND_ACK_TIMEOUT_S = 5.0

# Human-readable MAV_RESULT values for ack reporting.
_ACK_RESULT = {
    0: "ACCEPTED",
    1: "TEMPORARILY_REJECTED",
    2: "DENIED",
    3: "UNSUPPORTED",
    4: "FAILED",
    5: "IN_PROGRESS",
    6: "CANCELLED",
}


class MAVLinkTelemetry:
    """Handles the MAVLink connection, telemetry ingestion, and commands."""

    def __init__(self):
        self.connection_string = os.getenv("MAVLINK_CONNECTION_STRING", "udp:127.0.0.1:14550")
        self.baud = int(os.getenv("MAVLINK_BAUD", "115200"))

        # Link identity, populated once a heartbeat arrives. Surfaced to the UI
        # so the operator can see WHAT answered, not just that something did.
        self.link_info: Dict[str, Any] = {}

        # Set while the operator has explicitly disconnected, so the read loop
        # does not reconnect behind their back.
        self._suspended = False

        # Signalled by reconnect()/disconnect() so the read loop abandons its
        # retry backoff at once. Without this, clicking Connect could take up
        # to the full retry interval to have any visible effect.
        self._wake = threading.Event()
        self.running = False
        self.thread = None
        self.had_fix = False
        self._was_connected = False

        # The live connection, shared between the read loop and command sends.
        # Guarded by _conn_lock because pymavlink connections are not
        # thread-safe and commands are issued from the HTTP thread.
        self._connection = None
        self._conn_lock = threading.Lock()

        # COMMAND_ACKs are received by the read loop (the only thread that may
        # read the socket) and handed to send_command through this queue.
        # Without it the two would race and the ack would usually be consumed
        # and discarded by the read loop before the sender saw it.
        self._ack_queue: "queue.Queue" = queue.Queue()

        # Mission-protocol traffic (MISSION_REQUEST / MISSION_REQUEST_INT /
        # MISSION_ACK), forwarded by the read loop to whoever is uploading.
        self._mission_queue: "queue.Queue" = queue.Queue()

    # ── Lifecycle ────────────────────────────────────────────────────────

    def start(self) -> None:
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)
        # Release the socket; otherwise the port stays bound after shutdown.
        with self._conn_lock:
            try:
                if self._connection is not None:
                    self._connection.close()
            except Exception:
                pass
            self._connection = None

    def reconnect(self, connection_string: str, baud: int = 115200) -> Dict[str, Any]:
        """Point the ground station at a different link, without a restart.

        Closing the current connection makes the read loop fall through to its
        reconnect path, which picks up the new string. This is what lets an
        operator plug in a Pixhawk and connect from the UI.
        """
        self.connection_string = connection_string
        self.baud = baud
        self._suspended = False
        self.had_fix = False
        self.link_info = {}

        with self._conn_lock:
            try:
                if self._connection is not None:
                    self._connection.close()
            except Exception:
                pass
            self._connection = None

        app_state.add_event(
            time.time(),
            "Flight controller link set to " + connection_string + " @ " + str(baud),
            "info",
            event_type="link_changed",
        )
        self._wake.set()
        return {"ok": True, "connection_string": connection_string, "baud": baud}

    def disconnect(self) -> Dict[str, Any]:
        """Operator-requested disconnect; stays down until told otherwise."""
        self._suspended = True
        self.link_info = {}
        with self._conn_lock:
            try:
                if self._connection is not None:
                    self._connection.close()
            except Exception:
                pass
            self._connection = None
        app_state.add_event(
            time.time(), "Flight controller link disconnected by operator",
            "info", event_type="link_disconnected",
        )
        self._wake.set()
        return {"ok": True, "connected": False}

    def status(self) -> Dict[str, Any]:
        return {
            "connected": self.is_connected,
            "suspended": self._suspended,
            "connection_string": self.connection_string,
            "baud": self.baud,
            "link": dict(self.link_info),
        }

    # -- Mission Planner essentials ---------------------------------------

    def set_mode(self, mode_name: str) -> Dict[str, Any]:
        """Change flight mode by name, e.g. GUIDED / AUTO / RTL / LOITER."""
        with self._conn_lock:
            conn = self._connection
            if conn is None:
                return {"ok": False, "code": "NO_LINK",
                        "detail": "No flight controller connected"}
            try:
                mapping = conn.mode_mapping() or {}
            except Exception:
                mapping = {}

            key = mode_name.upper()
            if key not in mapping:
                return {
                    "ok": False,
                    "code": "UNKNOWN_MODE",
                    "detail": key + " is not a mode this autopilot offers",
                    "available": sorted(mapping.keys()),
                }
            try:
                conn.set_mode(mapping[key])
            except Exception as exc:
                return {"ok": False, "code": "SEND_FAILED", "detail": str(exc)}

        app_state.add_event(time.time(), "Flight mode change requested: " + key,
                            "info", event_type="mode_change")
        return {"ok": True, "code": "SENT",
                "detail": "Mode change to " + key + " sent", "mode": key}

    def arm(self, arm: bool, force: bool = False) -> Dict[str, Any]:
        """Arm or disarm the vehicle, waiting for the autopilot's ack.

        Arming is the most safety-critical command a GCS sends, so the result
        always reflects the autopilot's actual COMMAND_ACK - a refusal (failed
        pre-arm checks, for instance) is reported as a refusal.
        """
        with self._conn_lock:
            conn = self._connection
            if conn is None:
                return {"ok": False, "code": "NO_LINK",
                        "detail": "No flight controller connected"}

            while True:
                try:
                    self._ack_queue.get_nowait()
                except queue.Empty:
                    break

            try:
                conn.mav.command_long_send(
                    conn.target_system, conn.target_component,
                    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0,
                    1 if arm else 0,
                    21196 if force else 0,   # magic force value per MAVLink spec
                    0, 0, 0, 0, 0,
                )
            except Exception as exc:
                return {"ok": False, "code": "SEND_FAILED", "detail": str(exc)}

        verb = "Arm" if arm else "Disarm"
        deadline = time.time() + COMMAND_ACK_TIMEOUT_S
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                ack = self._ack_queue.get(timeout=remaining)
            except queue.Empty:
                break
            if ack.command != mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM:
                continue
            result = _ACK_RESULT.get(ack.result, "RESULT_" + str(ack.result))
            ok = ack.result == 0
            app_state.add_event(
                time.time(),
                verb + (" accepted" if ok else " " + result.lower()),
                "info" if ok else "warning", event_type="arm_ack",
            )
            return {"ok": ok, "code": result, "detail": verb + ": " + result,
                    "armed": arm if ok else None}

        return {
            "ok": False, "code": "NO_ACK",
            "detail": verb + " was sent but not acknowledged - treat as NOT executed",
        }

    def upload_mission(self, waypoints, altitude: float = 45.0) -> Dict[str, Any]:
        """Upload a waypoint mission using the MAVLink mission protocol.

        Sends MISSION_COUNT, answers each MISSION_REQUEST with a
        MISSION_ITEM_INT, and waits for MISSION_ACK. Item 0 is the home
        position, as the protocol expects.
        """
        if not waypoints:
            return {"ok": False, "code": "NO_WAYPOINTS",
                    "detail": "No waypoints to upload"}

        with self._conn_lock:
            conn = self._connection
        if conn is None:
            return {"ok": False, "code": "NO_LINK",
                    "detail": "No flight controller connected"}

        items = [waypoints[0]] + list(waypoints)   # index 0 = home

        # Drop stale mission traffic so we cannot act on a previous attempt.
        while True:
            try:
                self._mission_queue.get_nowait()
            except queue.Empty:
                break

        try:
            conn.mav.mission_count_send(
                conn.target_system, conn.target_component, len(items)
            )
        except Exception as exc:
            return {"ok": False, "code": "SEND_FAILED", "detail": str(exc)}

        deadline = time.time() + 25.0
        sent = 0
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                msg = self._mission_queue.get(timeout=remaining)
            except queue.Empty:
                break

            mtype = msg.get_type()

            if mtype == "MISSION_ACK":
                accepted = msg.type == 0
                app_state.add_event(
                    time.time(),
                    "Mission upload " + ("accepted" if accepted else "rejected")
                    + " (" + str(len(waypoints)) + " waypoints)",
                    "info" if accepted else "warning",
                    event_type="mission_upload",
                )
                return {
                    "ok": accepted,
                    "code": "ACCEPTED" if accepted else "REJECTED_" + str(msg.type),
                    "detail": "Autopilot "
                              + ("accepted " if accepted else "rejected ")
                              + str(len(waypoints)) + " waypoints",
                    "uploaded": sent,
                }

            seq = msg.seq
            if seq >= len(items):
                continue
            lat, lon = items[seq][0], items[seq][1]
            command = (
                mavutil.mavlink.MAV_CMD_NAV_TAKEOFF if seq == 0
                else mavutil.mavlink.MAV_CMD_NAV_WAYPOINT
            )
            try:
                conn.mav.mission_item_int_send(
                    conn.target_system, conn.target_component,
                    seq,
                    mavutil.mavlink.MAV_FRAME_GLOBAL_RELATIVE_ALT,
                    command,
                    1 if seq == 0 else 0,    # current
                    1,                       # autocontinue
                    0, 5, 0, 0,              # hold, accept radius, pass radius, yaw
                    int(lat * 1e7), int(lon * 1e7), float(altitude),
                )
            except Exception as exc:
                return {"ok": False, "code": "SEND_FAILED",
                        "detail": "Failed sending waypoint " + str(seq) + ": " + str(exc)}
            sent += 1

        return {
            "ok": False, "code": "UPLOAD_TIMEOUT",
            "detail": "Uploaded " + str(sent)
                      + " item(s) but the autopilot never sent MISSION_ACK",
            "uploaded": sent,
        }

    @property
    def is_connected(self) -> bool:
        """True when a MAVLink heartbeat has been established."""
        with self._conn_lock:
            return self._connection is not None

    # ── Command dispatch ─────────────────────────────────────────────────

    def send_command(self, command: str) -> Dict[str, Any]:
        """Send a MAV_CMD via COMMAND_LONG and wait for its COMMAND_ACK.

        Returns a dict describing the outcome. Never raises for an operational
        failure — the caller surfaces `ok` / `detail` to the operator, because a
        command that silently appears to succeed is the exact defect this
        replaces.
        """
        spec = COMMAND_SPEC.get(command)
        if spec is None:
            return {"ok": False, "detail": f"Unknown command: {command!r}", "code": "UNKNOWN_COMMAND"}

        cmd_id, params, label = spec

        with self._conn_lock:
            conn = self._connection
            if conn is None:
                return {
                    "ok": False,
                    "code": "NO_LINK",
                    "detail": "No MAVLink connection — command not sent",
                    "command": command,
                    "label": label,
                }

            # Discard any stale acks so we cannot match an older command.
            while True:
                try:
                    self._ack_queue.get_nowait()
                except queue.Empty:
                    break

            try:
                conn.mav.command_long_send(
                    conn.target_system,
                    conn.target_component,
                    cmd_id,
                    0,              # confirmation
                    *params,
                )
            except Exception as exc:
                return {
                    "ok": False,
                    "code": "SEND_FAILED",
                    "detail": f"Failed to send {label}: {exc}",
                    "command": command,
                    "label": label,
                }

        # Wait for the autopilot to acknowledge. The read loop owns the socket
        # and forwards COMMAND_ACKs here, so there is no read race.
        deadline = time.time() + COMMAND_ACK_TIMEOUT_S
        while True:
            remaining = deadline - time.time()
            if remaining <= 0:
                break
            try:
                ack = self._ack_queue.get(timeout=remaining)
            except queue.Empty:
                break
            if ack.command != cmd_id:
                continue        # ack for some other command; keep waiting
            result_name = _ACK_RESULT.get(ack.result, f"RESULT_{ack.result}")
            accepted = ack.result == 0
            app_state.add_event(
                time.time(),
                f"{label} command {'accepted' if accepted else result_name.lower()}",
                "info" if accepted else "warning",
                event_type="command_ack",
            )
            return {
                "ok": accepted,
                "code": result_name,
                "detail": f"{label}: {result_name}",
                "command": command,
                "label": label,
            }

        app_state.add_event(
            time.time(),
            f"{label} command sent but not acknowledged within "
            f"{COMMAND_ACK_TIMEOUT_S:.0f}s",
            "warning",
            event_type="command_no_ack",
        )
        return {
            "ok": False,
            "code": "NO_ACK",
            "detail": (
                f"{label} was sent but the autopilot did not acknowledge it "
                f"within {COMMAND_ACK_TIMEOUT_S:.0f}s — treat as NOT executed"
            ),
            "command": command,
            "label": label,
        }

    # ── Read loop ────────────────────────────────────────────────────────

    def _run_loop(self) -> None:
        while self.running:
            with self._conn_lock:
                connection = self._connection

            if self._suspended:
                self._wake.wait(0.5)
                self._wake.clear()
                continue

            if connection is None:
                try:
                    connection = mavutil.mavlink_connection(
                        self.connection_string, baud=self.baud
                    )
                    hb = connection.wait_heartbeat(timeout=5.0)
                    if hb is None:
                        raise RuntimeError("no heartbeat received")
                    self.link_info = {
                        "system_id": connection.target_system,
                        "component_id": connection.target_component,
                        "autopilot": int(getattr(hb, "autopilot", 0)),
                        "vehicle_type": int(getattr(hb, "type", 0)),
                        "since": time.time(),
                    }
                    with self._conn_lock:
                        self._connection = connection
                    if self._was_connected:
                        app_state.add_event(
                            time.time(),
                            f"MAVLink reconnected on {self.connection_string}",
                            "info",
                        )
                    else:
                        app_state.add_event(
                            time.time(),
                            f"Connected to MAVLink on {self.connection_string}",
                            "info",
                        )
                    self._was_connected = True
                except Exception as e:
                    print(f"MAVLink connection failed: {e}. Retrying in 5s...")
                    with self._conn_lock:
                        self._connection = None
                    # Interruptible: reconnect() sets _wake so a new target is
                    # picked up at once rather than after the full backoff.
                    self._wake.wait(5.0)
                    self._wake.clear()
                    continue

            try:
                with self._conn_lock:
                    conn = self._connection
                if conn is None:
                    continue
                msg = conn.recv_match(blocking=True, timeout=1.0)
                if not msg:
                    continue

                msg_type = msg.get_type()
                if msg_type == "BAD_DATA":
                    continue
                if msg_type == "COMMAND_ACK":
                    # Hand to whichever caller is awaiting this ack.
                    self._ack_queue.put(msg)
                    continue
                if msg_type in ("MISSION_REQUEST", "MISSION_REQUEST_INT", "MISSION_ACK"):
                    # Hand to an in-progress mission upload.
                    self._mission_queue.put(msg)
                    continue

                updates: Dict[str, Any] = {"timestamp": time.time()}

                if msg_type == 'GLOBAL_POSITION_INT':
                    updates["lat"] = msg.lat / 1e7
                    updates["lon"] = msg.lon / 1e7
                    # relative_alt is height above the home point (AGL-ish) and is
                    # what detection geolocation needs. msg.alt is MSL and would
                    # scale every ground offset by the terrain elevation.
                    updates["altitude"] = msg.relative_alt / 1000.0   # mm -> m
                    updates["altitude_msl"] = msg.alt / 1000.0        # kept for display
                    updates["heading"] = msg.hdg / 100.0              # cdeg -> deg
                elif msg_type == 'VFR_HUD':
                    updates["speed"] = msg.groundspeed
                    # Deliberately NOT setting altitude here: VFR_HUD.alt is MSL
                    # and used to overwrite the AGL value above.
                    updates["altitude_msl"] = msg.alt
                    updates["heading"] = msg.heading
                elif msg_type == 'ATTITUDE':
                    # Radians on the wire; the artificial horizon wants degrees.
                    updates["roll"]  = math.degrees(msg.roll)
                    updates["pitch"] = math.degrees(msg.pitch)
                    updates["yaw"]   = math.degrees(msg.yaw) % 360.0
                elif msg_type == 'SYS_STATUS':
                    volts = msg.voltage_battery
                    updates["battery_voltage"] = (
                        None if volts == VOLTAGE_UNKNOWN else volts / 1000.0
                    )
                    pct = msg.battery_remaining
                    updates["battery_pct"] = None if pct == BATTERY_PCT_UNKNOWN else pct
                elif msg_type == 'HEARTBEAT':
                    updates["armed"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    updates["mode"] = mavutil.mode_string_v10(msg)
                elif msg_type == 'GPS_RAW_INT':
                    updates["gps_fix_type"] = msg.fix_type
                    updates["satellites_visible"] = msg.satellites_visible
                    updates["hdop"] = (
                        None if msg.eph == EPH_UNKNOWN else msg.eph / 100.0
                    )

                    current_source = app_state.telemetry.get("position_source", "NO_POSITION")

                    if msg.fix_type >= 3:
                        updates["position_source"] = "GNSS"
                        if self.had_fix and current_source != "GNSS":
                            app_state.add_event(
                                time.time(),
                                "GNSS signal reacquired",
                                "info",
                                event_type="gnss_reacquired",
                            )
                        self.had_fix = True
                    else:
                        if self.had_fix and current_source == "GNSS":
                            updates["position_source"] = "VIO_FALLBACK"
                            app_state.add_event(
                                time.time(),
                                "GNSS signal lost — VIO fallback engaged",
                                "warning",
                                event_type="gnss_lost",
                            )
                        elif not self.had_fix:
                            updates["position_source"] = "NO_POSITION"

                if len(updates) > 1:
                    app_state.update_telemetry(updates)

            except Exception as e:
                print(f"MAVLink read error: {e}")
                app_state.add_event(
                    time.time(),
                    "MAVLink connection lost — telemetry paused, retrying…",
                    "warning",
                    event_type="mavlink_lost",
                )
                with self._conn_lock:
                    try:
                        if self._connection is not None:
                            self._connection.close()
                    except Exception:
                        pass
                    self._connection = None
                time.sleep(1.0)


# Global telemetry service instance
telemetry_service = MAVLinkTelemetry()
