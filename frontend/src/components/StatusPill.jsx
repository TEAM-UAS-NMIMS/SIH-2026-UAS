/**
 * StatusPill — the single status vocabulary for the whole console.
 *
 * Every state indicator in gridZERO goes through this component: MAVLink link,
 * GCS link, video signal, mission phase, checklist rows, detection priority,
 * demo mode. One shape, one set of tones, so an operator learns the vocabulary
 * once.
 *
 * Tones:
 *   nominal   monochrome — everything is fine, nothing to look at
 *   strong    inverted (black fill) — the one state worth emphasising, e.g.
 *             the active mission phase
 *   caution   amber — degraded but flyable
 *   critical  red — needs action now
 *   absent    muted, dashed — data genuinely unavailable, never faked as zero
 *
 * A nominal console renders monochrome by design, so any colour on screen is
 * by definition worth the operator's attention.
 */

const TONE_CLASS = {
  nominal:  "pill",
  strong:   "pill-strong",
  caution:  "pill-amber",
  critical: "pill-red",
  absent:   "pill",
};

const DOT_CLASS = {
  nominal:  "dot dot-ok",
  strong:   "dot",
  caution:  "dot dot-caution",
  critical: "dot dot-critical",
  absent:   "dot",
};

export default function StatusPill({
  tone = "nominal",
  label,
  dot = false,
  pulse = false,
  title,
  className = "",
  children,
}) {
  const toneCls = TONE_CLASS[tone] ?? TONE_CLASS.nominal;
  const isAbsent = tone === "absent";

  return (
    <span
      className={`${toneCls} ${className}`}
      title={title}
      style={isAbsent ? { borderStyle: "dashed", color: "var(--ink-3)" } : undefined}
    >
      {dot && (
        <span
          className={`${DOT_CLASS[tone] ?? DOT_CLASS.nominal} ${pulse ? "animate-pulse" : ""}`}
          style={tone === "strong" ? { background: "currentColor" } : undefined}
        />
      )}
      {label ?? children}
    </span>
  );
}

/**
 * Label/value readout used along the status bar.
 * The label is quiet, the value carries the weight — so the bar scans as data,
 * not as a row of competing badges.
 */
export function StatusReadout({ label, value, tone = "nominal", title }) {
  const color =
    tone === "critical" ? "var(--critical)"
    : tone === "caution" ? "var(--caution)"
    : tone === "absent" ? "var(--ink-3)"
    : "var(--ink)";

  return (
    <span className="flex items-baseline gap-1.5" title={title}>
      <span
        className="text-[9px] font-medium uppercase tracking-[0.12em]"
        style={{ color: "var(--ink-3)" }}
      >
        {label}
      </span>
      <span
        className="text-[11px] font-semibold tabular-nums"
        style={{ color, fontFamily: '"IBM Plex Mono", ui-monospace, monospace' }}
      >
        {value}
      </span>
    </span>
  );
}
