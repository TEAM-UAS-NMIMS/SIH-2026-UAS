/**
 * TelemetryColumn — left column of LiveRescueScreen.
 * Props: { telemetry } — mock shape for this step, will be wired to
 * TelemetryContext in the next step.
 *
 * Contains:
 *  - AttitudeIndicator: SVG artificial-horizon widget (roll/pitch visualised)
 *  - Stat rows: altitude, speed, heading, battery %, voltage, mode,
 *               satellites, position source, lat, lon
 *  - Pinned command buttons: RTL / LAND / HOLD (styled placeholders)
 */
import { useState, useEffect, useRef } from "react";
import { api } from "../../config";

// ─── Utility ─────────────────────────────────────────────────────────────────

// Absent values render as an em-dash, never as 0 — the console must not imply
// a reading it has not received.
function fmt(val, decimals = 1, unit = "") {
  if (typeof val !== "number" || !Number.isFinite(val)) return "——";
  const n = val.toFixed(decimals);
  return unit ? `${n} ${unit}` : n;
}

// ─── AttitudeIndicator ────────────────────────────────────────────────────────
// A minimal artificial-horizon widget rendered in SVG.
// roll  = bank angle in degrees (positive = right wing down)
// pitch = pitch angle in degrees (positive = nose up)

function AttitudeIndicator({ roll, pitch }) {
  const SIZE = 120;
  const CX   = SIZE / 2;
  const CY   = SIZE / 2;
  const R    = SIZE / 2 - 4;

  // The ATTITUDE message may not have been received yet. Drawing a level
  // horizon in that case would be a confident lie about the aircraft's
  // attitude, so we draw the instrument inert and label it instead.
  const hasData = Number.isFinite(roll) && Number.isFinite(pitch);
  const r = hasData ? roll : 0;
  const p = hasData ? pitch : 0;

  // Horizon shifts vertically with pitch: 1° pitch ≈ 1 px at this scale
  const pitchOffset = Math.max(-R, Math.min(R, p * 1.2));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="rounded-full ring-2 ring-[var(--rule-strong)] overflow-hidden"
        style={{ background: "#1e293b" }}
      >
        {/* Clipping circle */}
        <defs>
          <clipPath id="ai-clip">
            <circle cx={CX} cy={CY} r={R} />
          </clipPath>
        </defs>

        {/* Rotating group: sky + ground + horizon */}
        <g
          clipPath="url(#ai-clip)"
          transform={`rotate(${-r}, ${CX}, ${CY})`}
        >
          {/* Sky half */}
          <rect
            x={CX - R - 2}
            y={CY - R * 2 - 2 + pitchOffset}
            width={R * 2 + 4}
            height={R * 2 + 4}
            fill="#E8E8E8"
          />
          {/* Ground half */}
          <rect
            x={CX - R - 2}
            y={CY + pitchOffset}
            width={R * 2 + 4}
            height={R * 2 + 4}
            fill="#4A4A4A"
          />
          {/* Horizon line */}
          <line
            x1={CX - R - 2}
            y1={CY + pitchOffset}
            x2={CX + R + 2}
            y2={CY + pitchOffset}
            stroke="white"
            strokeWidth="1.5"
          />
          {/* Pitch ladder marks — every 5° */}
          {[-10, -5, 5, 10].map((deg) => {
            const y = CY + pitchOffset - deg * 1.2;
            const w = deg % 10 === 0 ? 20 : 12;
            return (
              <line
                key={deg}
                x1={CX - w}
                y1={y}
                x2={CX + w}
                y2={y}
                stroke="white"
                strokeWidth="0.8"
                opacity="0.7"
              />
            );
          })}
        </g>

        {/* Static aircraft reference — does NOT rotate */}
        <g>
          {/* Centre dot */}
          <circle cx={CX} cy={CY} r={2.5} fill="white" />
          {/* Left wing */}
          <line x1={CX - 20} y1={CY} x2={CX - 8} y2={CY} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
          {/* Right wing */}
          <line x1={CX + 8}  y1={CY} x2={CX + 20} y2={CY} stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        </g>

        {/* Roll scale arc ticks at ±15, ±30, ±60 */}
        {[-60, -30, -15, 15, 30, 60].map((angle) => {
          const rad   = ((angle - 90) * Math.PI) / 180;
          const inner = R - 6;
          const outer = R - 1;
          return (
            <line
              key={angle}
              x1={CX + inner * Math.cos(rad)}
              y1={CY + inner * Math.sin(rad)}
              x2={CX + outer * Math.cos(rad)}
              y2={CY + outer * Math.sin(rad)}
              stroke="white"
              strokeWidth={Math.abs(angle) === 30 ? 1.5 : 1}
              opacity="0.6"
            />
          );
        })}

        {/* Roll pointer triangle */}
        {(() => {
          const rollRad = ((-r - 90) * Math.PI) / 180;
          const px = CX + (R - 1) * Math.cos(rollRad);
          const py = CY + (R - 1) * Math.sin(rollRad);
          const a1rad = ((-r - 93) * Math.PI) / 180;
          const a2rad = ((-r - 87) * Math.PI) / 180;
          const pr = R - 7;
          return (
            <polygon
              points={`${px},${py} ${CX + pr * Math.cos(a1rad)},${CY + pr * Math.sin(a1rad)} ${CX + pr * Math.cos(a2rad)},${CY + pr * Math.sin(a2rad)}`}
              fill="white"
            />
          );
        })()}

        {/* Outer bezel ring */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#CFCFCF" strokeWidth="2" />

        {/* No-data overlay: the instrument must not read as a level aircraft */}
        {!hasData && (
          <>
            <circle cx={CX} cy={CY} r={R} fill="rgba(255,255,255,.86)" />
            <text
              x={CX}
              y={CY - 3}
              textAnchor="middle"
              fill="#5A5A5A"
              fontSize="9"
              fontFamily="ui-monospace, monospace"
              letterSpacing="0.5"
            >
              NO ATTITUDE
            </text>
            <text
              x={CX}
              y={CY + 9}
              textAnchor="middle"
              fill="#8C8C8C"
              fontSize="7.5"
              fontFamily="ui-monospace, monospace"
            >
              ATTITUDE msg absent
            </text>
          </>
        )}
      </svg>

      {/* Roll / pitch readouts below the widget */}
      <div className="flex gap-3 text-[10px] font-mono text-[var(--ink-3)] tabular-nums">
        <span>R {hasData ? `${r >= 0 ? "+" : ""}${r.toFixed(1)}°` : "––"}</span>
        <span>P {hasData ? `${p >= 0 ? "+" : ""}${p.toFixed(1)}°` : "––"}</span>
      </div>
    </div>
  );
}

// ─── Battery bar ──────────────────────────────────────────────────────────────

function BatteryBar({ pct }) {
  const hasData = typeof pct === "number" && Number.isFinite(pct);
  if (!hasData) {
    return (
      <div className="flex items-center gap-2 w-full">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden"
             style={{ background: "var(--surface-2)", border: "1px dashed var(--rule-strong)" }} />
        <span className="text-[11px] font-mono" style={{ color: "var(--ink-3)" }}
              title="Battery level not reported by the autopilot">
          ——
        </span>
      </div>
    );
  }
  const color = pct > 40 ? "#111111" : pct > 20 ? "#8A5A00" : "#B0201A";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-2)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>
        {Math.round(pct)}%
      </span>
    </div>
  );
}

// ─── Stat row ─────────────────────────────────────────────────────────────────

function StatRow({ label, value, highlight }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${highlight ? "text-black" : ""}`}>{value}</span>
    </div>
  );
}

// ─── Mode badge ───────────────────────────────────────────────────────────────

function ModeBadge({ mode }) {
  const danger = ["STABILIZE", "ACRO", "ALT_HOLD"].includes(mode);
  const cls = mode === "AUTO" || mode === "GUIDED"
    ? "pill-green"
    : danger
    ? "pill-amber"
    : "pill-slate";
  return <span className={cls}>{mode}</span>;
}

// ─── Position source badge ────────────────────────────────────────────────────

function PosBadge({ source }) {
  if (source === "GNSS")        return <span className="pill-green">GNSS</span>;
  if (source === "VIO_FALLBACK") return <span className="pill-amber">VIO</span>;
  return <span className="pill-slate">NO POS</span>;
}

// ─── Command buttons ──────────────────────────────────────────────────────────

const COMMANDS = [
  {
    id: "rtl",
    label: "RTL",
    sub: "Return to Launch",
    cls: "cmd-btn",
  },
  {
    id: "land",
    label: "Land",
    sub: "Initiate landing",
    cls: "cmd-btn cmd-btn-critical",
  },
  {
    id: "hold",
    label: "Hold",
    sub: "Position hold",
    cls: "cmd-btn",
  },
];

function CommandButtons() {
  // Real command dispatch. Previously this set local state and animated
  // "Sending…" without sending anything — an operator could believe they had
  // commanded a return-to-launch. Every state below reflects an actual
  // backend/MAVLink outcome.
  const [pending, setPending] = useState(null);   // command id in flight
  const [result, setResult]   = useState(null);   // {id, ok, detail}
  const [link, setLink]       = useState({ checked: false, available: false, reason: null });
  const clearRef = useRef(null);

  // Is there a flight controller to command at all?
  useEffect(() => {
    let alive = true;
    async function probe() {
      try {
        const res = await fetch(api("/api/command/availability"));
        const j = await res.json();
        if (alive) setLink({ checked: true, available: !!j.available, reason: j.reason });
      } catch {
        if (alive) {
          setLink({
            checked: true,
            available: false,
            reason: "Backend unreachable",
          });
        }
      }
    }
    probe();
    const t = setInterval(probe, 5000);
    return () => { alive = false; clearInterval(t); clearTimeout(clearRef.current); };
  }, []);

  const disabled = !link.available;

  async function handleCmd(id) {
    if (disabled || pending) return;
    setPending(id);
    setResult(null);
    clearTimeout(clearRef.current);
    try {
      const res = await fetch(api("/api/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult({ id, ok: false, detail: j.detail ?? `Backend returned HTTP ${res.status}` });
      } else {
        setResult({ id, ok: !!j.ok, detail: j.detail ?? (j.ok ? "Accepted" : "Rejected") });
      }
    } catch (err) {
      setResult({ id, ok: false, detail: err.message ?? "Network error — command not sent" });
    } finally {
      setPending(null);
      clearRef.current = setTimeout(() => setResult(null), 8000);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-widest">
          Commands
        </h3>
        {link.checked && !link.available && (
          <span className="text-[9px] text-[var(--ink-3)] font-mono">no link</span>
        )}
      </div>

      {/* Why the controls are dead, stated plainly rather than implied. */}
      {link.checked && !link.available && (
        <p className="notice-caution">
          Not wired — {link.reason ?? "no flight controller connected"}.
          Commands are disabled.
        </p>
      )}

      {COMMANDS.map(({ id, label, sub, cls }) => {
        const isPending = pending === id;
        const res = result?.id === id ? result : null;
        return (
          <button
            key={id}
            onClick={() => handleCmd(id)}
            disabled={disabled || !!pending}
            title={disabled ? (link.reason ?? "No flight controller connected") : sub}
            className={`${disabled ? "cmd-btn" : cls} flex flex-col items-center gap-0.5 ${
              isPending ? "opacity-60" : ""
            }`}
          >
            <span>{isPending ? "Sending…" : label}</span>
            <span className="text-[9px] opacity-70 font-normal normal-case tracking-normal">
              {isPending ? "awaiting ack" : sub}
            </span>
            {res && (
              <span
                className={`text-[9px] font-bold normal-case tracking-normal ${
                  res.ok ? "text-white" : "text-red-100"
                }`}
              >
                {res.ok ? "ACK" : "FAILED"}
              </span>
            )}
          </button>
        );
      })}

      {/* Full outcome text, including a non-acknowledged command. */}
      {result && (
        <p
          className={result.ok ? "notice" : "notice-critical"}
        >
          {result.detail}
        </p>
      )}
    </div>
  );
}

// ─── TelemetryColumn ─────────────────────────────────────────────────────────

export default function TelemetryColumn({ telemetry }) {
  const {
    altitude,
    speed,
    heading,
    battery_pct,
    battery_voltage,
    mode,
    satellites_visible,
    position_source,
    lat,
    lon,
    // Real values from the ATTITUDE MAVLink message. null means the message
    // has not been received — the indicator shows "no data" rather than a
    // convincing level horizon.
    roll,
    pitch,
  } = telemetry;

  return (
    <div className="panel p-3 flex flex-col gap-3 h-full overflow-y-auto">
      {/* Header */}
      <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest shrink-0">
        Telemetry
      </h2>

      {/* Attitude indicator */}
      <div className="flex justify-center shrink-0">
        <AttitudeIndicator roll={roll} pitch={pitch} />
      </div>

      {/* Stat rows */}
      <div className="shrink-0">
        <StatRow label="Altitude"   value={fmt(altitude, 1, "m")} />
        <StatRow label="Speed"      value={fmt(speed, 1, "m/s")} />
        <StatRow label="Heading"    value={fmt(heading, 0, "°")} />
        <div className="py-1.5 border-b border-[var(--rule)]">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Battery</span>
            <span className="text-[10px] font-mono text-[var(--ink-3)]">
              {fmt(battery_voltage, 1, "V")}
            </span>
          </div>
          <BatteryBar pct={battery_pct} />
        </div>
        <div className="stat-row">
          <span className="stat-label">Mode</span>
          <ModeBadge mode={mode} />
        </div>
        <StatRow label="Satellites" value={`${satellites_visible} vis`} />
        <div className="stat-row">
          <span className="stat-label">Position</span>
          <PosBadge source={position_source} />
        </div>
        <StatRow label="Lat" value={fmt(lat, 6)} highlight />
        <StatRow label="Lon" value={fmt(lon, 6)} highlight />
      </div>

      {/* Spacer pushes commands to bottom */}
      <div className="flex-1" />

      {/* Pinned command buttons */}
      <div className="shrink-0 border-t border-[var(--rule)] pt-3">
        <CommandButtons />
      </div>
    </div>
  );
}
