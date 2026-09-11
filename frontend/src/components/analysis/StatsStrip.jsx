/**
 * StatsStrip — top bar of AnalysisScreen.
 * Fetches GET /api/mission/stats on mount and displays the six stat tiles
 * in a horizontal strip: Duration, Area Covered, Detections (with priority
 * breakdown), GNSS Outage, VIO Usage, and a phase badge.
 *
 * No props required — fully self-fetching.
 */
import { useState, useEffect } from "react";

const API = "http://localhost:8000";

// ─── Stat tile ────────────────────────────────────────────────────────────────

function Tile({ label, value, sub, accent }) {
  return (
    <div
      className={`flex flex-col gap-0.5 px-4 py-2.5 border-r border-slate-100 last:border-0
                  ${accent ? "bg-blue-50" : ""}`}
    >
      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        {label}
      </span>
      <span className="text-lg font-bold text-slate-800 tabular-nums leading-tight">
        {value}
      </span>
      {sub && (
        <span className="text-[10px] text-slate-400 leading-tight">{sub}</span>
      )}
    </div>
  );
}

// ─── Survivor breakdown ───────────────────────────────────────────────────────

function SurvivorBreakdown({ counts }) {
  if (!counts) return null;
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold tabular-nums">
      {counts.high > 0 && (
        <span className="pill-red text-[9px]">{counts.high} high</span>
      )}
      {counts.medium > 0 && (
        <span className="pill-amber text-[9px]">{counts.medium} med</span>
      )}
      {counts.low > 0 && (
        <span className="pill-green text-[9px]">{counts.low} low</span>
      )}
      {counts.high === 0 && counts.medium === 0 && counts.low === 0 && (
        <span className="text-slate-400">None</span>
      )}
    </div>
  );
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function fmtDuration(secs) {
  if (!secs && secs !== 0) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ─── StatsStrip ───────────────────────────────────────────────────────────────

export default function StatsStrip() {
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchStats() {
      try {
        const res = await fetch(`${API}/api/mission/stats`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setStats(data);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      }
    }
    fetchStats();
    // Refresh every 10 s in case user is still in LIVE_RESCUE and calls
    // /api/mission/end during this session.
    const interval = setInterval(fetchStats, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="panel px-4 py-2 flex items-center gap-2 shrink-0">
        <span className="text-xs text-slate-400 animate-pulse">
          Loading mission stats…
        </span>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="panel px-4 py-2 flex items-center gap-2 shrink-0">
        <span className="text-xs text-red-500">
          Stats unavailable: {error ?? "no data"}
        </span>
        <button
          onClick={() => { setLoading(true); setError(null); }}
          className="text-[10px] text-blue-600 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  const totalSurvivors = stats.detection_count ?? 0;
  const sbp = stats.survivors_by_priority ?? {};

  return (
    <div className="panel flex items-stretch shrink-0 overflow-x-auto">
      {/* Phase badge */}
      <div className="flex flex-col justify-center px-4 border-r border-slate-100">
        <span className="pill-blue text-[10px]">ANALYSIS</span>
      </div>

      <Tile
        label="Mission Duration"
        value={fmtDuration(stats.duration_seconds)}
        sub={`${stats.duration_seconds?.toFixed(0) ?? 0} s raw`}
      />
      <Tile
        label="Area Covered"
        value={`${stats.area_covered_pct?.toFixed(1) ?? 0}%`}
        sub="of search polygon"
        accent={stats.area_covered_pct >= 80}
      />
      <div className="flex flex-col gap-1 px-4 py-2.5 border-r border-slate-100">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
          Detections
        </span>
        <span className="text-lg font-bold text-slate-800 tabular-nums leading-tight">
          {totalSurvivors}
        </span>
        <SurvivorBreakdown counts={sbp} />
      </div>
      <Tile
        label="GNSS Outage"
        value={fmtDuration(stats.gnss_outage_seconds)}
        sub={stats.gnss_outage_seconds > 0 ? "VIO fallback used" : "No outage"}
      />
      <Tile
        label="VIO Usage"
        value={fmtDuration(stats.vio_usage_seconds)}
        sub="position fallback"
      />

      {/* Right-end spacer */}
      <div className="flex-1" />

      {/* Refresh button */}
      <div className="flex items-center px-3">
        <button
          onClick={async () => {
            setLoading(true);
            try {
              const res = await fetch(`${API}/api/mission/stats`);
              const data = await res.json();
              setStats(data);
            } finally {
              setLoading(false);
            }
          }}
          className="text-[10px] font-bold text-slate-400 hover:text-blue-600
                     uppercase tracking-widest transition-colors"
        >
          ↻ Refresh
        </button>
      </div>
    </div>
  );
}
