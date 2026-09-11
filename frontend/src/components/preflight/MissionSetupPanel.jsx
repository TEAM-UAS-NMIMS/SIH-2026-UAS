/**
 * MissionSetupPanel — left column of PreFlightScreen.
 * Displays labeled mission metadata fields sourced from TelemetryContext.mission.
 * Props: { mission } — live from context via PreFlightScreen.
 */

// ─── Field row ────────────────────────────────────────────────────────────────

function FieldRow({ label, value, accent }) {
  return (
    <div className="stat-row items-start gap-3 py-2.5">
      {/* The label may shrink; the value must never be clipped, so it keeps a
          minimum track and wraps instead. */}
      <span className="stat-label mt-0.5 min-w-0">
        {label}
      </span>
      <span
        className={`text-[13px] font-semibold text-right leading-tight min-w-0 ${
          accent ? "text-black" : ""
        }`}
        style={{ color: accent ? undefined : "var(--ink)" }}
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
      <span className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-[var(--surface-2)]" />
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
    <span className="pill">
      <span aria-hidden="true">{PATTERN_ICON[pattern] || "⟿"}</span>
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
      <div className="pb-3 border-b border-[var(--rule)] mb-1">
        <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest">
          Mission Setup
        </h2>
        <p className="text-[11px] text-[var(--ink-3)] mt-0.5">Live from mission state</p>
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
        className="mt-4 w-full py-2 rounded-sm text-xs font-bold tracking-widest uppercase
                   bg-[var(--surface-2)] text-[var(--ink-3)] ring-1 ring-[var(--rule-strong)] cursor-not-allowed"
      >
        Edit Mission Parameters
      </button>
    </div>
  );
}
