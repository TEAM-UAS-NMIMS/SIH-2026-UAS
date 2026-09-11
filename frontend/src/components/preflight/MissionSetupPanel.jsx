/**
 * MissionSetupPanel — left column of PreFlightScreen.
 * Displays labeled mission metadata fields sourced from TelemetryContext.mission.
 * Props: { mission } — live from context via PreFlightScreen.
 */

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value, accent }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-slate-100 last:border-0 gap-2">
      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest shrink-0 mt-0.5">
        {label}
      </span>
      <span
        className={`text-sm font-semibold text-right leading-tight ${
          accent ? "text-blue-600" : "text-slate-800"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ label }) {
  return (
    <div className="flex items-center gap-2 pt-3 pb-1">
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-slate-100" />
    </div>
  );
}

// ─── Pattern badge ────────────────────────────────────────────────────────────

const PATTERN_ICON = {
  "Lawnmower": "⟿",
  "Expanding Square": "⊡",
  "Sector": "◔",
  "Contour": "∿",
};

function PatternBadge({ pattern }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-bold ring-1 ring-blue-200">
      <span>{PATTERN_ICON[pattern] || "⟿"}</span>
      {pattern}
    </span>
  );
}

// ─── Priority badge ───────────────────────────────────────────────────────────

function PriorityBadge({ priority }) {
  const cls =
    priority === "Critical"
      ? "pill-red"
      : priority === "High"
      ? "pill-amber"
      : "pill-green";
  return <span className={cls}>{priority}</span>;
}

// ─── MissionSetupPanel ────────────────────────────────────────────────────────

export default function MissionSetupPanel({ mission }) {
  const {
    name,
    type,
    area,
    priority,
    operator,
    estDuration,
    searchPattern,
    maxAltitude,
    overlapPct,
    coordinateSystem,
  } = mission;

  return (
    <div className="panel p-4 flex flex-col gap-0 h-full overflow-y-auto">
      {/* Title */}
      <div className="pb-3 border-b border-slate-100 mb-1">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Mission Setup
        </h2>
        <p className="text-[11px] text-slate-400 mt-0.5">Live from mission state</p>
      </div>

      <SectionHeader label="Identification" />
      <FieldRow label="Mission Name" value={name} accent />
      <FieldRow label="Type" value={type} />
      <FieldRow label="Operator" value={operator} />
      <FieldRow label="Priority" value={<PriorityBadge priority={priority} />} />

      <SectionHeader label="Area & Coverage" />
      <FieldRow label="Search Area" value={area} />
      <FieldRow label="Search Pattern" value={<PatternBadge pattern={searchPattern} />} />
      <FieldRow label="Lane Overlap" value={`${overlapPct}%`} />
      <FieldRow label="Max Altitude" value={`${maxAltitude} m AGL`} />
      <FieldRow label="Coord. System" value={coordinateSystem} />

      <SectionHeader label="Timing" />
      <FieldRow label="Est. Duration" value={estDuration} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Edit button (static placeholder) */}
      <button
        disabled
        className="mt-4 w-full py-2 rounded-md text-xs font-bold tracking-widest uppercase
                   bg-slate-100 text-slate-400 ring-1 ring-slate-200 cursor-not-allowed"
      >
        Edit Mission Parameters
      </button>
    </div>
  );
}
