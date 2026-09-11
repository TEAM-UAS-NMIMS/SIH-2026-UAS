import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useTelemetry } from "../context/TelemetryContext";
import StatusPill, { StatusReadout } from "./StatusPill";
import GoldenHourClock from "./GoldenHourClock";
import { api } from "../config";

/**
 * StatusBar — persistent header across every route.
 *
 * Rebuilt as a quiet instrument strip. The previous bar rendered six coloured
 * badges at equal visual weight, so nothing stood out and a genuine fault
 * looked like everything else. Here the bar is monochrome while the aircraft
 * is nominal, and colour appears only for a caution or a fault — which makes
 * an abnormal state the single coloured thing on screen.
 *
 * Left:   identity, mission, phase
 * Centre: navigation
 * Right:  link and aircraft state, then the clock
 */

function useCurrentTime() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return time;
}

const NAV_LINKS = [
  { to: "/preflight", label: "Pre-Flight" },
  { to: "/live",      label: "Live Rescue" },
  { to: "/analysis",  label: "Analysis" },
  { to: "/report",    label: "Report" },
];

/** Position source: only abnormal when we have no fix at all. */
function positionState(source) {
  if (source === "GNSS")          return { value: "GNSS 3D", tone: "nominal" };
  if (source === "VIO_FALLBACK")  return { value: "VIO", tone: "caution" };
  return { value: "NO FIX", tone: "critical" };
}

/** Battery: null means MAVLink reported "unknown" — say so, never show 0%. */
function batteryState(pct) {
  if (pct === null || pct === undefined) return { value: "— —", tone: "absent" };
  const rounded = Math.round(pct);
  if (rounded <= 20) return { value: `${rounded}%`, tone: "critical" };
  if (rounded <= 40) return { value: `${rounded}%`, tone: "caution" };
  return { value: `${rounded}%`, tone: "nominal" };
}

/**
 * DemoControl — starts and stops the simulated mission.
 *
 * This replaces the old static phase badge, which occupied prime space in the
 * header while telling the operator something the nav already implied. A demo
 * needs one obvious way to show the console under a live mission, so that is
 * what sits here instead.
 */
function DemoControl({ demoMode }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(api(demoMode ? "/api/demo/stop" : "/api/demo/start"), {
        method: "POST",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail ?? `HTTP ${res.status}`);
    } catch (err) {
      setError(err.message ?? "Could not reach backend");
      setTimeout(() => setError(null), 6000);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={toggle}
        disabled={busy}
        title={
          demoMode
            ? "Stop the simulated mission"
            : "Run a simulated mission so the console can be shown end-to-end"
        }
        className="btn"
        style={
          demoMode
            ? { background: "var(--critical)", borderColor: "var(--critical)", color: "#fff" }
            : { background: "var(--ink)", borderColor: "var(--ink)", color: "#fff" }
        }
      >
        <span
          aria-hidden="true"
          style={{
            width: 0,
            height: 0,
            ...(demoMode
              ? { width: 8, height: 8, background: "currentColor" }
              : {
                  borderTop: "5px solid transparent",
                  borderBottom: "5px solid transparent",
                  borderLeft: "8px solid currentColor",
                }),
          }}
        />
        {busy ? "Working…" : demoMode ? "Stop Demo" : "Demo"}
      </button>
      {error && (
        <span className="text-[10px]" style={{ color: "var(--critical)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

export default function StatusBar() {
  const { telemetry, wsConnected, telemetryStale, wsRetryIn, demoMode, missionStart } =
    useTelemetry();
  const time = useCurrentTime();
  const phase = (telemetry.phase ?? "PRE_FLIGHT").replace(/_/g, " ");

  const position = positionState(telemetry.position_source);
  const battery  = batteryState(telemetry.battery_pct);
  const mode     = telemetry.mode && telemetry.mode !== "UNKNOWN" ? telemetry.mode : "— —";

  return (
    <>
      {/* The one place where "attention-grabbing" beats "minimal": nobody may
          ever mistake simulated data for a live mission. */}
      {demoMode && (
        <div
          className="shrink-0 flex items-center justify-center gap-3 h-7 text-[11px]
                     font-semibold uppercase tracking-[0.18em]"
          style={{ background: "var(--critical)", color: "#fff" }}
        >
          <span className="dot" style={{ background: "#fff" }} />
          Demo mode — simulated telemetry and detections, not a live aircraft
          <span className="dot" style={{ background: "#fff" }} />
        </div>
      )}

    <header
      className="shrink-0 flex items-center gap-5 px-4 h-12 bg-white"
      style={{ borderBottom: "1px solid var(--rule)" }}
    >
      {/* ── Identity ── */}
      <div className="flex items-baseline gap-3 shrink-0">
        <span className="text-[15px] font-bold tracking-tight select-none">
          grid<span style={{ fontWeight: 400 }}>ZERO</span>
        </span>
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace' }}
        >
          {telemetry.mission_name ?? "RESCUE_01"}
        </span>
      </div>

      {/* ── Demo control replaces the old static phase badge ── */}
      <DemoControl demoMode={demoMode} />

      {/* Phase stays visible, but quietly — the nav already shows where you are. */}
      <span
        className="text-[10px] font-semibold uppercase tracking-[0.14em] shrink-0"
        style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace' }}
      >
        {phase}
      </span>

      {/* ── Navigation: underline, not a coloured chip ── */}
      <nav
        className="flex items-stretch h-full shrink-0"
        style={{ borderLeft: "1px solid var(--rule)", paddingLeft: "1.25rem" }}
      >
        {NAV_LINKS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `relative flex items-center px-3 text-[12px] transition-colors ${
                isActive ? "font-semibold" : "font-normal hover:text-black"
              }`
            }
            style={({ isActive }) => ({
              color: isActive ? "var(--ink)" : "var(--ink-2)",
              boxShadow: isActive ? "inset 0 -2px 0 0 var(--ink)" : "none",
            })}
          >
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="flex-1 min-w-0" />

      {/* ── Aircraft + link state ── */}
      <div className="flex items-center gap-4 shrink-0">
        <GoldenHourClock startedAt={missionStart} />
        <span style={{ borderLeft: "1px solid var(--rule)", height: "1.25rem" }} />
        <StatusReadout label="Pos" value={position.value} tone={position.tone} />
        <StatusReadout label="Batt" value={battery.value} tone={battery.tone}
          title={battery.tone === "absent" ? "Battery level not reported by autopilot" : undefined} />
        <StatusReadout label="Mode" value={mode} tone={mode === "— —" ? "absent" : "nominal"} />

        {/* Armed is a genuine hazard state; disarmed is unremarkable and stays quiet. */}
        {telemetry.armed && <StatusPill tone="critical" label="Armed" dot />}

        {telemetryStale && (
          <StatusPill
            tone="caution"
            label="Stale"
            dot
            pulse
            title="No MAVLink telemetry update for over 3 seconds"
          />
        )}

        {/* Link status: silent when healthy, loud when not. */}
        {wsConnected ? (
          <StatusPill tone="nominal" label="Link" dot title="Backend WebSocket connected" />
        ) : wsRetryIn !== null ? (
          <StatusPill tone="caution" label={`Retry ${wsRetryIn}s`} dot pulse
            title="Backend connection lost — reconnecting" />
        ) : (
          <StatusPill tone="critical" label="No Link" dot
            title="No connection to the gridZERO backend" />
        )}

        <span
          className="text-[11px] tabular-nums pl-1"
          style={{ color: "var(--ink-3)", fontFamily: '"IBM Plex Mono", monospace',
                   borderLeft: "1px solid var(--rule)", paddingLeft: "0.875rem" }}
        >
          {time.toLocaleTimeString("en-GB")}
        </span>
      </div>
    </header>
    </>
  );
}
