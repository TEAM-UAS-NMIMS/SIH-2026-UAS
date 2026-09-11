import StatusPill from "../StatusPill";
import Icon from "../Icon";

/**
 * DetectionsReviewPanel — every casualty tracked this mission, as a table.
 *
 * A table rather than cards: post-mission the operator is comparing targets
 * against each other (which is most urgent, which lacks a good fix, which is
 * still unreviewed), and comparison wants aligned columns. Clicking a row opens
 * the full detail panel where the review actions live.
 */

const CRITICALITY = {
  high:   { label: "Critical", tone: "critical" },
  medium: { label: "Elevated", tone: "caution" },
  low:    { label: "Routine",  tone: "nominal" },
};

const STATUS_TONE = {
  confirmed: "nominal",
  rejected:  "absent",
  pending:   "caution",
};

function rel(ts) {
  if (!ts) return "—";
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

export default function DetectionsReviewPanel({ detections, onSelect, selectedId }) {
  if (!detections.length) {
    return (
      <p className="notice">
        No casualties detected yet. Detections accumulate for the whole mission —
        fly a sortie with the camera started, or press Demo in the header.
      </p>
    );
  }

  // Most urgent first: criticality, then confidence.
  const order = { high: 0, medium: 1, low: 2 };
  const rows = [...detections].sort(
    (a, b) => (order[a.priority] ?? 3) - (order[b.priority] ?? 3)
              || b.confidence - a.confidence,
  );

  const unreviewed = rows.filter((d) => !d.status || d.status === "pending").length;

  return (
    <div className="flex flex-col gap-2">
      {unreviewed > 0 && (
        <p className="notice">
          {unreviewed} of {rows.length} targets are unreviewed. Click a row to
          confirm, reject, adjust criticality or add notes — decisions persist
          and appear in the mission report.
        </p>
      )}

      <div className="overflow-x-auto" style={{ border: "1px solid var(--rule)" }}>
        <table className="w-full text-[11.5px]" style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              {["", "Criticality", "Conf.", "Position", "Fix", "Sightings", "First seen", "Review"]
                .map((h) => (
                  <th key={h}
                      className="text-left px-2 py-1.5 text-[9.5px] uppercase tracking-[0.1em] font-semibold whitespace-nowrap"
                      style={{ color: "var(--ink-2)", borderBottom: "1px solid var(--rule)" }}>
                    {h}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => {
              const crit = CRITICALITY[d.priority] ?? CRITICALITY.low;
              const status = d.status ?? "pending";
              const rejected = status === "rejected";
              return (
                <tr
                  key={d.id}
                  onClick={() => onSelect(d)}
                  className="cursor-pointer"
                  style={{
                    borderBottom: "1px solid var(--rule)",
                    background: d.id === selectedId ? "var(--surface-2)" : "#fff",
                    opacity: rejected ? 0.55 : 1,
                  }}
                >
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "var(--ink-3)" }}>
                    {i + 1}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusPill tone={crit.tone} label={crit.label} dot />
                  </td>
                  <td className="px-2 py-1.5 font-semibold tabular-nums"
                      style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {(d.confidence * 100).toFixed(0)}%
                  </td>
                  <td className="px-2 py-1.5 tabular-nums whitespace-nowrap"
                      style={{ fontFamily: '"IBM Plex Mono", monospace' }}>
                    {d.lat != null
                      ? `${d.lat.toFixed(6)}, ${d.lon.toFixed(6)}`
                      : <span style={{ color: "var(--ink-3)" }}>no fix</span>}
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    {d.position_source === "GNSS"
                      ? <StatusPill tone="nominal" label="GNSS" />
                      : d.position_source === "VIO_FALLBACK"
                        ? <StatusPill tone="caution" label={`VIO ±${d.uncertainty_m ?? "?"}m`} />
                        : <StatusPill tone="critical" label="No fix" />}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "var(--ink-2)" }}>
                    {d.sightings ?? "—"}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums" style={{ color: "var(--ink-2)" }}>
                    {rel(d.first_seen)} ago
                  </td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <StatusPill tone={STATUS_TONE[status] ?? "caution"} label={status} />
                    {d.notes && (
                      <Icon name="file-text" size={11} className="ml-1"
                            style={{ color: "var(--ink-3)" }} title={d.notes} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
