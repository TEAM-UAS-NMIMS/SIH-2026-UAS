import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import Icon from "./Icon";

// ─── Utility ─────────────────────────────────────────────────────────────────

function useCurrentTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

// ─── Chip sub-components ─────────────────────────────────────────────────────

function PositionChip({ source }) {
  if (source === "GNSS")
    return (
      <span className="pill-green">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        GNSS 3D FIX
      </span>
    );
  if (source === "VIO_FALLBACK")
    return (
      <span className="pill-amber">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
        VIO FALLBACK
      </span>
    );
  return (
    <span className="pill-slate">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
      NO POSITION
    </span>
  );
}

function BatteryChip({ pct }) {
  const cls = pct > 40 ? "pill-green" : pct > 20 ? "pill-amber" : "pill-red";
  return (
    <span className={`${cls} inline-flex items-center gap-1`}>
      <Icon name="battery" size={13} /> {Math.round(pct)}%
    </span>
  );
}

// ─── Nav links ────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { to: "/preflight", label: "Pre-Flight" },
  { to: "/live",      label: "Live Rescue" },
  { to: "/analysis",  label: "Analysis" },
  { to: "/report",    label: "Report" },
];

// ─── StatusBar ────────────────────────────────────────────────────────────────

export default function StatusBar() {
  const { telemetry, wsConnected, telemetryStale, wsRetryIn } = useTelemetry();
  const time = useCurrentTime();
  const phase = telemetry.phase ?? "LIVE_RESCUE";

  return (
    <header className="bg-slate-900 text-white px-5 py-2 flex items-center gap-4 shrink-0 shadow-md">
      {/* Logo */}
      <span className="text-blue-400 font-bold text-lg tracking-tight select-none">
        grid<span className="text-lime-400">ZERO</span>
      </span>

      {/* Mission name */}
      <span className="text-slate-400 text-xs font-mono border-l border-slate-700 pl-4">
        RESCUE_01
      </span>

      {/* Phase badge */}
      <span className="pill bg-blue-600 text-white ring-1 ring-blue-500 text-xs font-bold tracking-widest">
        {phase.replace(/_/g, " ")}
      </span>

      {/* Nav links */}
      <nav className="flex items-center gap-1 border-l border-slate-700 pl-4">
        {NAV_LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `px-3 py-1 rounded text-xs font-semibold transition-colors ${
                isActive
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1" />

      {/* Status chips */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <PositionChip source={telemetry.position_source} />
        <BatteryChip pct={telemetry.battery_pct} />
        <span className="pill-blue">{telemetry.mode}</span>
        {telemetry.armed ? (
          <span className="pill-red">ARMED</span>
        ) : (
          <span className="pill-slate">DISARMED</span>
        )}

        {/* Telemetry staleness — shown when MAVLink updates stop arriving */}
        {telemetryStale && (
          <span className="pill-amber text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            STALE
          </span>
        )}

        {/* WebSocket status: live / reconnecting with countdown / offline */}
        {wsConnected ? (
          <span className="pill-green">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            WS LIVE
          </span>
        ) : wsRetryIn !== null ? (
          <span className="pill-amber text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            RECONNECTING {wsRetryIn}s
          </span>
        ) : (
          <span className="pill-red">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
            WS OFF
          </span>
        )}

        <span className="text-slate-400 text-xs font-mono tabular-nums">
          {time.toLocaleTimeString()}
        </span>
      </div>
    </header>
  );
}
