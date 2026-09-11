/**
 * ExportPanel — report export buttons.
 *
 * Props:
 *   report  object  — full GET /api/report payload
 *
 * What actually works today:
 *   CSV     — real download, built from report.ranked_detections
 *
 * Honest stubs (show a toast, never fake a file):
 *   PDF     — coming soon
 *   GeoJSON — coming soon
 *   KML     — coming soon
 *
 * The toast label explicitly says "not available in this build" so the user
 * is never misled into thinking an export occurred.
 */
import { useState } from "react";

const API = "http://localhost:8000";

// ─── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, type }) {
  if (!message) return null;
  const color =
    type === "success" ? "bg-green-50 text-green-700 ring-green-200" :
    type === "stub"    ? "bg-slate-50  text-slate-600  ring-slate-200" :
                        "bg-red-50   text-red-700   ring-red-200";
  return (
    <div
      className={`mt-3 px-3 py-2 rounded-md ring-1 text-xs font-medium
                  leading-snug transition-all ${color}`}
    >
      {message}
    </div>
  );
}

// ─── CSV builder (real) ────────────────────────────────────────────────────────

function buildCsv(findings) {
  const headers = [
    "rank", "tier", "label", "confidence_pct", "priority", "status",
    "lat", "lon", "hazard_distance_m", "age_seconds",
    "position_source", "uncertainty_m", "score", "justification",
  ];
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v);
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const rows = findings.map((f) => [
    f.rank,
    f.tier,
    f.label,
    f.confidence != null ? (f.confidence * 100).toFixed(2) : "",
    f.priority,
    f.status ?? "pending",
    f.lat ?? "",
    f.lon ?? "",
    f.hazard_distance_m ?? "",
    f.age_seconds ?? "",
    f.position_source ?? "",
    f.uncertainty_m ?? "",
    f.score ?? "",
    f.justification ?? "",
  ].map(escape).join(","));
  return [headers.join(","), ...rows].join("\r\n");
}

function downloadText(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Export button ─────────────────────────────────────────────────────────────

function ExportButton({ label, icon, onClick, loading, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className={`flex items-center gap-2 w-full px-3.5 py-2.5 rounded-lg
                  text-xs font-bold tracking-wide uppercase text-left
                  border transition-all duration-150
                  ${loading || disabled
                    ? "border-slate-200 bg-slate-50 text-slate-300 cursor-not-allowed"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                  }`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className="flex-1">{loading ? "Exporting…" : label}</span>
    </button>
  );
}

// ─── ExportPanel ───────────────────────────────────────────────────────────────

export default function ExportPanel({ report }) {
  const [toast, setToast] = useState({ message: null, type: null });

  function showToast(message, type = "success") {
    setToast({ message, type });
    setTimeout(() => setToast({ message: null, type: null }), 4000);
  }

  // ── CSV (real) ──────────────────────────────────────────────────────────────
  function handleCsv() {
    const findings = report?.ranked_detections ?? [];
    if (findings.length === 0) {
      showToast("No detections to export.", "error");
      return;
    }
    const csv      = buildCsv(findings);
    const ts       = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const mission  = report?.mission?.name ?? "mission";
    downloadText(csv, `gridZERO_${mission}_${ts}.csv`, "text/csv;charset=utf-8;");
    showToast(
      `CSV exported — ${findings.length} finding${findings.length !== 1 ? "s" : ""}.`,
      "success"
    );
  }

  // ── Stubs (honest) ──────────────────────────────────────────────────────────
  function handleStub(format) {
    showToast(
      `${format} export is not available in this build — planned for a future release. No file was downloaded.`,
      "stub"
    );
  }

  const noReport = !report;

  return (
    <div className="panel flex flex-col overflow-hidden shrink-0">
      {/* Header */}
      <div className="px-4 pt-3 pb-2.5 border-b border-slate-100">
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest">
          Export
        </h2>
      </div>

      {/* Buttons */}
      <div className="px-4 py-3 flex flex-col gap-2">
        <ExportButton
          label="Download CSV"
          icon="📊"
          onClick={handleCsv}
          disabled={noReport}
        />
        <ExportButton
          label="PDF Report"
          icon="📄"
          onClick={() => handleStub("PDF")}
          disabled={noReport}
        />
        <ExportButton
          label="GeoJSON"
          icon="🌍"
          onClick={() => handleStub("GeoJSON")}
          disabled={noReport}
        />
        <ExportButton
          label="KML"
          icon="🗺"
          onClick={() => handleStub("KML")}
          disabled={noReport}
        />

        {/* Honest disclaimer for stubs */}
        <p className="text-[9px] text-slate-300 font-medium mt-1 leading-snug">
          CSV is fully functional today. PDF, GeoJSON, and KML are not yet
          implemented — clicking them shows an honest notice, no file is created.
        </p>

        {/* Toast feedback */}
        <Toast message={toast.message} type={toast.type} />
      </div>
    </div>
  );
}
