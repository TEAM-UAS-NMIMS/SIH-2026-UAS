/**
 * TopActionsList — numbered top-3 recommended actions from the report.
 *
 * Props:
 *   actions  Array<{ rank, tier, detection_id, action, justification }>
 *
 * Rank badges are NEUTRAL slate/blue — no red/amber/green.
 * Priority colours appear only on the "findings" rows in RankedFindingsList.
 */

// ─── Rank badge ────────────────────────────────────────────────────────────────
// Solid neutral slate/blue — intentionally avoids urgency colouring here.

function RankBadge({ rank }) {
  return (
    <span
      className="w-7 h-7 rounded-full bg-slate-700 text-white
                 flex items-center justify-center
                 text-xs font-bold tabular-nums shrink-0"
    >
      {rank}
    </span>
  );
}

// ─── Single action row ─────────────────────────────────────────────────────────

function ActionRow({ item }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-[var(--rule)] last:border-0">
      <RankBadge rank={item.rank} />

      <div className="flex flex-col gap-1 min-w-0">
        {/* Action headline */}
        <p className="text-sm font-semibold text-black leading-snug">
          {item.action}
        </p>

        {/* Justification (smaller, muted) */}
        <p className="text-xs text-[var(--ink-2)] leading-relaxed">
          {item.justification}
        </p>

        {/* Detection ID chip */}
        {item.detection_id && (
          <span className="text-[9px] font-mono text-[var(--ink-3)] mt-0.5">
            det:{item.detection_id.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── TopActionsList ────────────────────────────────────────────────────────────

export default function TopActionsList({ actions = [] }) {
  return (
    <div className="panel flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-[var(--rule)] shrink-0 flex items-center justify-between">
        <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest">
          Recommended Actions
        </h2>
        <span className="pill-slate text-[10px]">
          {actions.length} action{actions.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Action rows */}
      <div className="px-4 overflow-y-auto flex-1">
        {actions.length === 0 ? (
          <p className="text-xs text-[var(--ink-3)] italic py-4">
            No actionable detections — all may be rejected or no data yet.
          </p>
        ) : (
          actions.map((item) => <ActionRow key={item.rank} item={item} />)
        )}
      </div>
    </div>
  );
}
