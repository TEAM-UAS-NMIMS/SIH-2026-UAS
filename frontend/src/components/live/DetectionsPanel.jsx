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
    value >= 80 ? "#16a34a" :
    value >= 50 ? "#d97706" :
                  "#dc2626";

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

function DetectionCard({ det }) {
  const conf = parseFloat((det.confidence * 100).toFixed(1));
  const hasPos = det.lat != null && det.lon != null;

  return (
    <div className="panel p-3 flex flex-col gap-2 transition-shadow hover:shadow-md">
      {/* Header row: label + confidence ring + priority pill */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-slate-800 capitalize flex-1 truncate">
          👤 {det.label}
        </span>
        <ConfRing value={conf} />
        <PriorityPill priority={det.priority} />
      </div>

      {/* Coordinates */}
      {hasPos ? (
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-500
                        bg-slate-50 rounded px-2 py-1 ring-1 ring-slate-100">
          <span className="text-slate-400 shrink-0">📍</span>
          <span className="tabular-nums">
            {det.lat.toFixed(6)}, {det.lon.toFixed(6)}
          </span>
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 italic flex items-center gap-1">
          <span>📍</span> No position estimate
        </div>
      )}

      {/* Footer: source + uncertainty */}
      <div className="flex items-center justify-between">
        <SourceBadge source={det.position_source} />
        {det.uncertainty_m != null && (
          <span className="text-[10px] text-slate-400 font-mono tabular-nums">
            ±{det.uncertainty_m.toFixed(1)} m
          </span>
        )}
      </div>

      {/* Truncated detection ID */}
      <div className="text-[9px] text-slate-300 font-mono truncate">
        {det.id}
      </div>
    </div>
  );
}

// ─── DetectionsPanel ─────────────────────────────────────────────────────────

export default function DetectionsPanel({ detections }) {
  const highCount   = detections.filter((d) => d.priority === "high").length;
  const mediumCount = detections.filter((d) => d.priority === "medium").length;

  return (
    <div
      className="panel p-3 flex flex-col gap-3 overflow-hidden h-full"
      style={{ minHeight: 0 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Detections
        </h2>
        <div className="flex items-center gap-1.5">
          {highCount > 0 && (
            <span className="pill-red text-[10px]">{highCount} high</span>
          )}
          {mediumCount > 0 && (
            <span className="pill-amber text-[10px]">{mediumCount} med</span>
          )}
          <span className="pill-blue text-[10px]">{detections.length} total</span>
        </div>
      </div>

      {/* Scrollable card list */}
      <div className="flex flex-col gap-2.5 overflow-y-auto flex-1 min-h-0 pr-0.5">
        {detections.length === 0 && (
          <div className="flex flex-col items-center gap-2 mt-8 text-center">
            <span className="text-3xl">🔍</span>
            <p className="text-xs text-slate-400 italic">No detections yet.</p>
            <p className="text-[10px] text-slate-300">
              Awaiting YOLO inference stream…
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
