"""Flight controller link management — connect a real Pixhawk at runtime.

Why this exists
---------------
The MAVLink connection string was fixed at process start from an env var, so
plugging a Pixhawk in meant editing a variable and restarting the backend. That
is unusable in the field and impossible to demonstrate: you cannot restart a
ground station while an operator is standing at the aircraft.

This module lets the operator discover serial ports, pick a baud rate, connect,
disconnect and reconnect from the UI — the same workflow Mission Planner offers.

Supported link types
--------------------
  serial : a Pixhawk over USB or a telemetry radio, e.g. COM7 @ 115200
           (SiK radios are typically 57600; USB is typically 115200)
  udp    : SITL or a companion computer forwarding MAVLink, e.g. udp:0.0.0.0:14550
  tcp    : e.g. tcp:127.0.0.1:5760 (SITL default)

Everything here returns structured results rather than raising, because the UI
must be able to tell the operator exactly why a link failed — "port busy",
"no heartbeat", "access denied" are all different problems with different fixes.
"""

import glob
import os
import sys
import time
from typing import Any, Dict, List, Optional

from pymavlink import mavutil


# Baud rates worth offering. 115200 is the usual USB rate for a Pixhawk;
# 57600 is the usual SiK telemetry radio rate.
COMMON_BAUD_RATES = [115200, 57600, 921600, 500000, 230400, 38400, 19200, 9600]

DEFAULT_BAUD = 115200

# Autopilot vendor/product hints, used only to rank likely candidates in the
# port list. Never used to exclude a port — an unrecognised adapter may still
# be the right one.
AUTOPILOT_HINTS = (
    "px4", "pixhawk", "ardupilot", "cube", "fmu", "mavlink",
    "cp210", "ftdi", "ch340", "silicon labs", "3d robotics", "holybro",
)


def list_serial_ports() -> List[Dict[str, Any]]:
    """Enumerate serial ports, most-likely-autopilot first.

    Uses pyserial when available (it exposes VID/PID and a description, which
    is what makes "COM7 — Pixhawk FMU" possible). Falls back to globbing device
    nodes on POSIX so the endpoint still works without pyserial installed.
    """
    ports: List[Dict[str, Any]] = []

    try:
        from serial.tools import list_ports as _lp

        for p in _lp.comports():
            blob = " ".join(
                str(x) for x in (p.description, p.manufacturer, p.product) if x
            ).lower()
            likely = any(h in blob for h in AUTOPILOT_HINTS)
            ports.append({
                "device":       p.device,
                "description":  p.description or p.device,
                "manufacturer": p.manufacturer,
                "vid":          p.vid,
                "pid":          p.pid,
                "serial_number": p.serial_number,
                "likely_autopilot": likely,
            })
    except Exception:
        # pyserial missing or unusable — best-effort device enumeration.
        patterns = (
            ["COM%d" % i for i in range(1, 33)] if sys.platform.startswith("win")
            else ["/dev/ttyACM*", "/dev/ttyUSB*", "/dev/tty.usb*", "/dev/serial/by-id/*"]
        )
        for pat in patterns:
            for dev in (glob.glob(pat) if "*" in pat else [pat]):
                if "*" in pat or os.path.exists(dev):
                    ports.append({
                        "device": dev,
                        "description": dev,
                        "manufacturer": None,
                        "vid": None, "pid": None, "serial_number": None,
                        "likely_autopilot": False,
                    })

    ports.sort(key=lambda d: (not d["likely_autopilot"], d["device"]))
    return ports


def build_connection_string(
    link_type: str,
    device: Optional[str] = None,
    host: Optional[str] = None,
    port: Optional[int] = None,
) -> str:
    """Turn UI parameters into a pymavlink connection string."""
    if link_type == "serial":
        if not device:
            raise ValueError("A serial device is required (e.g. COM7)")
        return device
    if link_type == "udp":
        return f"udp:{host or '0.0.0.0'}:{port or 14550}"
    if link_type == "tcp":
        return f"tcp:{host or '127.0.0.1'}:{port or 5760}"
    raise ValueError(f"Unknown link type: {link_type!r}")


def describe_failure(exc: Exception, conn_str: str) -> Dict[str, str]:
    """Translate a connection exception into something an operator can act on."""
    text = str(exc)
    low = text.lower()

    if "permission" in low or "access is denied" in low:
        return {
            "code": "PORT_BUSY",
            "detail": (
                f"{conn_str} is in use or access was denied. Close Mission "
                "Planner / QGroundControl or any serial monitor holding the port."
            ),
        }
    if "could not open" in low or "no such file" in low or "filenotfound" in low:
        return {
            "code": "PORT_MISSING",
            "detail": f"{conn_str} does not exist. Re-scan ports and check the USB cable.",
        }
    if "no module named 'serial'" in low:
        return {
            "code": "PYSERIAL_MISSING",
            "detail": (
                "pyserial is not installed, so serial links are unavailable. "
                "Install it with: pip install pyserial"
            ),
        }
    return {"code": "CONNECT_FAILED", "detail": f"Could not open {conn_str}: {text}"}


def probe_link(conn_str: str, baud: int = DEFAULT_BAUD, timeout: float = 6.0) -> Dict[str, Any]:
    """Open a link, wait for a heartbeat, report what answered, then close.

    Used by the UI's "Test" action so an operator can confirm a port before
    committing the ground station to it.
    """
    conn = None
    try:
        conn = mavutil.mavlink_connection(conn_str, baud=baud)
    except Exception as exc:
        return {"ok": False, **describe_failure(exc, conn_str)}

    try:
        hb = conn.wait_heartbeat(timeout=timeout)
        if hb is None:
            return {
                "ok": False,
                "code": "NO_HEARTBEAT",
                "detail": (
                    f"Opened {conn_str} but no MAVLink heartbeat arrived within "
                    f"{timeout:.0f}s. Check the baud rate (USB is usually 115200, "
                    "a SiK radio 57600) and that the autopilot is powered."
                ),
            }
        return {
            "ok": True,
            "code": "HEARTBEAT",
            "detail": f"Heartbeat received on {conn_str}",
            "system_id": conn.target_system,
            "component_id": conn.target_component,
            "autopilot": int(getattr(hb, "autopilot", 0)),
            "vehicle_type": int(getattr(hb, "type", 0)),
        }
    except Exception as exc:
        return {"ok": False, **describe_failure(exc, conn_str)}
    finally:
        try:
            if conn is not None:
                conn.close()
        except Exception:
            pass
