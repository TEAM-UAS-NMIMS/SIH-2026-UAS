/**
 * RankedFindingsList — full ranked detection table.
 *
 * Props:
 *   findings  Array<ranked_detection>  — from report.ranked_detections
 *
 * Priority pills HERE use the full red/amber/green palette — these are
 * the findings' own priority tags, not the action rank badges.
 *
 * Columns: Rank · Tier · Label · Confidence · Priority · Status ·
 *           Coordinates · Hazard Dist · Age · Justification (expandable)
 */
import { useState } from "react";

// ─── Tier outline badge (outline only, same as ReportHeader) ──────────────────

const TIER_RING = {
  URGENT: "ring-red-400 text-red-600",
  HIGH:   "ring-orange-400 text-orange-600",
  MEDIUM: "ring-slate-400 text-slate-600",
  LOW:    "ring-slate-300 text-slate-400",
};

function TierBadge({ tier }) {
  const cls = TIER_RING[tier] ?? TIER_RING.LOW;
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold
                  tracking-widest uppercase bg-transparent ring-2 ${cls}`}
    >
      {tier}
    </span>
  );
}

// ─── Priority pill (solid fill — allowed here on the finding itself) ───────────

function PriorityPill({ priority }) {
  const cls =
    priority === "high"   ? "pill-red"   :
    priority === "medium" ? "pill-amber" :
                            "pill-green";
  return (
    <span className={`${cls} text-[10px] capitalize`}>{priority}</span>
  );
}

// ─── Status pill ───────────────────────────────────────────────────────────────

function StatusPill({ status }) {
  if (status === "confirmed") return <span className="pill-green text-[10px]">Confirmed</span>;
  if (status === "rejected")  return <span className="pill-red   text-[10px]">Rejected</span>;
  return <span className="pill-slate text-[10px]">Pending</span>;
}

// ─── Score bar (visual representation of the ranking score 0–1) ───────────────

function ScoreBar({ score }) {
  const pct  = Math.round((score ?? 0) * 100);
  const color =
    pct >= 75 ? "bg-red-400"    :
    pct >= 55 ? "bg-orange-400" :
    pct >= 35 ? "bg-slate-400"  :
                "bg-slate-200";
  return (
    <div className="flex items-center gap-1.5 min-w-[70px]">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-bold text-slate-500 tabular-nums w-7 text-right">
        {pct}
      </span>
    </div>
  );
}

// ─── FindingRow ────────────────────────────────────────────────────────────────

function FindingRow({ item }) {
  const [open, setOpen] = useState(false);
  const conf = typeof item.confidence === "number"
    ? `${(item.confidence * 100).toFixed(1)}%`
    : "—";
  const lat = item.lat != null ? item.lat.toFixed(5) : "—";
  const lon = item.lon != null ? item.lon.toFixed(5) : "—";
  const dist = item.hazard_distance_m != null
    ? `${item.hazard_distance_m.toFixed(0)} m`
    : "—";
  const age = item.age_seconds != null
    ? item.age_seconds >= 60
      ? `${(item.age_seconds / 60).toFixed(1)} min`
      : `${item.age_seconds.toFixed(0)} s`
    : "—";

  const isRejected = item.status === "rejected";

  return (
    <>
      <tr
        className={`border-b border-slate-100 hover:bg-slate-50 transition-colors
                    ${isRejected ? "opacity-45" : ""}`}
      >
        {/* Rank */}
        <td className="px-3 py-2.5 text-center">
          <span className="text-xs font-bold text-slate-400 tabular-nums">
            #{item.rank}
          </span>
        </td>

        {/* Tier */}
        <td className="px-2 py-2.5">
          <TierBadge tier={item.tier} />
        </td>

        {/* Label */}
        <td className="px-2 py-2.5">
          <span className="text-xs font-semibold text-slate-700 capitalize">
            {item.label}
          </span>
        </td>

        {/* Score bar */}
        <td className="px-2 py-2.5">
          <ScoreBar score={item.score} />
        </td>

        {/* Confidence */}
        <td className="px-2 py-2.5 text-center">
          <span className="text-xs font-bold text-slate-700 tabular-nums">{conf}</span>
        </td>

        {/* Priority */}
        <td className="px-2 py-2.5">
          <PriorityPill priority={item.priority} />
        </td>

        {/* Status */}
        <td className="px-2 py-2.5">
          <StatusPill status={item.status} />
        </td>

        {/* Coordinates */}
        <td className="px-2 py-2.5">
          <span className="text-[10px] font-mono text-slate-500">
            {lat}, {lon}
          </span>
        </td>

        {/* Hazard dist */}
        <td className="px-2 py-2.5 text-center">
          <span className="text-[11px] text-slate-500 tabular-nums">{dist}</span>
        </td>

        {/* Age */}
        <td className="px-2 py-2.5 text-center">
          <span className="text-[11px] text-slate-500 tabular-nums">{age}</span>
        </td>

        {/* Expand justification */}
        <td className="px-3 py-2.5 text-center">
          <button
            onClick={() => setOpen((o) => !o)}
            className="text-[10px] text-slate-400 hover:text-blue-600
                       font-bold uppercase tracking-wide transition-colors"
          >
            {open ? "▲" : "▼"}
          </button>
        </td>
      </tr>

      {/* Expanded justification row */}
      {open && (
        <tr className="bg-slate-50 border-b border-slate-100">
          <td colSpan={11} className="px-5 py-2.5">
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-slate-700 leading-relaxed">
                <span className="font-bold text-slate-500">Justification: </span>
                {item.justification}
              </p>
              {/* Score component breakdown */}
              {item.score_components && (
                <div className="flex items-center gap-4 text-[10px] font-mono text-slate-400">
                  <span>
                    conf: {(item.score_components.confidence_score * 100).toFixed(1)}% × 0.50
                  </span>
                  <span>
                    proximity: {(item.score_components.proximity_score * 100).toFixed(1)}% × 0.30
                  </span>
                  <span>
                    age: {(item.score_components.age_score * 100).toFixed(1)}% × 0.20
                  </span>
                  <span className="font-bold text-slate-600">
                    → {(item.score * 100).toFixed(1)} / 100
                  </span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── RankedFindingsList ────────────────────────────────────────────────────────

const COLUMNS = [
  { label: "#",          width: "w-8"  },
  { label: "Tier",       width: "w-20" },
  { label: "Label",      width: "w-16" },
  { label: "Score",      width: "w-24" },
  { label: "Conf",       width: "w-14" },
  { label: "Priority",   width: "w-18" },
  { label: "Status",     width: "w-20" },
  { label: "Coordinates",width: "w-36" },
  { label: "Hazard",     width: "w-16" },
  { label: "Age",        width: "w-16" },
  { label: "",           width: "w-8"  },
];

export default function RankedFindingsList({ findings = [] }) {
  return (
    <div className="panel flex flex-col overflow-hidden flex-1 min-h-0">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-slate-100 shrink-0 flex items-center justify-between">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Ranked Findings
        </h2>
        <span className="pill-slate text-[10px]">
          {findings.length} finding{findings.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      {findings.length === 0 ? (
        <p className="text-xs text-slate-400 italic px-4 py-6">
          No detections available.
        </p>
      ) : (
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 bg-slate-50 z-10">
              <tr>
                {COLUMNS.map((col, i) => (
                  <th
                    key={i}
                    className={`px-2 py-2 text-[10px] font-bold text-slate-400
                                uppercase tracking-widest border-b border-slate-100
                                ${col.width}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {findings.map((item) => (
                <FindingRow key={item.id ?? item.rank} item={item} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
