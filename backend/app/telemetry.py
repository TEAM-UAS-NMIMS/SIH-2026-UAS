"""MAVLink connection and telemetry state handler."""

import os
import time
import threading
from pymavlink import mavutil
from app.state import app_state


class MAVLinkTelemetry:
    """Handles MAVLink connection and telemetry ingestion."""

    def __init__(self):
        self.connection_string = os.getenv("MAVLINK_CONNECTION_STRING", "udp:127.0.0.1:14550")
        self.running = False
        self.thread = None
        self.had_fix = False
        # Track whether we had a live connection so we can distinguish
        # first-connect from reconnect in event messages.
        self._was_connected = False

    def start(self) -> None:
        """Start the background thread to read MAVLink messages."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self) -> None:
        """Stop the background thread."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=2.0)

    def _run_loop(self) -> None:
        connection = None
        while self.running:
            if connection is None:
                try:
                    # Trying to connect
                    connection = mavutil.mavlink_connection(self.connection_string)
                    # Wait for a heartbeat to confirm connection
                    connection.wait_heartbeat(timeout=5.0)
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
                    # Connection failed, retry with backoff
                    print(f"MAVLink connection failed: {e}. Retrying in 5s...")
                    connection = None
                    time.sleep(5.0)
                    continue

            try:
                msg = connection.recv_match(blocking=True, timeout=1.0)
                if not msg:
                    continue

                msg_type = msg.get_type()
                if msg_type == 'BAD_DATA':
                    continue

                updates = {"timestamp": time.time()}

                if msg_type == 'GLOBAL_POSITION_INT':
                    updates["lat"] = msg.lat / 1e7
                    updates["lon"] = msg.lon / 1e7
                    updates["altitude"] = msg.alt / 1000.0  # mm to m
                    updates["heading"] = msg.hdg / 100.0   # cdeg to deg
                elif msg_type == 'VFR_HUD':
                    updates["speed"] = msg.groundspeed
                    updates["altitude"] = msg.alt
                    updates["heading"] = msg.heading
                elif msg_type == 'SYS_STATUS':
                    updates["battery_voltage"] = msg.voltage_battery / 1000.0  # mV to V
                    updates["battery_pct"] = max(0, msg.battery_remaining)     # -1 means invalid
                elif msg_type == 'HEARTBEAT':
                    updates["armed"] = bool(msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED)
                    updates["mode"] = mavutil.mode_string_v10(msg)
                elif msg_type == 'GPS_RAW_INT':
                    updates["gps_fix_type"] = msg.fix_type
                    updates["satellites_visible"] = msg.satellites_visible
                    # eph is HDOP * 100 (cm units); convert to standard HDOP float
                    if msg.eph != 65535:  # 65535 = unknown
                        updates["hdop"] = msg.eph / 100.0

                    current_source = app_state.telemetry.get("position_source", "NO_POSITION")

                    if msg.fix_type >= 3:
                        updates["position_source"] = "GNSS"
                        if self.had_fix and current_source != "GNSS":
                            app_state.add_event(time.time(), "GNSS signal reacquired", "info")
                        self.had_fix = True
                    else:
                        if self.had_fix and current_source == "GNSS":
                            updates["position_source"] = "VIO_FALLBACK"
                            app_state.add_event(time.time(), "GNSS signal lost — VIO fallback engaged", "warning")
                        elif not self.had_fix:
                            updates["position_source"] = "NO_POSITION"

                if len(updates) > 1:
                    app_state.update_telemetry(updates)

            except Exception as e:
                # Some error on read — likely a disconnect. Close and retry.
                print(f"MAVLink read error: {e}")
                app_state.add_event(
                    time.time(),
                    "MAVLink connection lost — telemetry paused, retrying…",
                    "warning",
                )
                try:
                    connection.close()
                except Exception:
                    pass
                connection = None
                time.sleep(1.0)


# Global telemetry service instance
telemetry_service = MAVLinkTelemetry()
