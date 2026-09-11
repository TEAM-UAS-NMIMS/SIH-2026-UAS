import Icon from "../Icon";
import StatusPill from "../StatusPill";

/**
 * DetectionsPanel — right column of LiveRescueScreen.
 * Props: { detections }
 *
 * Mock data shape (detections):
 *   [{
 *     id: string,
 *     label: string,
 *     confidence: number (0–1),
 *     priority: "high" | "medium" | "low",
 *     lat: number | null,
 *     lon: number | null,
 *     position_source: string | undefined,
 *     uncertainty_m: number | null,
 *   }]
 */

// ─── Priority pill ────────────────────────────────────────────────────────────

function PriorityPill({ priority }) {
  const cls =
    priority === "high"   ? "pill-red"   :
    priority === "medium" ? "pill-amber" :
                            "pill-slate";
  return <span className={cls}>{priority}</span>;
}

// ─── Confidence ring ─────────────────────────────────────────────────────────
// Tiny inline SVG arc showing confidence visually.

function ConfRing({ value }) {
  const SIZE   = 28;
  const STROKE = 3;
  const R      = (SIZE - STROKE) / 2;
  const C      = 2 * Math.PI * R;
  const filled = (C * value) / 100;
  const color  =
    value >= 80 ? "#111111" :
    value >= 50 ? "#8A5A00" :
                  "#B0201A";

  return (
    <div className="relative shrink-0" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#e2e8f0" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2} cy={SIZE / 2} r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeDasharray={`${filled} ${C - filled}`}
          strokeLinecap="butt"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span style={{ fontSize: 7, fontWeight: 700, color, fontFamily: "Inter, sans-serif" }}>
          {Math.round(value)}
        </span>
      </div>
    </div>
  );
}

// ─── Source / uncertainty badge ───────────────────────────────────────────────

function SourceBadge({ source }) {
  if (source === "GNSS")         return <span className="pill-green text-[9px]">GNSS</span>;
  if (source === "VIO_FALLBACK") return <span className="pill-amber text-[9px]">VIO</span>;
  if (!source || source === "NO_POSITION") return <span className="pill-slate text-[9px]">NO POS</span>;
  return <span className="pill-slate text-[9px]">{source.replace(/_/g, " ")}</span>;
}

// ─── Detection card ───────────────────────────────────────────────────────────

/** Criticality band, shown as the card's leading signal. */
const CRITICALITY = {
  high:   { label: "Critical", tone: "critical" },
  medium: { label: "Elevated", tone: "caution"  },
  low:    { label: "Routine",  tone: "nominal"  },
};

function relTime(ts) {
  if (!ts) return null;
  const s = Math.max(0, Date.now() / 1000 - ts);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s ago`;
  return `${(s / 3600).toFixed(1)}h ago`;
}

function DetectionCard({ det }) {
  const conf = parseFloat((det.confidence * 100).toFixed(1));
  const hasPos = det.lat != null && det.lon != null;
  const crit = CRITICALITY[det.priority] ?? CRITICALITY.low;
  const stale = det.active === false;

  // A VIO-derived fix is materially less certain than a GNSS one, and the
  // rescue team needs to know which they are being sent to.
  const src = det.position_source;
  const srcLabel = src === "GNSS" ? "GNSS" : src === "VIO_FALLBACK" ? "VIO" : "NO FIX";
  const srcTone  = src === "GNSS" ? "nominal" : src === "VIO_FALLBACK" ? "caution" : "critical";

  return (
    <div
      className="panel p-3 flex flex-col gap-2"
      style={{
        borderLeft: `3px solid ${
          crit.tone === "critical" ? "var(--critical)"
          : crit.tone === "caution" ? "var(--caution)"
          : "var(--ink)"
        }`,
        opacity: stale ? 0.72 : 1,
      }}
    >
      {/* Criticality leads, then confidence — the two numbers that decide
          whether a team is dispatched. */}
      <div className="flex items-center gap-2">
        <StatusPill tone={crit.tone} label={crit.label} dot />
        <span className="flex-1" />
        <span
          className="text-[15px] font-semibold tabular-nums"
          style={{ fontFamily: '"IBM Plex Mono", monospace' }}
          title="YOLO detection confidence"
        >
          {conf.toFixed(0)}%
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] font-semibold capitalize">
        <Icon name="user" size={13} className="text-[var(--ink-2)]" />
        {det.label}
        {stale && (
          <span className="text-[9px] font-normal uppercase tracking-wider"
                style={{ color: "var(--ink-3)" }}>
            · out of view
          </span>
        )}
      </div>

      {/* Position — the coordinates a rescue team is actually given. */}
      {hasPos ? (
        <div
          className="px-2 py-1.5 rounded-sm"
          style={{ background: "var(--surface-2)", border: "1px solid var(--rule)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[11.5px] font-semibold tabular-nums"
              style={{ fontFamily: '"IBM Plex Mono", monospace' }}
            >
              {det.lat.toFixed(6)}, {det.lon.toFixed(6)}
            </span>
            <StatusPill tone={srcTone} label={srcLabel} />
          </div>
          {det.uncertainty_m != null && (
            <div className="text-[10px] mt-1" style={{ color: "var(--ink-3)" }}>
              ±{det.uncertainty_m.toFixed(1)} m position uncertainty
              {src === "VIO_FALLBACK" && " · GNSS degraded, verify on approach"}
            </div>
          )}
        </div>
      ) : (
        <div className="notice">
          No position estimate — requires GNSS fix and altitude
        </div>
      )}

      {/* Track provenance: how long we have watched this target. */}
      <div className="flex items-center justify-between text-[10px]"
           style={{ color: "var(--ink-3)" }}>
        <span>
          {det.sightings ? `${det.sightings} sighting${det.sightings > 1 ? "s" : ""}` : "—"}
        </span>
        <span>{relTime(det.first_seen) ?? ""}</span>
      </div>
    </div>
  );
}

// ─── DetectionsPanel ─────────────────────────────────────────────────────────

export default function DetectionsPanel({ detections, totalSeen }) {
  const highCount   = detections.filter((d) => d.priority === "high").length;
  const mediumCount = detections.filter((d) => d.priority === "medium").length;

  return (
    <div
      className="panel p-3 flex flex-col gap-3 overflow-hidden h-full"
      style={{ minHeight: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-xs font-bold text-[var(--ink-2)] uppercase tracking-widest">
          Detections
        </h2>
        <div className="flex items-center gap-1.5">
          {highCount > 0 && (
            <span className="pill-red text-[10px]">{highCount} high</span>
          )}
          {mediumCount > 0 && (
            <span className="pill-amber text-[10px]">{mediumCount} med</span>
          )}
          <span className="pill">{detections.length} recent</span>
          {typeof totalSeen === "number" && totalSeen > detections.length && (
            <span
              className="pill-slate text-[10px]"
              title="Distinct casualties tracked so far this mission"
            >
              {totalSeen} total
            </span>
          )}
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex flex-col gap-2.5 overflow-y-auto flex-1 min-h-0 pr-0.5">
        {detections.length === 0 && (
          <div className="flex flex-col items-center gap-2 mt-8 text-center">
            <Icon name="search" size={30} className="text-[var(--ink-3)]" />
            <p className="text-xs text-[var(--ink-3)] italic">
              {totalSeen > 0 ? "No recent detections." : "No detections yet."}
            </p>
            <p className="text-[10px] text-[var(--ink-3)]">
              {totalSeen > 0
                ? `${totalSeen} casualt${totalSeen > 1 ? "ies" : "y"} tracked this mission — see Analysis`
                : "Awaiting YOLO inference stream…"}
            </p>
          </div>
        )}
        {detections.map((det) => (
          <DetectionCard key={det.id} det={det} />
        ))}
      </div>
    </div>
  );
}
