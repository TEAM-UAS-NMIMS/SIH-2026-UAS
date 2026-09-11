/**
 * ReportHeader — top section of ReportScreen.
 *
 * Props:
 *   report  object  — full payload from GET /api/report
 *
 * Tier badge uses a bordered OUTLINE style (ring, no background fill)
 * to keep it neutral and distinct from the solid priority pills used on
 * individual findings.
 *
 * Golden-hour timer: counts down from 72 h after mission end
 * (approximated as report.generated_at when mission_stats.duration_seconds
 * is unavailable).  Turns amber < 48 h remaining, red < 24 h.
 */
import { useState, useEffect } from "react";

// ─── Tier outline badge ────────────────────────────────────────────────────────
// Deliberately neutral — no green/amber/red fill; ring only.

const TIER_RING = {
  URGENT: "ring-red-400 text-red-600",
  HIGH:   "ring-orange-400 text-orange-600",
  MEDIUM: "ring-slate-400 text-[var(--ink-2)]",
  LOW:    "ring-slate-300 text-[var(--ink-3)]",
};

function TierBadge({ tier }) {
  const ringCls = TIER_RING[tier] ?? TIER_RING.LOW;
  return (
    <span
      className={`inline-flex items-center px-3 py-1 rounded-full
                  text-xs font-bold tracking-widest uppercase
                  bg-transparent ring-2 ${ringCls}`}
    >
      {tier}
    </span>
  );
}

// ─── Golden-hour countdown ─────────────────────────────────────────────────────
// 72 h window is standard SAR doctrine for survivability planning.
// The timer is purely informational — it is computed from the report
// generation timestamp, not any real medical assessment.

const GOLDEN_HOURS = 72;
const AMBER_THRESHOLD = 48 * 3600;   // < 48 h → amber
const RED_THRESHOLD   = 24 * 3600;   // < 24 h → red

function pad(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

function fmtCountdown(secs) {
  if (secs <= 0) return "EXPIRED";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function GoldenHourTimer({ generatedAt }) {
  // Parse generated_at ISO string into epoch seconds
  const missionEndTs = generatedAt ? Date.parse(generatedAt) / 1000 : null;
  const windowEnd    = missionEndTs ? missionEndTs + GOLDEN_HOURS * 3600 : null;

  const [remaining, setRemaining] = useState(() =>
    windowEnd ? Math.max(0, Math.round(windowEnd - Date.now() / 1000)) : null
  );

  useEffect(() => {
    if (windowEnd === null) return;
    const id = setInterval(() => {
      setRemaining(Math.max(0, Math.round(windowEnd - Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [windowEnd]);

  if (remaining === null) return null;

  const colorCls =
    remaining < RED_THRESHOLD   ? "text-red-600"   :
    remaining < AMBER_THRESHOLD ? "text-amber-600" :
                                  "text-black";

  const labelCls =
    remaining < RED_THRESHOLD   ? "text-red-400"   :
    remaining < AMBER_THRESHOLD ? "text-amber-400" :
                                  "text-[var(--ink-3)]";

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`text-[10px] font-bold uppercase tracking-widest ${labelCls}`}>
        ⏱ Golden Hour Remaining
      </span>
      <span className={`text-xl font-bold tabular-nums font-mono leading-none ${colorCls}`}>
        {fmtCountdown(remaining)}
      </span>
      <span className="text-[9px] text-[var(--ink-3)] font-medium">
        72 h SAR window · informational only
      </span>
    </div>
  );
}

// ─── Metadata chip ─────────────────────────────────────────────────────────────

function MetaChip({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-wider">
        {label}
      </span>
      <span className="text-xs font-semibold text-black">{value}</span>
    </div>
  );
}

// ─── ReportHeader ─────────────────────────────────────────────────────────────

export default function ReportHeader({ report }) {
  if (!report) return null;

  const { mission, summary_counts = {}, generated_at } = report;

  // Overall tier: highest tier with count > 0
  const TIERS = ["URGENT", "HIGH", "MEDIUM", "LOW"];
  // With no detections there is no tier to report. Falling through to "LOW"
  // would state a finding the mission did not make.
  const overallTier = TIERS.find((t) => (summary_counts[t] ?? 0) > 0) ?? "N/A";

  const totalDetections = Object.values(summary_counts).reduce((a, b) => a + b, 0);
  const genDate = generated_at
    ? new Date(generated_at).toLocaleString()
    : "—";

  return (
    <div className="panel px-5 py-4 flex items-start justify-between gap-6 shrink-0">
      {/* Left: identity */}
      <div className="flex flex-col gap-2">
        {/* Title row */}
        <div className="flex items-center gap-3">
          <TierBadge tier={overallTier} />
          <h1 className="text-lg font-bold text-black leading-none">
            Mission Report — {mission?.name ?? "RESCUE_01"}
          </h1>
        </div>

        {/* Meta chips */}
        <div className="flex items-center gap-4 flex-wrap">
          <MetaChip label="Operator" value={mission?.operator} />
          <MetaChip label="Area"     value={mission?.area} />
          <MetaChip label="Type"     value={mission?.type} />
          <MetaChip label="Generated" value={genDate} />
        </div>

        {/* Summary pill row */}
        <div className="flex items-center gap-2 flex-wrap mt-1">
          {TIERS.map((t) =>
            (summary_counts[t] ?? 0) > 0 ? (
              <span
                key={t}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                            text-[11px] font-bold tracking-wide ring-2 bg-transparent
                            ${TIER_RING[t]}`}
              >
                {summary_counts[t]} {t}
              </span>
            ) : null
          )}
          <span className="text-[11px] text-[var(--ink-3)] font-medium ml-1">
            {totalDetections} detection{totalDetections !== 1 ? "s" : ""} total
          </span>
        </div>
      </div>

      {/* Right: golden-hour timer */}
      <GoldenHourTimer generatedAt={generated_at} />
    </div>
  );
}
