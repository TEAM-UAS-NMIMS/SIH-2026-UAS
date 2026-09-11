/**
 * ReportScreen — rendered at /report.
 *
 * Layout (all data from GET /api/report):
 *
 *   ┌───────────────────────────────────────────────────────┐
 *   │ ReportHeader  (tier badge · mission meta · timer)     │
 *   ├─────────────────────────────────┬─────────────────────┤
 *   │ TopActionsList (top-3 actions)  │ ExportPanel         │
 *   ├─────────────────────────────────┴─────────────────────┤
 *   │ RankedFindingsList  (full table, flex-1, scrollable)  │
 *   └───────────────────────────────────────────────────────┘
 *
 * Data is fetched once on mount; a manual Refresh button re-fetches.
 * Does NOT touch PreFlightScreen, LiveRescueScreen, or AnalysisScreen.
 */
import { useState, useEffect } from "react";
import ReportHeader      from "../components/report/ReportHeader";
import TopActionsList    from "../components/report/TopActionsList";
import RankedFindingsList from "../components/report/RankedFindingsList";
import ExportPanel       from "../components/report/ExportPanel";
import Icon             from "../components/Icon";

const API = "http://localhost:8000";

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="h-full flex flex-col gap-3 p-3 animate-pulse">
      <div className="panel h-20 shrink-0 bg-slate-50" />
      <div className="flex gap-3 flex-1 min-h-0">
        <div className="flex-1 panel bg-slate-50" />
        <div className="w-56 panel bg-slate-50" />
      </div>
      <div className="flex-1 panel bg-slate-50 min-h-0" />
    </div>
  );
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="panel p-8 flex flex-col items-center gap-4 text-center max-w-sm">
        <Icon name="alert-triangle" size={30} className="text-amber-500" />
        <div>
          <p className="text-sm font-bold text-slate-700 mb-1">
            Failed to load report
          </p>
          <p className="text-xs text-slate-400">{message}</p>
        </div>
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-slate-800 text-white text-xs
                     font-bold uppercase tracking-widest hover:bg-slate-700
                     transition-colors"
        >
          Retry
        </button>
        <p className="text-[10px] text-slate-300 leading-snug">
          Make sure the backend is running and a mission has been completed
          (POST /api/mission/end) so there is data to report.
        </p>
      </div>
    </div>
  );
}

// ─── ReportScreen ─────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const [report,  setReport]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  async function fetchReport() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/report`);
      if (!res.ok) throw new Error(`HTTP ${res.status} — ${res.statusText}`);
      const data = await res.json();
      setReport(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchReport(); }, []);

  if (loading) return <LoadingSkeleton />;
  if (error)   return <ErrorState message={error} onRetry={fetchReport} />;

  return (
    <main className="h-full flex flex-col gap-3 p-3 overflow-hidden">
      {/* ── Header strip ── */}
      <ReportHeader report={report} />

      {/* ── Middle row: actions + export ── */}
      <div className="flex gap-3 shrink-0">
        {/* Top actions — takes remaining width */}
        <div className="flex-1 min-w-0">
          <TopActionsList actions={report.top_actions ?? []} />
        </div>

        {/* Export panel — fixed width */}
        <div className="w-56 shrink-0">
          <ExportPanel report={report} />
        </div>
      </div>

      {/* ── Ranked findings table — scrollable, fills remaining height ── */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <RankedFindingsList findings={report.ranked_detections ?? []} />
      </div>

      {/* ── Footer: refresh + formula disclosure ── */}
      <div className="flex items-center justify-between shrink-0 px-1">
        <p className="text-[9px] text-slate-300 font-mono">
          score = 0.50×conf + 0.30×proximity + 0.20×age ·
          thresholds: URGENT≥0.75, HIGH≥0.55, MEDIUM≥0.35 ·
          template-based justifications, no LLM
        </p>
        <button
          onClick={fetchReport}
          className="text-[10px] font-bold text-slate-400 hover:text-blue-600
                     uppercase tracking-widest transition-colors"
        >
          ↻ Refresh Report
        </button>
      </div>
    </main>
  );
}
