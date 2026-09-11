/**
 * TargetDetailPanel — slide-in right panel shown when a detection marker
 * is clicked on AnalysisMap.
 *
 * Props:
 *   detection  object | null  — the currently selected detection; null = closed
 *   onClose    fn             — called when the user closes the panel
 *   onReview   fn(updatedDet) — called after a successful review action so
 *                               the parent can refresh its detections list
 *
 * Detection shape:
 *   { id, label, confidence, priority, status,
 *     lat, lon, position_source, uncertainty_m,
 *     timestamp, notes }
 *
 * Calls POST /api/detections/{id}/review for confirm / reject / adjust priority.
 */
import { useState } from "react";
import Icon from "../Icon";
import { API_BASE as API } from "../../config";

// API base is environment-driven; see src/config.js

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v, dp = 6) {
  return typeof v === "number" ? v.toFixed(dp) : "—";
}

function fmtTs(ts) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

const PRIORITY_OPTS = ["high", "medium", "low"];

const STATUS_CONFIG = {
  confirmed: { cls: "pill-green", label: "Confirmed" },
  rejected:  { cls: "pill-red",   label: "Rejected"  },
  pending:   { cls: "pill-slate", label: "Pending"   },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return <span className={cfg.cls}>{cfg.label}</span>;
}

function PriorityBadge({ priority }) {
  const cls =
    priority === "high"   ? "pill-red"   :
    priority === "medium" ? "pill-amber" :
                            "pill-green";
  return <span className={`${cls} capitalize`}>{priority}</span>;
}

// ─── Info row ─────────────────────────────────────────────────────────────────

function InfoRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-2 py-2 border-b border-[var(--rule)] last:border-0">
      <span className="text-[11px] font-semibold text-[var(--ink-3)] uppercase tracking-wider shrink-0 mt-0.5">
        {label}
      </span>
      <div className="text-sm font-medium text-black text-right leading-snug">
        {children}
      </div>
    </div>
  );
}

// ─── TargetDetailPanel ────────────────────────────────────────────────────────

export default function TargetDetailPanel({ detection, onClose, onReview }) {
  const [sending,     setSending]     = useState(null);   // "confirm"|"reject"|"priority"
  const [newPriority, setNewPriority] = useState("");
  const [notes,       setNotes]       = useState("");
  const [apiError,    setApiError]    = useState(null);

  if (!detection) return null;

  const det = detection;
  const conf = typeof det.confidence === "number"
    ? `${(det.confidence * 100).toFixed(1)}%`
    : "—";

  async function callReview(action, extra = {}) {
    setSending(action);
    setApiError(null);
    try {
      const res = await fetch(`${API}/api/detections/${encodeURIComponent(det.id)}/review`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notes: notes || null, ...extra }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail ?? `HTTP ${res.status}`);
      }
      const { detection: updated } = await res.json();
      onReview?.(updated);
    } catch (err) {
      setApiError(err.message);
    } finally {
      setSending(null);
    }
  }

  return (
    /* Slide-in overlay: fixed right panel on top of map */
    <div
      className="absolute top-0 right-0 h-full w-80 z-[1000] flex flex-col
                 bg-white border-l border-[var(--rule)] shadow-xl"
      style={{ pointerEvents: "all" }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[var(--rule)] flex items-start justify-between shrink-0">
        <div>
          <h2 className="text-sm font-bold text-black capitalize flex items-center gap-1.5">
            <Icon name="user" size={14} className="text-[var(--ink-2)]" /> {det.label}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <PriorityBadge priority={det.priority} />
            <StatusBadge status={det.status ?? "pending"} />
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[var(--ink-3)] hover:text-[var(--ink-2)] transition-colors leading-none"
          aria-label="Close panel"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-0">
        {/* Metadata rows */}
        <InfoRow label="Confidence">{conf}</InfoRow>
        <InfoRow label="Coordinates">
          <span className="font-mono text-[12px]">
            {fmt(det.lat)}, {fmt(det.lon)}
          </span>
        </InfoRow>
        <InfoRow label="Position Source">
          {det.position_source?.replace(/_/g, " ") ?? "—"}
        </InfoRow>
        <InfoRow label="Uncertainty">
          {det.uncertainty_m != null ? `±${det.uncertainty_m.toFixed(1)} m` : "—"}
        </InfoRow>
        <InfoRow label="Timestamp">{fmtTs(det.timestamp)}</InfoRow>

        {/* RGB snapshot area */}
        <div className="my-3">
          <p className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-widest mb-1.5">
            RGB Snapshot
          </p>
          {/* Frame capture is not implemented in this build; the detection
              pipeline does not yet persist per-detection frames to disk.
              Showing a clearly labelled placeholder. */}
          <div className="w-full rounded-sm bg-[var(--surface-2)] border border-[var(--rule)]
                          flex flex-col items-center justify-center gap-1.5 py-6">
            <Icon name="camera" size={24} className="text-[var(--ink-3)]" />
            <p className="text-[11px] text-[var(--ink-2)] font-medium">
              Frame snapshot not available
            </p>
            <p className="text-[10px] text-[var(--ink-3)] text-center px-4">
              Per-detection frame capture is not implemented in this build.
            </p>
          </div>
        </div>

        {/* Notes textarea */}
        <div className="mb-3">
          <label className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-widest block mb-1">
            Analyst Notes
          </label>
          <textarea
            rows={3}
            value={notes || det.notes || ""}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add annotation…"
            className="w-full rounded-sm border border-[var(--rule)] text-xs text-black
                       px-2.5 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Adjust priority select */}
        <div className="mb-3">
          <label className="text-[10px] font-bold text-[var(--ink-3)] uppercase tracking-widest block mb-1">
            Adjust Priority
          </label>
          <div className="flex items-center gap-2">
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="flex-1 rounded-sm border border-[var(--rule)] text-xs text-black
                         px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              <option value="">— choose —</option>
              {PRIORITY_OPTS.map((p) => (
                <option key={p} value={p} className="capitalize">
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
            <button
              disabled={!newPriority || sending === "adjust_priority"}
              onClick={() => callReview("adjust_priority", { priority: newPriority })}
              className="px-3 py-1.5 rounded-sm text-xs font-bold tracking-wide
                         btn-primary
                         disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {sending === "adjust_priority" ? "…" : "Apply"}
            </button>
          </div>
        </div>

        {/* API error */}
        {apiError && (
          <p className="text-[11px] text-red-500 font-medium mb-2">
            Error: {apiError}
          </p>
        )}
      </div>

      {/* Pinned action buttons */}
      <div className="px-4 pb-4 pt-3 border-t border-[var(--rule)] flex gap-2 shrink-0">
        <button
          disabled={!!sending}
          onClick={() => callReview("confirm")}
          className="flex-1 py-2.5 rounded-sm text-xs font-bold tracking-widest uppercase
                     btn-primary
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {sending !== "confirm" && <Icon name="check" size={13} strokeWidth={2.5} />}
            {sending === "confirm" ? "Confirming…" : "Confirm"}
          </span>
        </button>
        <button
          disabled={!!sending}
          onClick={() => callReview("reject")}
          className="flex-1 py-2.5 rounded-sm text-xs font-bold tracking-widest uppercase
                     bg-red-100 hover:bg-red-200 text-red-700 ring-1 ring-red-200
                     disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          <span className="inline-flex items-center justify-center gap-1.5">
            {sending !== "reject" && <Icon name="x" size={13} strokeWidth={2.5} />}
            {sending === "reject" ? "Rejecting…" : "Reject"}
          </span>
        </button>
      </div>
    </div>
  );
}
