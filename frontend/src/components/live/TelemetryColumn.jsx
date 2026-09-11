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
import { useState } from "react";

// ─── Utility ─────────────────────────────────────────────────────────────────

function fmt(val, decimals = 1, unit = "") {
  const n = typeof val === "number" ? val.toFixed(decimals) : "–";
  return unit ? `${n} ${unit}` : n;
}

// ─── AttitudeIndicator ────────────────────────────────────────────────────────
// A minimal artificial-horizon widget rendered in SVG.
// roll  = bank angle in degrees (positive = right wing down)
// pitch = pitch angle in degrees (positive = nose up)

function AttitudeIndicator({ roll = 0, pitch = 0 }) {
  const SIZE = 120;
  const CX   = SIZE / 2;
  const CY   = SIZE / 2;
  const R    = SIZE / 2 - 4;

  // Horizon shifts vertically with pitch: 1° pitch ≈ 1 px at this scale
  const pitchOffset = Math.max(-R, Math.min(R, pitch * 1.2));

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="rounded-full ring-2 ring-slate-200 overflow-hidden"
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
          transform={`rotate(${-roll}, ${CX}, ${CY})`}
        >
          {/* Sky half */}
          <rect
            x={CX - R - 2}
            y={CY - R * 2 - 2 + pitchOffset}
            width={R * 2 + 4}
            height={R * 2 + 4}
            fill="#3b82f6"
          />
          {/* Ground half */}
          <rect
            x={CX - R - 2}
            y={CY + pitchOffset}
            width={R * 2 + 4}
            height={R * 2 + 4}
            fill="#92400e"
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
          const rollRad = ((-roll - 90) * Math.PI) / 180;
          const px = CX + (R - 1) * Math.cos(rollRad);
          const py = CY + (R - 1) * Math.sin(rollRad);
          const a1rad = ((-roll - 93) * Math.PI) / 180;
          const a2rad = ((-roll - 87) * Math.PI) / 180;
          const pr = R - 7;
          return (
            <polygon
              points={`${px},${py} ${CX + pr * Math.cos(a1rad)},${CY + pr * Math.sin(a1rad)} ${CX + pr * Math.cos(a2rad)},${CY + pr * Math.sin(a2rad)}`}
              fill="white"
            />
          );
        })()}

        {/* Outer bezel ring */}
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#475569" strokeWidth="2" />
      </svg>

      {/* Roll / pitch readouts below the widget */}
      <div className="flex gap-3 text-[10px] font-mono text-slate-400 tabular-nums">
        <span>R {roll >= 0 ? "+" : ""}{roll.toFixed(1)}°</span>
        <span>P {pitch >= 0 ? "+" : ""}{pitch.toFixed(1)}°</span>
      </div>
    </div>
  );
}

// ─── Battery bar ──────────────────────────────────────────────────────────────

function BatteryBar({ pct }) {
  const color = pct > 40 ? "#16a34a" : pct > 20 ? "#d97706" : "#dc2626";
  return (
    <div className="flex items-center gap-2 w-full">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
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
      <span className={`stat-value ${highlight ? "text-blue-600" : ""}`}>{value}</span>
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
    cls: "bg-blue-600 hover:bg-blue-700 text-white",
  },
  {
    id: "land",
    label: "Land",
    sub: "Initiate landing",
    cls: "bg-amber-500 hover:bg-amber-600 text-white",
  },
  {
    id: "hold",
    label: "Hold",
    sub: "Position hold",
    cls: "bg-slate-200 hover:bg-slate-300 text-slate-700",
  },
];

function CommandButtons() {
  const [sent, setSent] = useState(null);

  const handleCmd = (id) => {
    // Placeholder — will be wired to POST /api/command in a later step
    setSent(id);
    setTimeout(() => setSent(null), 1500);
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        Commands
      </h3>
      {COMMANDS.map(({ id, label, sub, cls }) => (
        <button
          key={id}
          onClick={() => handleCmd(id)}
          className={`cmd-btn flex flex-col items-center gap-0.5 ${cls} ${
            sent === id ? "opacity-60 scale-95" : ""
          } transition-all`}
        >
          <span>{sent === id ? "Sending…" : label}</span>
          <span className="text-[9px] opacity-70 font-normal normal-case tracking-normal">
            {sub}
          </span>
        </button>
      ))}
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
    // roll/pitch not yet in MAVLink parse; default 0 for now
    roll  = 0,
    pitch = 0,
  } = telemetry;

  return (
    <div className="panel p-3 flex flex-col gap-3 h-full overflow-y-auto">
      {/* Header */}
      <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest shrink-0">
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
        <div className="py-1.5 border-b border-slate-100">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Battery</span>
            <span className="text-[10px] font-mono text-slate-400">
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
      <div className="shrink-0 border-t border-slate-100 pt-3">
        <CommandButtons />
      </div>
    </div>
  );
}
